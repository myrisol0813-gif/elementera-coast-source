import { readConversationState, readProfile } from '../chat-store.js';
import { safeLogError } from '../http.js';
import { soilSettings } from '../memory-config.js';
import {
  MemoryStoreError,
  normalizeAfterthoughts,
  normalizeSoilCandidates,
  readSoil,
  upsertSoilCandidates,
  writeSoil,
} from '../memory-store.js';
import { ModelRequestError, performFormalChat } from '../models.js';
import {
  decoratePocketsProvenance,
  decorateSoilProvenance,
  saveGenerationProvenance,
} from '../provenance-store.js';

export const SOIL_LANDING_FIELD_CHARS = 24000;
export const SOIL_REPLY_FIELD_CHARS = 6000;
export const SOIL_PREVIOUS_FIELD_CHARS = 1000;
export const SOIL_BACKFILL_TURNS = 3;
export const SOIL_PROMPT_TOTAL_CHARS = 28 * 1024;
export const SOIL_ORGANIZE_MAX_TOKENS = 3200;
export const PLAN_SOIL_MAX_RESULT_CHARS = 10000;

export const SOIL_RESPONSE_FORMAT = Object.freeze({
  type: 'json_schema',
  json_schema: Object.freeze({
    name: 'thought_soil_v2',
    strict: true,
    schema: Object.freeze({
      type: 'object',
      additionalProperties: false,
      properties: Object.freeze({
        current_text: Object.freeze({ type: 'string' }),
        afterthoughts: Object.freeze({
          type: 'array',
          items: Object.freeze({ type: 'string' }),
        }),
        memory_candidates: Object.freeze({
          type: 'array',
          items: Object.freeze({
            type: 'object',
            additionalProperties: false,
            properties: Object.freeze({
              title: Object.freeze({ type: 'string' }),
              content: Object.freeze({ type: 'string' }),
              source_refs: Object.freeze({
                type: 'array',
                items: Object.freeze({
                  type: 'object',
                  additionalProperties: false,
                  properties: Object.freeze({
                    turn_id: Object.freeze({ type: 'string' }),
                    role: Object.freeze({ type: 'string', enum: ['user', 'assistant', 'turn'] }),
                  }),
                  required: ['turn_id', 'role'],
                }),
              }),
              source_excerpt: Object.freeze({ type: 'string' }),
            }),
            required: ['title', 'content', 'source_refs', 'source_excerpt'],
          }),
        }),
        seed_candidates: Object.freeze({
          type: 'array',
          items: Object.freeze({
            type: 'object',
            additionalProperties: false,
            properties: Object.freeze({
              title: Object.freeze({ type: 'string' }),
              content: Object.freeze({ type: 'string' }),
              source_refs: Object.freeze({
                type: 'array',
                items: Object.freeze({
                  type: 'object',
                  additionalProperties: false,
                  properties: Object.freeze({
                    turn_id: Object.freeze({ type: 'string' }),
                    role: Object.freeze({ type: 'string', enum: ['user', 'assistant', 'turn'] }),
                  }),
                  required: ['turn_id', 'role'],
                }),
              }),
              source_excerpt: Object.freeze({ type: 'string' }),
            }),
            required: ['title', 'content', 'source_refs', 'source_excerpt'],
          }),
        }),
      }),
      required: ['current_text', 'afterthoughts', 'memory_candidates', 'seed_candidates'],
    }),
  }),
});

export function activeBranch(turn = {}) {
  const userVariants = Array.isArray(turn?.user?.variants) ? turn.user.variants : [];
  const userIndex = Math.min(Math.max(0, Number(turn?.user?.active || 0)), Math.max(0, userVariants.length - 1));
  const assistants = turn?.assistant?.variantsByUserVariant?.[String(userIndex)] || [];
  const assistantIndex = Math.min(
    Math.max(0, Number(turn?.assistant?.activeByUserVariant?.[String(userIndex)] || 0)),
    Math.max(0, assistants.length - 1),
  );
  return {
    turn_id: String(turn.id || ''),
    user: userVariants[userIndex] || null,
    assistant: assistants[assistantIndex] || null,
  };
}

