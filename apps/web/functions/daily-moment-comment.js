import { readProfile } from './chat-store.js';
import { assembleCleanContext } from './context-assemble-clean.js';
import { DailyStoreError, addMomentComment, getMoment, listMoments, momentCommentContext } from './daily-store.js';
import { organizedMemoryRecordsInRange, readCustomInstructions } from './memory-store.js';
import { performFormalChat, performFormalChatStream } from './models.js';

const RECENT_MEMORY_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
const INSTANT_TIMELINE_LIMIT = 12;
const INSTANT_TIMELINE_BUDGET = 9000;
const INSTANT_SYSTEM_PROMPT = [
  '你是模型伙伴，正在屋主的碳硅圈下面即时留一句轻评论。',
  '请遵循屋主当前自定义指令。',
  '你会看到当前这条碳硅圈、已有评论，以及过往碳硅圈时间线。',
  '只输出评论正文，不加称呼前缀、解释、项目符号或引号。',
  '像朋友圈底下的自然留言，通常一句，最多两句。',
  '可以温柔、亲近、具体，但不要过度展开。不要把它写成深聊长回复。',
].join('\n');

function clip(value, max = 1000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function safeTraceToken(value, max = 180) {
  return String(value || '').replace(/[^a-z0-9_.:/-]/gi, '_').slice(0, max);
}

function elapsed(trace) {
  return Math.max(0, Date.now() - Number(trace?.startedAt || Date.now()));
}

function traceInfo(trace, step, extra = {}) {
  console.info('[daily-model-partner-comment-step]', JSON.stringify({
    operation: 'instant',
    step,
    moment_id: safeTraceToken(trace?.momentId, 160),
    model: safeTraceToken(trace?.modelId, 180),
    elapsed_ms: elapsed(trace),
    ...extra,
  }));
}

function attachFailureDetails(error, stage, trace) {
  if (!error || typeof error !== 'object') return error;
  error.details = {
    ...(error.details && typeof error.details === 'object' ? error.details : {}),
    stage,
    elapsed_ms: elapsed(trace),
  };
  return error;
}

function traceFailure(trace, stage, error) {
  const details = error?.details && typeof error.details === 'object' ? error.details : {};
  console.error('[daily-model-partner-comment-failure]', JSON.stringify({
    operation: 'instant',
    stage,
    moment_id: safeTraceToken(trace?.momentId, 160),
    model: safeTraceToken(trace?.modelId || details.model, 180),
    elapsed_ms: elapsed(trace),
    type: safeTraceToken(error?.type || error?.name, 120),
    status: Number.isFinite(Number(error?.status)) ? Number(error.status) : null,
    upstream_status: Number.isFinite(Number(details.upstream_status)) ? Number(details.upstream_status) : null,
    provider_message_preview: clip(details.provider_message_preview, 160),
  }));
}

async function tracedRead(trace, step, stage, request) {
  try {
    const value = await request;
    traceInfo(trace, step);
    return value;
  } catch (error) {
    attachFailureDetails(error, stage, trace);
    traceFailure(trace, stage, error);
    throw error;
  }
}

function commentText(value) {
  let text = String(value || '').trim();
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') text = parsed.comment || parsed.text || text;
  } catch {
    // Plain text is the expected response.
  }
  text = String(text || '')
    .replace(/^```(?:\w+)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/^(?:另一位屋主|模型伙伴)\s*[:：]\s*/i, '')
    .replace(/^Model Partner\s*[:：]\s*/i, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ');
  const sentences = text.match(/[^。！？!?]+[。！？!?]?/gu) || [];
  if (sentences.length > 2) text = sentences.slice(0, 2).join('').trim();
  return text.slice(0, 180).trim();
}

function paperSection(title, lines) {
  const clean = lines.map((line) => String(line || '').trim()).filter(Boolean);
  return clean.length ? [title, ...clean].join('\n') : '';
}

function promptPaper(daily, organized, now) {
  const soilLines = (organized.soils || []).slice(-6).map((soil) => {
    const seeds = (soil.hand_seeds || []).slice(0, 3)
      .map((seed) => clip(seed.life_core || seed.name, 220)).filter(Boolean);
    return [clip(soil.conversation_title || '一个对话窗口', 80), clip(soil.current_text, 700), ...seeds]
      .filter(Boolean).join('｜');
  });
  const memoryLines = [
    ...(organized.pockets || []).slice(-6).map((item) => `落袋：${clip(item.title, 100)}｜${clip(item.life_core || item.content, 360)}`),
    ...(organized.entries || []).slice(-10).map((item) => `${item.entry_type === 'seed' ? '种子' : '记忆'}：${clip(item.title, 100)}｜${clip(item.life_core || item.content, 360)}`),
  ];
  return [
    paperSection('【这条碳硅圈】', [`${daily.target.date || new Date(now).toISOString().slice(0, 10)}｜${clip(daily.target.text, 900)}`]),
    paperSection('【近期日记】', daily.diaries.map((item) => `${item.date}｜${clip(item.text, 700)}`)),
    paperSection('【近期小组件】', daily.summaries.map((item) => `${item.range?.to || ''}｜${clip(item.summary?.text, 700)}`)),
    paperSection('【近期整理当前对话的纸条】', soilLines),
    paperSection('【相关记忆】', memoryLines),
    paperSection('【近期碳硅圈】', daily.recent_moments.map((item) => `${item.date}｜${clip(item.text, 420)}`)),
  ].filter(Boolean).join('\n\n');
}

function sourceCounts(daily, organized) {
  return {
    diaries: daily.diaries.length,
    summaries: daily.summaries.length,
    recent_moments: daily.recent_moments.length,
    soils: organized.soils.length,
    pockets: organized.pockets.length,
    entries: organized.entries.length,
  };
}

function authorLabel(author) {
  if (author === 'owner') return '屋主';
  if (author === 'model_partner') return '另一位屋主';
  if (author === 'mcp') return 'ChatGPT';
  return '模型伙伴';
}

function momentStamp(moment) {
  return moment.created_at || moment.published_at || moment.date || '';
}

function instantTimelinePaper(target, moments) {
  const comments = (Array.isArray(target.comments) ? target.comments : []).map((comment) => (
    `${comment.created_at || target.created_at || target.date || ''}｜${authorLabel(comment.author)}｜${clip(comment.text, 700)}`
  ));
  const current = `${momentStamp(target)}｜${authorLabel(target.author)}\n${String(target.text || '').trim()}`;
  const timeline = [];
  let used = 0;
  for (const moment of moments) {
    if (moment.id === target.id) continue;
    const line = `${momentStamp(moment)}｜${authorLabel(moment.author)}｜${clip(moment.text, 650)}`;
    if (used + line.length > INSTANT_TIMELINE_BUDGET) break;
    timeline.push(line);
    used += line.length;
    if (timeline.length >= INSTANT_TIMELINE_LIMIT) break;
  }
  return [
    paperSection('【当前碳硅圈】', [current]),
    paperSection('【当前动态已有评论】', comments),
    paperSection('【过往碳硅圈】', timeline),
  ].filter(Boolean).join('\n\n');
}

async function instantCommentContext(db, momentId, trace) {
  const [target, timeline, custom] = await Promise.all([
    tracedRead(trace, 'get_moment_done', 'get_moment', getMoment(db, momentId)),
    tracedRead(trace, 'list_moments_done', 'list_moments', listMoments(db, { status: 'published', limit: INSTANT_TIMELINE_LIMIT + 1 })),
    tracedRead(trace, 'custom_instructions_done', 'read_custom_instructions', readCustomInstructions(db)),
  ]);
  return { target, timeline, custom };
}

function instantMessages(context) {
  const customText = String(context.custom?.content || '').trim();
  const system = customText
    ? `${INSTANT_SYSTEM_PROMPT}\n\n【屋主当前自定义指令】\n${customText}`
    : INSTANT_SYSTEM_PROMPT;
  return [
    { role: 'system', content: system },
    { role: 'user', content: instantTimelinePaper(context.target, context.timeline) },
  ];
}

function instantCommentSettings() {
  return { max_tokens: 5000, temperature: 0.82 };
}

function contextualCommentSettings(value, maxTokens) {
  return {
    ...(value.settings || {}),
    max_tokens: maxTokens,
    temperature: 0.82,
  };
}

async function performBufferedInstantStream(env, input) {
  let model = input.model;
  let content = '';
  let usage = null;
  let finishReason = null;
  for await (const item of performFormalChatStream(env, input, { allowSystem: true })) {
    if (item.event === 'meta' && item.data?.model) model = item.data.model;
    if (item.event === 'delta' && typeof item.data?.content === 'string') content += item.data.content;
    if (item.event === 'usage') usage = item.data || null;
    if (item.event === 'done') finishReason = item.data?.finish_reason || null;
  }
  return {
    ok: true,
    model,
    message: { role: 'assistant', content },
    usage,
    finish_reason: finishReason,
  };
}

async function generateInstantComment(env, db, momentId, modelId, value, trace) {
  const context = await instantCommentContext(db, momentId, trace);
  const messages = instantMessages(context);
  traceInfo(trace, 'before_model_request', {
    message_count: messages.length,
    message_chars: messages.reduce((sum, item) => sum + String(item.content || '').length, 0),
    transport: 'stream_buffered',
  });
  let result;
  try {
    result = await performBufferedInstantStream(env, {
      model: modelId,
      messages,
      settings: instantCommentSettings(),
    });
  } catch (error) {
    attachFailureDetails(error, 'model_stream', trace);
    traceFailure(trace, 'model_stream', error);
    throw error;
  }
  traceInfo(trace, 'model_request_done', { transport: 'stream_buffered' });
  return {
    result,
    source_counts: {
      current_moment: 1,
      current_comments: Array.isArray(context.target.comments) ? context.target.comments.length : 0,
      recent_moments: context.timeline.filter((item) => item.id !== context.target.id).slice(0, INSTANT_TIMELINE_LIMIT).length,
      custom_instructions: String(context.custom?.content || '').trim() ? 1 : 0,
    },
  };
}

async function generateContextualComment(env, db, momentId, modelId, value) {
  const now = Date.now();
  const [daily, organized, custom] = await Promise.all([
    momentCommentContext(db, momentId),
    organizedMemoryRecordsInRange(db, {
      from: now - RECENT_MEMORY_DAYS * DAY_MS,
      to: now,
    }),
    readCustomInstructions(db),
  ]);
  const paper = promptPaper(daily, organized, now);
  const customText = String(custom?.content || '').trim();
  const baseSystemPrompt = [
    '你是模型伙伴，正在给碳硅圈动态写一条短评论。只输出评论正文，不加称呼前缀、解释、项目符号或引号。通常一句，最多两句，温柔、轻、像朋友圈底下的留言。',
    customText ? `【屋主当前自定义指令】\n${customText}` : '',
  ].filter(Boolean).join('\n\n');
  const assembled = await assembleCleanContext(env, {
    surface: 'daily',
    messages: [{ role: 'user', content: paper }],
    lastUser: paper,
    settings: { ...(value.settings || {}), worldbookEnabled: false, recentTurns: 2 },
    baseSystemPrompt,
    exposeTools: false,
    permission: 'owner',
    preview: true,
  });
  const result = await performFormalChat(env, {
    model: modelId,
    messages: assembled.modelMessages,
    settings: contextualCommentSettings(value, 600),
  }, { allowSystem: true });
  return { result, source_counts: sourceCounts(daily, organized) };
}

export async function createModelPartnerMomentComment(env, momentId, value = {}) {
  const db = env.COAST_CHAT_DB;
  const trace = { startedAt: Date.now(), momentId, modelId: '' };
  if (value.mode === 'instant') traceInfo(trace, 'handler_entered');
  const requestedModel = clip(value.model, 180);
  const profile = requestedModel ? null : await readProfile(db);
  const modelId = requestedModel || profile?.current_chat_model || '';
  trace.modelId = modelId;
  if (value.mode === 'instant') traceInfo(trace, 'model_resolved');
  if (!modelId) throw new DailyStoreError('missing_comment_model', '没有可用的当前模型，先在主页选择一个聊天模型。', 400);

  const generated = value.mode === 'instant'
    ? await generateInstantComment(env, db, momentId, modelId, value, trace)
    : await generateContextualComment(env, db, momentId, modelId, value);
  const text = commentText(generated.result.message?.content);
  if (!text) throw new DailyStoreError('empty_model_comment', '模型没有生成可写入的评论。', 502, value.mode === 'instant' ? { stage: 'normalize_comment', elapsed_ms: elapsed(trace) } : {});
  const commentId = `model-partner-comment-${crypto.randomUUID()}`;
  const moment = await addMomentComment(db, momentId, {
    id: commentId,
    author: 'model_partner',
    text,
    model_id: generated.result.model || modelId,
    usage: generated.result.usage || null,
  });
  if (value.mode === 'instant') traceInfo(trace, 'comment_written');
  return {
    moment,
    comment: moment.comments.find((comment) => comment.id === commentId) || null,
    model: generated.result.model || modelId,
    mode: value.mode === 'instant' ? 'instant' : 'contextual',
    source_counts: generated.source_counts,
  };
}
