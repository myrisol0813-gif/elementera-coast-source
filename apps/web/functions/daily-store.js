import { ensureDailySchema } from './daily-schema.js';
import { validateCoastIdentity } from './coast-identity.js';

const AUTHORS = new Set(['owner', 'model_partner', 'api', 'mcp']);
const SOURCES = new Set(['manual', 'chat_tool']);
const MOMENT_STATUSES = new Set(['published']);
const MAX_TEXT = 24000;

export class DailyStoreError extends Error {
  constructor(type, message, status = 400, details = {}) {
    super(message);
    this.name = 'DailyStoreError';
    this.type = type;
    this.status = status;
    this.details = details;
  }
}

export function hasDailyDatabase(env) { return Boolean(env?.COAST_CHAT_DB && typeof env.COAST_CHAT_DB.prepare === 'function'); }
async function run(db, sql, params = []) { return db.prepare(sql).bind(...params).run(); }
async function first(db, sql, params = []) { return db.prepare(sql).bind(...params).first(); }
async function all(db, sql, params = []) { const result = await db.prepare(sql).bind(...params).all(); return result?.results || []; }
function clip(value, max = MAX_TEXT) { return String(value ?? '').trim().slice(0, max); }
function cleanId(value, prefix = 'daily') { const clean = String(value || '').replace(/[^\w:.-]/g, '_').slice(0, 160); return clean || `${prefix}_${crypto.randomUUID()}`; }
function optionalId(value) { return value ? cleanId(value, 'ref') : null; }
function trustedOrValue(defaults, key, value) { return Object.prototype.hasOwnProperty.call(defaults, key) ? defaults[key] : value; }
function enumValue(value, allowed, fallback, label) { const clean = String(value || fallback || '').trim(); if (!allowed.has(clean)) throw new DailyStoreError('invalid_daily_field', `${label}无效。`, 400); return clean; }
function dateKey(value, fallback = new Date()) {
  const clean = String(value || '').trim();
  const parsed = new Date(`${clean}T00:00:00.000Z`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean) && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === clean) return clean;
  if (value) throw new DailyStoreError('invalid_daily_date', '日期格式无效。', 400);
  return fallback.toISOString().slice(0, 10);
}
function optionalIso(value) { const timestamp = Number(value || 0); return Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp).toISOString() : null; }
function iso(value) { return optionalIso(value) || new Date().toISOString(); }
function parseJson(value, fallback) { try { return JSON.parse(value || '') ?? fallback; } catch { return fallback; } }
function tags(value) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => clip(item, 80)).filter(Boolean))].slice(0, 20);
}
function normalizeUsage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = {};
  for (const field of ['prompt_tokens', 'completion_tokens', 'reasoning_tokens', 'cached_tokens', 'total_tokens']) {
    const raw = value[field];
    if (raw == null || raw === '') continue;
    const number = Number(raw);
    if (!Number.isFinite(number) || number < 0) continue;
    result[field] = Math.trunc(number);
  }
  if (result.total_tokens == null && result.prompt_tokens != null && result.completion_tokens != null) {
    result.total_tokens = result.prompt_tokens + result.completion_tokens;
  }
  return Object.keys(result).length ? result : null;
}
function normalizedIdentity(defaults = {}) {
  if (!defaults.identity) return { actor: null, surface: null, model_label: null, model_nickname: null, symbol: null, display_author: null };
  try { return validateCoastIdentity(defaults.identity); } catch { throw new DailyStoreError('invalid_daily_identity', '日报来源身份无效。', 400); }
}
function provenanceFromRow(row) {
  const inferredSurface = row.author === 'mcp' ? 'official_mcp' : ['api', 'model_partner'].includes(row.author) ? 'coast_api' : 'web_manual';
  const surface = row.surface || inferredSurface;
  return {
    actor: row.actor || (surface === 'web_manual' ? 'owner' : 'model_partner'), surface,
    model_label: row.model_label || null, model_nickname: row.model_nickname || null,
    symbol: row.symbol ?? (surface === 'official_mcp' ? '≋' : surface === 'coast_api' ? '✦' : ''),
    display_author: row.display_author || (surface === 'official_mcp' ? 'ChatGPT≋' : surface === 'coast_api' ? '前端 API ✦' : '屋主'),
  };
}
function commentFromRow(row) {
  return {
    id: row.id,
    moment_id: row.moment_id,
    author: row.author,
    text: row.text || '',
    model_id: row.model_id || null,
    usage: normalizeUsage(parseJson(row.usage_json, null)),
    created_at: iso(row.created_at),
  };
}
function momentFromRow(row, comments = [], like = {}) {
  return {
    id: row.id, date: row.date, author: row.author, source: row.source, status: row.status, text: row.text || '',
    conversation_id: row.conversation_id || null, source_turn_id: row.source_turn_id || null, tool_call_id: row.tool_call_id || null,
    ...provenanceFromRow(row), reason: row.reason || '', published_at: optionalIso(row.published_at), created_at: iso(row.created_at), updated_at: iso(row.updated_at),
    like_count: Number(like.like_count || 0), liked: Number(like.liked || 0) === 1, comments,
  };
}
async function hydrateMoments(db, rows, actor = 'owner') {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const placeholders = ids.map(() => '?').join(',');
  const commentRows = await all(db, `SELECT id, moment_id, author, text, model_id, usage_json, created_at FROM daily_moment_comments WHERE moment_id IN (${placeholders}) ORDER BY created_at ASC`, ids);
  const likeRows = await all(db, `SELECT moment_id, COUNT(*) AS like_count, MAX(CASE WHEN actor = ? THEN 1 ELSE 0 END) AS liked FROM daily_moment_likes WHERE moment_id IN (${placeholders}) GROUP BY moment_id`, [actor, ...ids]);
  const comments = new Map();
  for (const row of commentRows) { const list = comments.get(row.moment_id) || []; list.push(commentFromRow(row)); comments.set(row.moment_id, list); }
  const likes = new Map(likeRows.map((row) => [row.moment_id, row]));
  return rows.map((row) => momentFromRow(row, comments.get(row.id) || [], likes.get(row.id) || {}));
}
async function requireMomentRow(db, id) { const row = await first(db, 'SELECT * FROM daily_moments WHERE id = ?', [cleanId(id, 'moment')]); if (!row) throw new DailyStoreError('moment_not_found', '这条碳硅圈动态不存在。', 404); return row; }

