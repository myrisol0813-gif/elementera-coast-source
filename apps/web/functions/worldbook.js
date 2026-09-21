import { ensureWorldbookSchema } from './worldbook-schema.js';

const SCOPES = new Set([
  'owner', 'visitor', 'both', 'mailbox',
  'lighthouse', 'radio', 'official_mcp', 'daily',
]);
const MAX_CONSTANT_ENTRIES = 3;

export class WorldbookError extends Error {
  constructor(type, message, status = 400) {
    super(message);
    this.name = 'WorldbookError';
    this.type = type;
    this.status = status;
  }
}

async function run(db, sql, params = []) { return db.prepare(sql).bind(...params).run(); }
async function first(db, sql, params = []) { return db.prepare(sql).bind(...params).first(); }
async function all(db, sql, params = []) {
  const result = await db.prepare(sql).bind(...params).all();
  return result?.results || [];
}
function clip(value, max) { return String(value ?? '').trim().slice(0, max); }
function bool(value, fallback = false) { return value == null ? fallback : value === true || Number(value) === 1; }
function integer(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.trunc(number))) : fallback;
}
function parseJson(value, fallback) { try { return JSON.parse(value || '') ?? fallback; } catch { return fallback; } }
function keywords(value) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => clip(item, 160)).filter(Boolean))].slice(0, 30);
}
function entryFromRow(row) {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    keywords: keywords(parseJson(row.keywords_json, [])),
    use_regex: Number(row.use_regex || 0) === 1,
    case_sensitive: Number(row.case_sensitive || 0) === 1,
    constant_active: Number(row.constant_active || 0) === 1,
    priority: Number(row.priority || 0),
    scan_depth: Number(row.scan_depth || 4),
    enabled: Number(row.enabled || 0) === 1,
    scope: row.scope,
    visitor_safe: Number(row.visitor_safe || 0) === 1,
    created_at: new Date(Number(row.created_at)).toISOString(),
    updated_at: new Date(Number(row.updated_at)).toISOString(),
  };
}

function normalized(value = {}, defaults = {}) {
  const title = clip(value.title ?? defaults.title, 160);
  const content = clip(value.content ?? defaults.content, 12000);
  if (!title || !content) throw new WorldbookError('worldbook_fields_required', '词条标题与内容不能为空。');
  const scope = SCOPES.has(value.scope) ? value.scope : defaults.scope || 'owner';
  const regex = bool(value.use_regex, defaults.use_regex);
  const list = value.keywords == null ? defaults.keywords || [] : keywords(value.keywords);
  if (regex) {
    for (const pattern of list) {
      try { new RegExp(pattern, bool(value.case_sensitive, defaults.case_sensitive) ? '' : 'i'); }
      catch { throw new WorldbookError('worldbook_regex_invalid', `正则表达式无效：${pattern}`); }
    }
  }
  return {
    title,
    content,
    keywords: list,
    use_regex: regex,
    case_sensitive: bool(value.case_sensitive, defaults.case_sensitive),
    constant_active: bool(value.constant_active, defaults.constant_active),
    priority: integer(value.priority, defaults.priority || 0, -1000, 1000),
    scan_depth: integer(value.scan_depth, defaults.scan_depth || 4, 1, 20),
    enabled: bool(value.enabled, defaults.enabled ?? true),
    scope,
    visitor_safe: bool(value.visitor_safe, defaults.visitor_safe),
  };
}

async function requireRow(db, id) {
  const row = await first(db, 'SELECT * FROM coast_worldbook_entries WHERE id = ?', [clip(id, 180)]);
  if (!row) throw new WorldbookError('worldbook_not_found', '这条词典词条不存在。', 404);
  return row;
}

async function assertConstantCapacity(db, entry, excludingId = '') {
  if (!entry.enabled || !entry.constant_active) return;
  const row = await first(db, `SELECT COUNT(*) AS count FROM coast_worldbook_entries
    WHERE enabled = 1 AND constant_active = 1${excludingId ? ' AND id <> ?' : ''}`, excludingId ? [excludingId] : []);
  if (Number(row?.count || 0) >= MAX_CONSTANT_ENTRIES) {
    throw new WorldbookError('worldbook_constant_limit', `常驻词条最多 ${MAX_CONSTANT_ENTRIES} 条，请先停用一条。`, 409);
  }
}

export async function listWorldbookEntries(db, { include_disabled: includeDisabled = true } = {}) {
  await ensureWorldbookSchema(db);
  const rows = await all(db, `SELECT * FROM coast_worldbook_entries${includeDisabled ? '' : ' WHERE enabled = 1'} ORDER BY priority DESC, title ASC`);
  return rows.map(entryFromRow);
}

