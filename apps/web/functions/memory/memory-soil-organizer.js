import { readConversationState, readProfile } from '../chat-store.js';
import { safeLogError } from '../http.js';
import { soilSettings } from '../memory-config.js';
import {
  MemoryStoreError,
  normalizeHandSeeds,
  normalizePocketCandidates,
  readSoil,
  upsertSoilPocketCandidates,
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

export const SOIL_RESPONSE_FORMAT = Object.freeze({
  type: 'json_schema',
  json_schema: Object.freeze({
    name: 'thought_soil',
    strict: true,
    schema: Object.freeze({
      type: 'object',
      additionalProperties: false,
      properties: Object.freeze({
        current_text: Object.freeze({ type: 'string' }),
        hand_seeds_mode: Object.freeze({ type: 'string', enum: ['replace', 'keep', 'clear'] }),
        hand_seeds: Object.freeze({
          type: 'array',
          items: Object.freeze({
            type: 'object',
            additionalProperties: false,
            properties: Object.freeze({
              name: Object.freeze({ type: 'string' }),
              life_core: Object.freeze({ type: 'string' }),
              usage_hint: Object.freeze({ type: 'string' }),
              avoid_hint: Object.freeze({ type: 'string' }),
            }),
            required: ['name', 'life_core', 'usage_hint', 'avoid_hint'],
          }),
        }),
        do_not_repeat_mode: Object.freeze({ type: 'string', enum: ['replace', 'keep', 'clear'] }),
        do_not_repeat: Object.freeze({ type: 'string' }),
        pocket_candidates_mode: Object.freeze({ type: 'string', enum: ['replace', 'keep', 'clear'] }),
        pocket_candidates: Object.freeze({
          type: 'array',
          items: Object.freeze({
            type: 'object',
            additionalProperties: false,
            properties: Object.freeze({
              candidate_id: Object.freeze({ type: 'string' }),
              title: Object.freeze({ type: 'string' }),
              life_core: Object.freeze({ type: 'string' }),
              content: Object.freeze({ type: 'string' }),
              usage_hint: Object.freeze({ type: 'string' }),
              avoid_hint: Object.freeze({ type: 'string' }),
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
            required: ['candidate_id', 'title', 'life_core', 'content', 'usage_hint', 'avoid_hint', 'source_refs', 'source_excerpt'],
          }),
        }),
      }),
      required: [
        'current_text',
        'hand_seeds_mode',
        'hand_seeds',
        'do_not_repeat_mode',
        'do_not_repeat',
        'pocket_candidates_mode',
        'pocket_candidates',
      ],
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
  throw new MemoryStoreError('soil_organize_invalid', '整理当前对话的纸条整理结果格式无效。', 502);
}

export function normalizeSoilMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  return ['replace', 'keep', 'clear'].includes(mode) ? mode : '';
}

export function fallbackCurrentText(turns, landing) {
  const latest = turns.at(-1);
  if (landing || latest?.user?.hidden || latest?.user?.input_type === 'landing_letter') {
    return '登岛信开场已经完成，正在承接这封信与刚刚的读信回复。';
  }
  const source = String(latest?.user?.content || '').replace(/\s+/g, ' ').trim();
  const preview = Array.from(source).slice(0, 72).join('');
  return preview
    ? `刚刚完成了一轮对话，当前正在承接：${preview}${Array.from(source).length > 72 ? '…' : ''}`
    : '刚刚完成了一轮对话，正在承接当前主题与下一步。';
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
    organized_through_turn_id: cursor,
    latest_turn: soilTurnDigest(latest, SOIL_REPLY_FIELD_CHARS),
    previous_turn_excerpt: previous ? soilTurnDigest(previous, SOIL_PREVIOUS_FIELD_CHARS) : null,
    missed_since_success: missed,
    old_hand_seeds: oldSoil.hand_seeds,
    old_do_not_repeat: oldSoil.do_not_repeat,
    old_pocket_candidates: oldSoil.pocket_candidates,
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
    old_hand_seeds: (value.old_hand_seeds || []).slice(0, 3),
    old_do_not_repeat: clipSoilContent(value.old_do_not_repeat, 1200),
    old_pocket_candidates: (value.old_pocket_candidates || []).slice(0, 3),
  };
}

export function soilPrompt(turns, oldSoil, maxHandSeeds, options = {}) {
  const context = options.landing
    ? landingSoilContext(turns)
    : boundedSoilContext(replySoilContext(turns, oldSoil));
  return `你只负责整理当前对话的一小捧“整理当前对话的纸条”。它是当前窗口的工作台小纸条，不是永久档案馆，不是长期记忆，也不是思考过程。
请只返回一个 JSON 对象，不要 Markdown，不要解释：
{
  "current_text": "当前窗口此刻的滚动承接便签，通常 600–1800 中文字符，不要流水账",
  "hand_seeds_mode": "replace|keep|clear 三选一",
  "hand_seeds": [{"name":"名称","life_core":"生命核","usage_hint":"何时可用","avoid_hint":"如何避免复读"}],
  "do_not_repeat_mode": "replace|keep|clear 三选一",
  "do_not_repeat": "已经确认、不应重复铺陈的内容",
  "pocket_candidates_mode": "replace|keep|clear 三选一",
  "pocket_candidates": [{
    "candidate_id": "简短稳定标识",
    "title": "不是原句截取的简短名称",
    "life_core": "真正有再生力的核心",
    "content": "保留足够上下文后的压缩内容",
    "usage_hint": "什么情况下值得重新碰到",
    "avoid_hint": "如何避免机械复读或误用",
    "source_refs": [{"turn_id":"从本轮上下文中原样选择","role":"user|assistant|turn"}],
    "source_excerpt": "帮助辨认来源的短摘录"
  }]
}

mode 含义：
- replace：使用你本轮返回的新纸条。旧纸条可以退出、被改写、合并或替换；新内容比旧内容少也没关系。
- keep：这一栏原样保留旧整理当前对话的纸条。
- clear：你明确判断这一栏已经过时、重复、已经落袋或不再适合当前窗口，因此清空这一栏。
不要把空数组或空字符串当作失败占位。如果你确实要清空，请使用 clear mode；如果你没有要改这一栏，请使用 keep mode。

current_text 是“滚动承接便签”，不是最近十二轮聊天摘要。普通回复整理时，约 60–70% 注意力放在 latest_turn，约 20–30% 保留 old_current_text 中仍直接连接当前话题的未完成线索，极少量使用 previous_turn_excerpt 与 missed_since_success 防止断层。允许改写、压缩、删除已经结束的话题，用最新一轮重新解释上一段。不要累加“先聊 A、再聊 B、然后 C”的流水账；不要每轮继续背着登岛信；不要把远古精华长期塞在 current_text。

hand_seeds 不是永久收藏夹，而是“此刻最值得手持”的最多 ${maxHandSeeds} 粒。每轮都可以保留仍有用的旧种、删除过时旧种、替换旧种、合并重复旧种、改写旧种或加入新种。满 ${maxHandSeeds} 粒时主动做取舍。不要因为旧整理当前对话的纸条里已经有旧种就机械保留，也不要害怕让旧纸条退出手持。
do_not_repeat 也只是当前窗口的工作提醒。已经不再需要防复读的提醒可以改写、合并或 clear。
pocket_candidates 只放“现在不用、但仍有再生力”的内容，并使用上方真实 turn_id。旧候选会由系统先 upsert 到 pending；已经进入 pending、已经落袋或已经不适合当前窗口的候选可以从整理当前对话的纸条展示层退出，不要为了保留展示而反复挂在手上。当前确实没有候选时使用 pocket_candidates_mode=clear。

你只能整理 current_text、hand_seeds、do_not_repeat、pocket_candidates 这四块临时工作台内容。不要创建或删除长期记忆，不要删除聊天记录、pending pocket、confirmed pocket、seed、memory 或向量索引中的已确认内容；不要判断 core，不要把候选升级为 seed 或 memory，不要替用户做决定，不要复述整段聊天。

整理输入结构：
${JSON.stringify(context)}`;
}

export async function organizeConversationSoil(env, conversationId, value) {
  const landing = value.trigger === 'landing';
  const reply = value.trigger === 'reply';
  const force = value.force === true || reply;
  const requestedModel = String(value.model || '').trim().slice(0, 180);
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
  const scheduledTurn = landing
    || reply
    || turns.length === 1
    || (turns.length - 1) % settings.autoRefreshEveryTurns === 0;
  const latestAssistantAt = Date.parse(turns.at(-1)?.assistant?.created_at || '');
  const soilUpdatedAt = Date.parse(oldSoil.updated_at || '');
  if (!force && (!scheduledTurn || (oldSoil.revision > 1 && Number.isFinite(latestAssistantAt) && soilUpdatedAt >= latestAssistantAt))) {
    return { ok: true, skipped: true, reason: 'not_due', soil: oldSoil };
  }

  const fallback = fallbackCurrentText(turns, landing);
  let organized;
  let organizedBy = null;
  let degradedReason = '';
  try {
    const profile = await readProfile(env.COAST_CHAT_DB);
    const modelId = requestedModel || profile.current_chat_model || 'openai/gpt-4.1-nano';
    const basePrompt = soilPrompt(turns, oldSoil, settings.maxHandSeeds, { landing });
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
          throw new MemoryStoreError('soil_organize_truncated', '整理当前对话的纸条整理结果被模型长度上限截断。', 502);
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
  } catch (error) {
    if (!(error instanceof ModelRequestError)
      && !(error instanceof MemoryStoreError && String(error.type || '').startsWith('soil_organize_'))) throw error;
    safeLogError('memory:soil-organize', error);
    degradedReason = error.type || 'soil_organize_failed';
    const degradedSoil = await writeSoil(env.COAST_CHAT_DB, conversationId, {
      current_text: fallback,
      hand_seeds: oldSoil.hand_seeds,
      do_not_repeat: oldSoil.do_not_repeat,
      pocket_candidates: oldSoil.pocket_candidates,
      organized_through_turn_id: oldSoil.organized_through_turn_id,
      manual_locked: oldSoil.manual_locked,
      auto_refresh_enabled: oldSoil.auto_refresh_enabled,
    }, { automatic: true });
    return {
      ok: true,
      degraded: true,
      reason: degradedReason,
      soil: await decorateSoilProvenance(env.COAST_CHAT_DB, degradedSoil),
      pocket_sync: null,
    };
  }

  const latestTurn = turns.at(-1);
  const allowedTurnIds = new Set(turns.map((turn) => turn.turn_id).filter(Boolean));
  const fallbackExcerpt = [latestTurn?.user?.content, latestTurn?.assistant?.content]
    .map((part) => String(part || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean).join(' / ').slice(0, 360);
  const handSeedsMode = normalizeSoilMode(organized.hand_seeds_mode);
  const doNotRepeatMode = normalizeSoilMode(organized.do_not_repeat_mode);
  const pocketCandidatesMode = normalizeSoilMode(organized.pocket_candidates_mode);
  const organizedHandSeeds = normalizeHandSeeds(organized.hand_seeds).slice(0, settings.maxHandSeeds);
  const organizedDoNotRepeat = String(organized.do_not_repeat || '').trim();
  const organizedPocketCandidates = normalizePocketCandidates(organized.pocket_candidates, {
    allowedTurnIds,
    fallbackSourceRef: latestTurn?.turn_id ? { turn_id: latestTurn.turn_id, role: 'turn' } : null,
    fallbackExcerpt,
  });
  const soilValue = {
    current_text: String(organized.current_text || '').trim()
      || fallback,
    hand_seeds: handSeedsMode === 'replace'
      ? organizedHandSeeds
      : handSeedsMode === 'keep'
        ? oldSoil.hand_seeds
        : handSeedsMode === 'clear'
          ? []
          : organizedHandSeeds.length ? organizedHandSeeds : oldSoil.hand_seeds,
    do_not_repeat: doNotRepeatMode === 'replace'
      ? organizedDoNotRepeat
      : doNotRepeatMode === 'keep'
        ? oldSoil.do_not_repeat
        : doNotRepeatMode === 'clear'
          ? ''
          : organizedDoNotRepeat || oldSoil.do_not_repeat,
    pocket_candidates: pocketCandidatesMode === 'replace'
      ? organizedPocketCandidates
      : pocketCandidatesMode === 'keep'
        ? oldSoil.pocket_candidates
        : pocketCandidatesMode === 'clear'
          ? []
          : organizedPocketCandidates.length ? organizedPocketCandidates : oldSoil.pocket_candidates,
    organized_through_turn_id: latestTurn?.turn_id || oldSoil.organized_through_turn_id,
    manual_locked: oldSoil.manual_locked,
    auto_refresh_enabled: oldSoil.auto_refresh_enabled,
  };
  const previousPocketSync = degradedReason
    ? null
    : await upsertSoilPocketCandidates(env.COAST_CHAT_DB, conversationId, oldSoil.pocket_candidates);
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
  const currentPocketSync = degradedReason
    ? null
    : await upsertSoilPocketCandidates(env.COAST_CHAT_DB, conversationId, writtenSoil.pocket_candidates);
  if (organizedBy && currentPocketSync) {
    await Promise.all((currentPocketSync.pockets || [])
      .filter((pocket) => pocket?.id && pocket?.source_type === 'soil' && pocket?.status === 'pending')
      .map((pocket) => saveGenerationProvenance(env.COAST_CHAT_DB, 'pocket', pocket.id, organizedBy)));
    currentPocketSync.pockets = await decoratePocketsProvenance(env.COAST_CHAT_DB, currentPocketSync.pockets);
  }
  const syncedPockets = new Map();
  for (const pocket of [...(previousPocketSync?.pockets || []), ...(currentPocketSync?.pockets || [])]) {
    if (pocket?.id) syncedPockets.set(pocket.id, pocket);
  }
  const pocketSync = previousPocketSync && currentPocketSync ? {
    created: previousPocketSync.created + currentPocketSync.created,
    updated: previousPocketSync.updated + currentPocketSync.updated,
    suppressed: previousPocketSync.suppressed + currentPocketSync.suppressed,
    pockets: [...syncedPockets.values()],
  } : null;
  return {
    ok: true,
    degraded: Boolean(degradedReason),
    reason: degradedReason,
    soil: writtenSoil,
    ...(pocketSync ? { pocket_sync: pocketSync } : {}),
  };
}