export async function listMoments(db, filters = {}) {
  await ensureDailySchema(db);
  const clauses = []; const params = [];
  if (filters.status) { clauses.push('status = ?'); params.push(enumValue(filters.status, MOMENT_STATUSES, '', '动态状态')); }
  if (filters.date) { clauses.push('date = ?'); params.push(dateKey(filters.date)); }
  const limit = Math.min(300, Math.max(1, Number(filters.limit || 200)));
  const rows = await all(db, `SELECT * FROM daily_moments ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY COALESCE(published_at, created_at) DESC, created_at DESC LIMIT ?`, [...params, limit]);
  return hydrateMoments(db, rows, filters.actor || 'owner');
}
export async function getMoment(db, id, actor = 'owner') { await ensureDailySchema(db); return (await hydrateMoments(db, [await requireMomentRow(db, id)], actor))[0]; }
function normalizeMoment(value = {}, defaults = {}) {
  const now = Date.now(); const text = clip(value.text, 12000);
  if (!text) throw new DailyStoreError('empty_moment', '碳硅圈动态需要正文。', 400);
  return {
    id: cleanId(value.id, 'moment'), date: dateKey(value.date, new Date(now)), author: enumValue(trustedOrValue(defaults, 'author', value.author), AUTHORS, 'owner', '动态作者'),
    source: enumValue(trustedOrValue(defaults, 'source', value.source), SOURCES, 'manual', '动态来源'), status: 'published', text,
    conversation_id: optionalId(trustedOrValue(defaults, 'conversation_id', value.conversation_id)), source_turn_id: optionalId(trustedOrValue(defaults, 'source_turn_id', value.source_turn_id)),
    tool_call_id: optionalId(trustedOrValue(defaults, 'tool_call_id', value.tool_call_id)), ...normalizedIdentity(defaults), reason: clip(value.reason, 1000),
    published_at: now, created_at: now, updated_at: now,
  };
}
export async function createMoment(db, value = {}, defaults = {}) {
  await ensureDailySchema(db); const item = normalizeMoment(value, defaults);
  if (item.tool_call_id) { const existing = await first(db, 'SELECT id FROM daily_moments WHERE tool_call_id = ?', [item.tool_call_id]); if (existing) return getMoment(db, existing.id); }
  await run(db, `INSERT INTO daily_moments (id, date, author, source, status, text, conversation_id, source_turn_id, tool_call_id, actor, surface, model_label, model_nickname, symbol, display_author, reason, published_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    item.id, item.date, item.author, item.source, item.status, item.text, item.conversation_id, item.source_turn_id, item.tool_call_id, item.actor, item.surface,
    item.model_label, item.model_nickname, item.symbol, item.display_author, item.reason || null, item.published_at, item.created_at, item.updated_at,
  ]);
  return getMoment(db, item.id);
}
export async function patchMoment(db, id, value = {}) {
  await ensureDailySchema(db); const row = await requireMomentRow(db, id); const updates = []; const params = [];
  if (Object.prototype.hasOwnProperty.call(value, 'date')) { updates.push('date = ?'); params.push(dateKey(value.date)); }
  if (Object.prototype.hasOwnProperty.call(value, 'text')) { const text = clip(value.text, 12000); if (!text) throw new DailyStoreError('empty_moment', '碳硅圈动态需要正文。', 400); updates.push('text = ?'); params.push(text); }
  if (Object.prototype.hasOwnProperty.call(value, 'reason')) { updates.push('reason = ?'); params.push(clip(value.reason, 1000) || null); }
  if (!updates.length) throw new DailyStoreError('empty_patch', '没有可更新的动态字段。', 400);
  updates.push('updated_at = ?'); params.push(Date.now(), row.id); await run(db, `UPDATE daily_moments SET ${updates.join(', ')} WHERE id = ?`, params); return getMoment(db, row.id);
}
export async function deleteMoment(db, id) { await ensureDailySchema(db); const row = await requireMomentRow(db, id); await run(db, 'DELETE FROM daily_moment_comments WHERE moment_id = ?', [row.id]); await run(db, 'DELETE FROM daily_moment_likes WHERE moment_id = ?', [row.id]); await run(db, 'DELETE FROM daily_moments WHERE id = ?', [row.id]); return momentFromRow(row); }
export async function addMomentComment(db, id, value = {}) {
  await ensureDailySchema(db); const momentId = (await requireMomentRow(db, id)).id; const text = clip(value.text, 2000);
  if (!text) throw new DailyStoreError('empty_comment', '评论不能为空。', 400);
  const commentId = cleanId(value.id, 'moment_comment');
  const usage = normalizeUsage(value.usage);
  await run(db, `INSERT OR IGNORE INTO daily_moment_comments (id, moment_id, author, text, model_id, usage_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, [
    commentId,
    momentId,
    enumValue(value.author, AUTHORS, 'owner', '评论作者'),
    text,
    clip(value.model_id, 180) || null,
    usage ? JSON.stringify(usage) : null,
    Date.now(),
  ]);
  await run(db, 'UPDATE daily_moments SET updated_at = ? WHERE id = ?', [Date.now(), momentId]); return getMoment(db, momentId, value.author || 'owner');
}
export async function deleteMomentComment(db, id, commentId) {
  await ensureDailySchema(db); const momentId = (await requireMomentRow(db, id)).id; const cleanCommentId = cleanId(commentId, 'moment_comment');
  const row = await first(db, 'SELECT id FROM daily_moment_comments WHERE id = ? AND moment_id = ?', [cleanCommentId, momentId]); if (!row) throw new DailyStoreError('moment_comment_not_found', '这条评论不存在。', 404);
  await run(db, 'DELETE FROM daily_moment_comments WHERE id = ? AND moment_id = ?', [cleanCommentId, momentId]); await run(db, 'UPDATE daily_moments SET updated_at = ? WHERE id = ?', [Date.now(), momentId]); return getMoment(db, momentId);
}
export async function setMomentLike(db, id, liked, actorValue = 'owner') {
  await ensureDailySchema(db); const momentId = (await requireMomentRow(db, id)).id; const actor = enumValue(actorValue, AUTHORS, 'owner', '点赞者');
  if (liked) await run(db, `INSERT OR IGNORE INTO daily_moment_likes (moment_id, actor, created_at) VALUES (?, ?, ?)`, [momentId, actor, Date.now()]);
  else await run(db, 'DELETE FROM daily_moment_likes WHERE moment_id = ? AND actor = ?', [momentId, actor]);
  await run(db, 'UPDATE daily_moments SET updated_at = ? WHERE id = ?', [Date.now(), momentId]); return getMoment(db, momentId, actor);
}

function diaryFromRow(row) {
  return { id: row.id, date: row.date, author: row.author, source: row.source, weather: row.weather || '未标注', mood: row.mood || '未标注', tags: tags(parseJson(row.tags_json, [])), text: row.text || '', conversation_id: row.conversation_id || null, source_turn_id: row.source_turn_id || null, tool_call_id: row.tool_call_id || null, ...provenanceFromRow(row), created_at: iso(row.created_at), updated_at: iso(row.updated_at) };
}
export async function listDiaries(db, filters = {}) {
  await ensureDailySchema(db); const clauses = []; const params = [];
  if (filters.date) { clauses.push('date = ?'); params.push(dateKey(filters.date)); }
  if (filters.author) { clauses.push('author = ?'); params.push(enumValue(filters.author, AUTHORS, '', '日记作者')); }
  const rows = await all(db, `SELECT * FROM daily_diaries ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY date DESC, created_at DESC LIMIT 300`, params); return rows.map(diaryFromRow);
}
function normalizeDiary(value = {}, defaults = {}) {
  const now = Date.now(); const text = clip(value.text); if (!text) throw new DailyStoreError('empty_diary', '日记需要正文。', 400);
  return { id: cleanId(value.id, 'diary'), date: dateKey(value.date, new Date(now)), author: enumValue(trustedOrValue(defaults, 'author', value.author), AUTHORS, 'owner', '日记作者'), source: enumValue(trustedOrValue(defaults, 'source', value.source), SOURCES, 'manual', '日记来源'), weather: clip(value.weather || '未标注', 80), mood: clip(value.mood || '未标注', 120), tags: tags(value.tags), text, conversation_id: optionalId(trustedOrValue(defaults, 'conversation_id', value.conversation_id)), source_turn_id: optionalId(trustedOrValue(defaults, 'source_turn_id', value.source_turn_id)), tool_call_id: optionalId(trustedOrValue(defaults, 'tool_call_id', value.tool_call_id)), ...normalizedIdentity(defaults), created_at: now, updated_at: now };
}
async function matchingDiaries(db, date, author) { return all(db, 'SELECT * FROM daily_diaries WHERE date = ? AND author = ? ORDER BY created_at DESC', [date, author]); }
export async function createDiary(db, value = {}, defaults = {}) {
  await ensureDailySchema(db); const item = normalizeDiary(value, defaults);
  if (item.tool_call_id) { const existingByToolCall = await first(db, 'SELECT * FROM daily_diaries WHERE tool_call_id = ?', [item.tool_call_id]); if (existingByToolCall) return diaryFromRow(existingByToolCall); }
  const existing = await matchingDiaries(db, item.date, item.author); const mode = String(value.conflict_mode || '').trim();
  if (existing.length && !['append', 'replace'].includes(mode)) throw new DailyStoreError('diary_conflict', '同日同作者已有日记，请明确选择追加或替换。', 409, { existing_ids: existing.map((row) => row.id) });
  if (mode === 'replace' && existing.length) {
    const target = existing.find((row) => row.id === value.replace_id) || existing[0];
    await run(db, `UPDATE daily_diaries SET source = ?, weather = ?, mood = ?, tags_json = ?, text = ?, conversation_id = ?, source_turn_id = ?, tool_call_id = ?, actor = ?, surface = ?, model_label = ?, model_nickname = ?, symbol = ?, display_author = ?, updated_at = ? WHERE id = ?`, [item.source, item.weather, item.mood, JSON.stringify(item.tags), item.text, item.conversation_id, item.source_turn_id, item.tool_call_id, item.actor, item.surface, item.model_label, item.model_nickname, item.symbol, item.display_author, item.updated_at, target.id]);
    return diaryFromRow(await first(db, 'SELECT * FROM daily_diaries WHERE id = ?', [target.id]));
  }
  await run(db, `INSERT INTO daily_diaries (id, date, author, source, weather, mood, tags_json, text, conversation_id, source_turn_id, tool_call_id, actor, surface, model_label, model_nickname, symbol, display_author, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [item.id, item.date, item.author, item.source, item.weather, item.mood, JSON.stringify(item.tags), item.text, item.conversation_id, item.source_turn_id, item.tool_call_id, item.actor, item.surface, item.model_label, item.model_nickname, item.symbol, item.display_author, item.created_at, item.updated_at]);
  return diaryFromRow(await first(db, 'SELECT * FROM daily_diaries WHERE id = ?', [item.id]));
}
export async function patchDiary(db, id, value = {}) {
  await ensureDailySchema(db); const diaryId = cleanId(id, 'diary'); const row = await first(db, 'SELECT * FROM daily_diaries WHERE id = ?', [diaryId]); if (!row) throw new DailyStoreError('diary_not_found', '这张日记纸页不存在。', 404);
  const updates = []; const params = [];
  if (Object.prototype.hasOwnProperty.call(value, 'date')) {
    const nextDate = dateKey(value.date);
    if (nextDate !== row.date) {
      const conflicts = (await matchingDiaries(db, nextDate, row.author)).filter((entry) => entry.id !== diaryId);
      if (conflicts.length) throw new DailyStoreError('diary_conflict', '目标日期已有同作者日记，请先处理那张纸页。', 409, { existing_ids: conflicts.map((entry) => entry.id) });
    }
    updates.push('date = ?'); params.push(nextDate);
  }
  for (const [field, column, max] of [['weather', 'weather', 80], ['mood', 'mood', 120], ['text', 'text', MAX_TEXT]]) {
    if (Object.prototype.hasOwnProperty.call(value, field)) { const clean = clip(value[field], max); if (field === 'text' && !clean) throw new DailyStoreError('empty_diary', '日记需要正文。', 400); updates.push(`${column} = ?`); params.push(clean); }
  }
  if (Object.prototype.hasOwnProperty.call(value, 'tags')) { updates.push('tags_json = ?'); params.push(JSON.stringify(tags(value.tags))); }
  if (!updates.length) throw new DailyStoreError('empty_patch', '没有可更新的日记字段。', 400);
  updates.push('updated_at = ?'); params.push(Date.now(), diaryId); await run(db, `UPDATE daily_diaries SET ${updates.join(', ')} WHERE id = ?`, params); return diaryFromRow(await first(db, 'SELECT * FROM daily_diaries WHERE id = ?', [diaryId]));
}
export async function deleteDiary(db, id) { await ensureDailySchema(db); const diaryId = cleanId(id, 'diary'); const row = await first(db, 'SELECT * FROM daily_diaries WHERE id = ?', [diaryId]); if (!row) throw new DailyStoreError('diary_not_found', '这张日记纸页不存在。', 404); await run(db, 'DELETE FROM daily_diaries WHERE id = ?', [diaryId]); return diaryFromRow(row); }
export async function momentCommentContext(db, id, { diaryLimit = 8, momentLimit = 5 } = {}) {
  await ensureDailySchema(db); const target = await getMoment(db, id);
  const diaries = await all(db, 'SELECT * FROM daily_diaries ORDER BY date DESC, created_at DESC LIMIT ?', [Math.min(20, Math.max(1, Number(diaryLimit || 8)))]);
  const momentRows = await all(db, `SELECT * FROM daily_moments WHERE id <> ? AND status = 'published' ORDER BY COALESCE(published_at, created_at) DESC, created_at DESC LIMIT ?`, [target.id, Math.min(20, Math.max(1, Number(momentLimit || 5)))]);
  return { target, diaries: diaries.map(diaryFromRow), recent_moments: await hydrateMoments(db, momentRows) };
}