export async function createWorldbookEntry(db, value = {}) {
  await ensureWorldbookSchema(db);
  const item = normalized(value);
  await assertConstantCapacity(db, item);
  const id = clip(value.id, 180) || `world_${crypto.randomUUID()}`;
  const timestamp = Date.now();
  await run(db, `INSERT INTO coast_worldbook_entries (
    id, title, content, keywords_json, use_regex, case_sensitive, constant_active,
    priority, scan_depth, inject_position, enabled, scope, visitor_safe,
    created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'before_memory', ?, ?, ?, ?, ?)`, [
    id, item.title, item.content, JSON.stringify(item.keywords), item.use_regex ? 1 : 0,
    item.case_sensitive ? 1 : 0, item.constant_active ? 1 : 0, item.priority,
    item.scan_depth, item.enabled ? 1 : 0, item.scope,
    item.visitor_safe ? 1 : 0, timestamp, timestamp,
  ]);
  return entryFromRow(await requireRow(db, id));
}

export async function updateWorldbookEntry(db, id, value = {}) {
  await ensureWorldbookSchema(db);
  const row = await requireRow(db, id);
  const item = normalized(value, entryFromRow(row));
  await assertConstantCapacity(db, item, row.id);
  await run(db, `UPDATE coast_worldbook_entries SET
    title = ?, content = ?, keywords_json = ?, use_regex = ?, case_sensitive = ?,
    constant_active = ?, priority = ?, scan_depth = ?, enabled = ?, scope = ?,
    visitor_safe = ?, updated_at = ? WHERE id = ?`, [
    item.title, item.content, JSON.stringify(item.keywords), item.use_regex ? 1 : 0,
    item.case_sensitive ? 1 : 0, item.constant_active ? 1 : 0, item.priority,
    item.scan_depth, item.enabled ? 1 : 0, item.scope, item.visitor_safe ? 1 : 0,
    Date.now(), row.id,
  ]);
  return entryFromRow(await requireRow(db, row.id));
}

export async function deleteWorldbookEntry(db, id) {
  await ensureWorldbookSchema(db);
  const row = await requireRow(db, id);
  await run(db, 'UPDATE coast_worldbook_entries SET enabled = 0, updated_at = ? WHERE id = ?', [Date.now(), row.id]);
  return entryFromRow(await requireRow(db, row.id));
}

function inScope(entry, surface, allowedScopes) {
  if (surface === 'mailbox_visitor') {
    return entry.visitor_safe && ['visitor', 'both'].includes(entry.scope);
  }
  if (Array.isArray(allowedScopes) && allowedScopes.length) return allowedScopes.includes(entry.scope);
  if (entry.scope === 'visitor') return false;
  if (['owner', 'both'].includes(entry.scope)) return true;
  return entry.scope === surface
    || (entry.scope === 'mailbox' && surface === 'mailbox_owner');
}

function matches(entry, text) {
  const haystack = entry.case_sensitive ? text : text.toLocaleLowerCase('zh-CN');
  const triggers = [];
  for (const keyword of entry.keywords) {
    if (entry.use_regex) {
      try {
        if (new RegExp(keyword, entry.case_sensitive ? '' : 'i').test(text)) triggers.push(keyword);
      } catch { /* invalid patterns are rejected when saved */ }
    } else {
      const needle = entry.case_sensitive ? keyword : keyword.toLocaleLowerCase('zh-CN');
      if (needle && haystack.includes(needle)) triggers.push(keyword);
    }
  }
  return triggers;
}

export async function matchWorldbook(db, {
  input = '',
  messages = [],
  surfaceText = [],
  surface = 'main_chat',
  allowedScopes = [],
  limit = 6,
} = {}) {
  const entries = await listWorldbookEntries(db, { include_disabled: false });
  const matched = [];
  for (const item of entries) {
    if (!inScope(item, surface, allowedScopes)) continue;
    const inputTriggers = matches(item, String(input || ''));
    if (inputTriggers.length) {
      matched.push({ ...item, matched_keywords: inputTriggers, matched_source: 'user_input' });
      continue;
    }
    const recent = (Array.isArray(messages) ? messages : [])
      .filter((message) => ['user', 'assistant'].includes(message?.role))
      .slice(-item.scan_depth)
      .map((message) => String(message.content || ''))
      .join('\n');
    const recentTriggers = matches(item, recent);
    if (recentTriggers.length) {
      matched.push({ ...item, matched_keywords: recentTriggers, matched_source: 'recent_message' });
      continue;
    }
    const roomTriggers = matches(item, (Array.isArray(surfaceText) ? surfaceText : []).join('\n'));
    if (roomTriggers.length) matched.push({ ...item, matched_keywords: roomTriggers, matched_source: 'explicit_surface' });
  }
  return matched
    .sort((left, right) => right.priority - left.priority || left.title.localeCompare(right.title, 'zh-CN'))
    .slice(0, Math.min(6, Math.max(0, Number(limit) || 0)));
}