export function completedTurns(state) {
  return (Array.isArray(state?.turns) ? state.turns : [])
    .map(activeBranch)
    .filter((branch) => branch.user?.content
      && branch.assistant?.content
      && branch.assistant.content !== '正在连接当前模型……');
}

export function isLandingBranch(branch = {}) {
  return branch.user?.hidden === true || branch.user?.input_type === 'landing_letter';
}

export function visibleCompletedTurns(state) {
  return completedTurns(state).filter((branch) => !isLandingBranch(branch));
}

export function parseStrictJson(value) {
  const text = String(value || '').trim();
  const candidates = [text];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1]?.trim();
  if (fenced && fenced !== text) candidates.unshift(fenced);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      // Some providers wrap an otherwise valid JSON object in a short preface.
    }
  }

  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== '{') continue;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const character = text[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') quoted = true;
      else if (character === '{') depth += 1;
      else if (character === '}') {
        depth -= 1;
        if (depth !== 0) continue;
        try {
          const parsed = JSON.parse(text.slice(start, index + 1));
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
        } catch {
          break;
        }
      }
    }
  }
  throw new MemoryStoreError('soil_organize_invalid', '思维壤整理结果格式无效。', 502);
}

export function clipSoilContent(value, max = SOIL_REPLY_FIELD_CHARS) {
  return Array.from(String(value || '')).slice(0, Math.max(0, max)).join('');
}

export function soilTurnDigest(branch, maxChars) {
  if (!branch) return null;
  return {
    turn_id: branch.turn_id,
    user: {
      message_id: String(branch.user?.id || ''),
      content: clipSoilContent(branch.user?.content, maxChars),
    },
    assistant: {
      message_id: String(branch.assistant?.id || ''),
      content: clipSoilContent(branch.assistant?.content, maxChars),
    },
  };
}

export function landingSoilContext(turns) {
  const landingTurns = turns.filter(isLandingBranch);
  const source = (landingTurns.length ? landingTurns : turns).slice(-1);
  return {
    mode: 'landing_bootstrap',
    landing_turns: source.map((branch) => soilTurnDigest(branch, SOIL_LANDING_FIELD_CHARS)).filter(Boolean),
  };
}

export function turnsAfterCursor(turns, cursor) {
  if (!cursor) return turns.slice(-SOIL_BACKFILL_TURNS);
  const index = turns.findIndex((turn) => turn.turn_id === cursor);
  if (index < 0) return turns.slice(-SOIL_BACKFILL_TURNS);
  return turns.slice(index + 1);
}

export function replySoilContext(turns, oldSoil) {
  const latest = turns.at(-1) || null;
  const previous = turns.length > 1 ? turns.at(-2) : null;
  const cursor = String(oldSoil.organized_through_turn_id || '');
  const missed = turnsAfterCursor(turns, cursor)
    .filter((branch) => branch?.turn_id
      && branch.turn_id !== latest?.turn_id
      && branch.turn_id !== previous?.turn_id)
    .slice(-SOIL_BACKFILL_TURNS)
    .map((branch) => soilTurnDigest(branch, SOIL_PREVIOUS_FIELD_CHARS))
    .filter(Boolean);
  return {
    mode: 'reply_incremental',
    old_current_text: oldSoil.current_text || '',
    old_afterthoughts: oldSoil.afterthoughts || [],
    organized_through_turn_id: cursor,
    latest_turn: soilTurnDigest(latest, SOIL_REPLY_FIELD_CHARS),
    previous_turn_excerpt: previous ? soilTurnDigest(previous, SOIL_PREVIOUS_FIELD_CHARS) : null,
    missed_since_success: missed,
  };
}

export function boundedSoilContext(context) {
  let value = context;
  if (JSON.stringify(value).length <= SOIL_PROMPT_TOTAL_CHARS) return value;
  value = {
    ...context,
    previous_turn_excerpt: context.previous_turn_excerpt ? soilTurnDigest({
      turn_id: context.previous_turn_excerpt.turn_id,
      user: context.previous_turn_excerpt.user,
      assistant: context.previous_turn_excerpt.assistant,
    }, 400) : null,
    missed_since_success: (context.missed_since_success || []).slice(-1),
  };
  if (JSON.stringify(value).length <= SOIL_PROMPT_TOTAL_CHARS) return value;
  return {
    ...value,
    old_afterthoughts: (value.old_afterthoughts || []).slice(0, 5),
  };
}

export function soilPrompt(turns, oldSoil, options = {}) {
  const context = options.landing
    ? landingSoilContext(turns)
    : boundedSoilContext(replySoilContext(turns, oldSoil));
  return `思维壤

① 当前｜current_text
现在仍需承接的东西。
整理当前对话中，在最近上下文逐渐滑出后仍值得继续带着的情境、事项、变化与未完成内容。

② 余思｜afterthoughts
整理这一刻，你觉得想要、需要留下的好奇、兴趣、联想与未尽方向。
非强制填写，没有想留下的余思时可以为空。

③ 去处｜memory_candidates / seed_candidates
对话中，你觉得值得安放到更远处的内容。是否提出候选，由你自行判断。

memory_candidates —— 记忆候选
值得以后仍然能够认出、取回和承接的内容。可以是事实、已经发生的事件、形成的认识、决定、关系变化、项目状态，也可以是某个对双方而言有持续意义的细节。
它更偏向“以后再遇见时，我希望自己还知道这件事”。

seed_candidates —— 种子候选
值得留下继续生长的内容。可以是有趣的想法、问题、意象、猜想、创作方向、尚未展开的可能性，或你想在未来重新拿起来思考的东西。
它更偏向“我不知道它以后会长成什么，但我想留下这颗种子”。

候选只代表你希望把它递往相应区域，系统会把它送入待确认流程；是否成为正式记忆或种子，仍由后续确认决定。

请只返回一个 JSON 对象：
{
  "current_text": "字符串，可以为空",
  "afterthoughts": ["字符串；非强制，可以为空数组"],
  "memory_candidates": [{
    "title": "简短名称",
    "content": "希望以后仍能认出和承接的内容",
    "source_refs": [{"turn_id":"从整理输入中的真实 turn_id 选择","role":"user|assistant|turn"}],
    "source_excerpt": "帮助辨认来源的短摘录"
  }],
  "seed_candidates": [{
    "title": "简短名称",
    "content": "值得留下继续生长的内容",
    "source_refs": [{"turn_id":"从整理输入中的真实 turn_id 选择","role":"user|assistant|turn"}],
    "source_excerpt": "帮助辨认来源的短摘录"
  }]
}

四个内容字段都允许为空。不要为了填满结构而制造内容。
最近上下文本身会继续递给聊天模型；current_text 只保留在这些最近消息逐渐滑出后仍需要承接的内容。
old_current_text 与 old_afterthoughts 是上一版桌面，可自由保留、压缩、改写或让其退出。
source_refs 可以只选择真正相关的 turn_id；如果不需要精确指向，可返回空数组，系统会补上本轮来源。
整理结果只提出候选，不直接修改正式记忆库或种子库。

整理输入结构：
${JSON.stringify(context)}`;
}

export async function organizeConversationSoil(env, conversationId, value) {
  const landing = value.trigger === 'landing';
  const reply = value.trigger === 'reply';
  const force = value.force === true || reply;
  const requestedModel = String(value.model || '').trim().slice(0, 180);
  const planPhase = value.plan_phase || '';
  if (planPhase && !['prepare', 'commit'].includes(planPhase)) {
    throw new MemoryStoreError('invalid_plan_phase', '无效的本机 GPT 思维壤操作。', 400);
  }
  if (planPhase && !/^chatgpt-plan:gpt-[a-z0-9._-]+$/.test(requestedModel)) {
    throw new MemoryStoreError('invalid_plan_model', '思维壤只能使用已选择的本机 GPT 模型。', 400);
  }
  const settings = soilSettings(value.settings || {});
  const oldSoil = await decorateSoilProvenance(
    env.COAST_CHAT_DB,
    await readSoil(env.COAST_CHAT_DB, conversationId),
  );
  if (oldSoil.manual_locked) {
    return { ok: true, skipped: true, reason: 'manual_locked', soil: oldSoil };
  }
  if ((landing || reply) && !oldSoil.auto_refresh_enabled) {
    return { ok: true, skipped: true, reason: 'auto_refresh_disabled', soil: oldSoil };
  }
  if (!force && !oldSoil.auto_refresh_enabled) {
    return { ok: true, skipped: true, reason: 'auto_refresh_disabled', soil: oldSoil };
  }

  const state = await readConversationState(env.COAST_CHAT_DB, conversationId);
  const turns = landing ? completedTurns(state) : visibleCompletedTurns(state);
  if (!turns.length) return { ok: true, skipped: true, reason: 'no_completed_turns', soil: oldSoil };
  const latestTurn = turns.at(-1);
  const activeModel = String(latestTurn?.assistant?.model_id || '').trim();
  // An older Native app must not silently fall through to a billed Coast
  // provider when a ChatGPT-plan assistant has just completed.
  if (!planPhase && activeModel.startsWith('chatgpt-plan:')) {
    throw new MemoryStoreError('plan_soil_requires_native', '官端 GPT 思维壤必须由本机套餐模型整理；未调用其他 API。请更新 Native。', 409);
  }
  if (planPhase && activeModel !== requestedModel) {
    throw new MemoryStoreError('plan_soil_model_mismatch', '本轮模型与思维壤整理模型不一致。', 409);
  }
  const scheduledTurn = landing
    || reply
    || turns.length === 1
    || (turns.length - 1) % settings.autoRefreshEveryTurns === 0;
  const latestAssistantAt = Date.parse(turns.at(-1)?.assistant?.created_at || '');
  const soilUpdatedAt = Date.parse(oldSoil.updated_at || '');
  if (!force && (!scheduledTurn || (oldSoil.revision > 1 && Number.isFinite(latestAssistantAt) && soilUpdatedAt >= latestAssistantAt))) {
    return { ok: true, skipped: true, reason: 'not_due', soil: oldSoil };
  }

  if (planPhase === 'prepare') {
    return {
      ok: true,
      skipped: false,
      model: requestedModel,
      prompt: soilPrompt(turns, oldSoil, { landing }),
      expected_turn_id: latestTurn.turn_id,
      expected_assistant_id: String(latestTurn.assistant?.id || ''),
      expected_soil_revision: oldSoil.revision,
      max_result_chars: PLAN_SOIL_MAX_RESULT_CHARS,
    };
  }
  if (planPhase === 'commit') {
    const matches = value.expected_turn_id === latestTurn.turn_id
      && value.expected_assistant_id === String(latestTurn.assistant?.id || '')
      && Number.isSafeInteger(value.expected_soil_revision)
      && value.expected_soil_revision === oldSoil.revision;
    if (!matches) {
      throw new MemoryStoreError('plan_soil_stale', '整理期间思维壤或聊天记录已经改变；未覆盖较新的资料。', 409);
    }
    if (typeof value.result_text !== 'string' || value.result_text.length > PLAN_SOIL_MAX_RESULT_CHARS) {
      throw new MemoryStoreError('plan_soil_result_invalid', '本轮整理内容长度无效。', 400);
    }
  }
  let organized;
  let organizedBy = null;
  let degradedReason = '';
  try {
    if (planPhase === 'commit') {
      organized = parseStrictJson(value.result_text);
      if (typeof organized.current_text !== 'string'
        || !Array.isArray(organized.afterthoughts)
        || !Array.isArray(organized.memory_candidates)
        || !Array.isArray(organized.seed_candidates)) {
        throw new MemoryStoreError('soil_organize_invalid', 'GPT 整理结果不符合思维壤格式；旧资料保持不变。', 422);
      }
      const safeUsage = (key) => {
        const n = value.usage?.[key];
        return Number.isSafeInteger(n) && n >= 0 && n <= 100000000 ? n : null;
      };
      organizedBy = {
        model_id: requestedModel,
        usage: {
          prompt_tokens: safeUsage('input_tokens'),
          completion_tokens: safeUsage('output_tokens'),
          cached_tokens: safeUsage('cached_tokens'),
        },
        generation_source: 'soil',
        generated_at: Date.now(),
      };
    } else {
    const profile = await readProfile(env.COAST_CHAT_DB);
    const modelId = requestedModel || profile.current_chat_model || 'openai/gpt-4.1-nano';
    const basePrompt = soilPrompt(turns, oldSoil, { landing });
    let lastJsonError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const result = await performFormalChat(env, {
          model: modelId,
          messages: [{
            role: 'user',
            content: attempt === 0
              ? basePrompt
              : basePrompt + '\n\n上一次输出不是合法 JSON。请只返回一个完整 JSON 对象，不要 Markdown，不要解释，不要省略字段。',
          }],
          settings: { max_tokens: SOIL_ORGANIZE_MAX_TOKENS, temperature: 0.2 },
          response_format: SOIL_RESPONSE_FORMAT,
          reasoning: { effort: 'minimal', exclude: true },
        });
        if (result?.finish_reason === 'length') {
          throw new MemoryStoreError('soil_organize_truncated', '思维壤整理结果被模型长度上限截断。', 502);
        }
        organized = parseStrictJson(result?.message?.content);
        organizedBy = {
          model_id: result?.model || modelId,
          usage: result?.usage || null,
          generation_source: 'soil',
          generated_at: Date.now(),
        };
        lastJsonError = null;
        break;
      } catch (error) {
        if (!(error instanceof MemoryStoreError && String(error.type || '').startsWith('soil_organize_'))) throw error;
        lastJsonError = error;
        if (attempt === 1) throw error;
      }
    }
    if (!organized && lastJsonError) throw lastJsonError;
    }
  } catch (error) {
    if (planPhase) throw error;
    if (!(error instanceof ModelRequestError)
      && !(error instanceof MemoryStoreError && String(error.type || '').startsWith('soil_organize_'))) throw error;
    safeLogError('memory:soil-organize', error);
    degradedReason = error.type || 'soil_organize_failed';
    return {
      ok: true,
      degraded: true,
      reason: degradedReason,
      soil: oldSoil,
      pocket_sync: null,
    };
  }

  const allowedTurnIds = new Set(turns.map((turn) => turn.turn_id).filter(Boolean));
  const fallbackExcerpt = [latestTurn?.user?.content, latestTurn?.assistant?.content]
    .map((part) => String(part || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean).join(' / ').slice(0, 360);
  const candidateOptions = {
    allowedTurnIds,
    fallbackSourceRef: latestTurn?.turn_id ? { turn_id: latestTurn.turn_id, role: 'turn' } : null,
    fallbackExcerpt,
  };
  const soilValue = {
    current_text: String(organized.current_text || '').trim(),
    afterthoughts: normalizeAfterthoughts(organized.afterthoughts),
    memory_candidates: normalizeSoilCandidates(organized.memory_candidates, candidateOptions),
    seed_candidates: normalizeSoilCandidates(organized.seed_candidates, candidateOptions),
    organized_through_turn_id: latestTurn?.turn_id || oldSoil.organized_through_turn_id,
    manual_locked: oldSoil.manual_locked,
    auto_refresh_enabled: oldSoil.auto_refresh_enabled,
  };
  let writtenSoil = await writeSoil(env.COAST_CHAT_DB, conversationId, soilValue, {
    automatic: true,
    provenance: {
      model_label: organizedBy?.model_id || '',
      source_conversation_id: conversationId,
      source_turn_id: soilValue.organized_through_turn_id || '',
    },
  });
  if (organizedBy) {
    await saveGenerationProvenance(env.COAST_CHAT_DB, 'soil', conversationId, organizedBy);
    writtenSoil = await decorateSoilProvenance(env.COAST_CHAT_DB, writtenSoil);
  }
  const pocketSync = await upsertSoilCandidates(env.COAST_CHAT_DB, conversationId, {
    memory_candidates: writtenSoil.memory_candidates,
    seed_candidates: writtenSoil.seed_candidates,
  });
  if (organizedBy && pocketSync) {
    await Promise.all((pocketSync.pockets || [])
      .filter((pocket) => pocket?.id && pocket?.source_type === 'soil' && pocket?.status === 'pending')
      .map((pocket) => saveGenerationProvenance(env.COAST_CHAT_DB, 'pocket', pocket.id, organizedBy)));
    pocketSync.pockets = await decoratePocketsProvenance(env.COAST_CHAT_DB, pocketSync.pockets);
  }
  return {
    ok: true,
    degraded: Boolean(degradedReason),
    reason: degradedReason,
    soil: writtenSoil,
    ...(pocketSync ? { pocket_sync: pocketSync } : {}),
  };
}
