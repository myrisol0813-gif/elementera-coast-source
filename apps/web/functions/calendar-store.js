import { anniversaryCalendarDay } from './calendar-anniversary.js';
// Independent, non-destructive Gregorian calendar. Never restores legacy coast_calendar_* tables.
export const CALENDAR_LIMITS = Object.freeze({ title: 120, body: 4000, yearMin: 1900, yearMax: 2200 });
const schemaPromises = new WeakMap();

export class CalendarError extends Error {
  constructor(type, message, status = 400) {
    super(message);
    this.name = 'CalendarError';
    this.type = type;
    this.status = status;
  }
}

function validDay(value) {
  const raw = String(value || '');
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return false;
  const year = Number(match[1]);
  if (year < CALENDAR_LIMITS.yearMin || year > CALENDAR_LIMITS.yearMax) return false;
  const d = new Date(Date.UTC(year, Number(match[2]) - 1, Number(match[3])));
  return d.toISOString().slice(0, 10) === raw;
}

function requireDay(value) {
  if (!validDay(value)) throw new CalendarError('invalid_day', '请填写有效的公历日期（1900—2200）。');
  return value;
}

function requireMonth(value) {
  if (!/^\d{4}-\d{2}$/.test(String(value || '')) || !validDay(`${value}-01`)) {
    throw new CalendarError('invalid_month', '月份应为 YYYY-MM 格式。');
  }
  return value;
}

function safeText(value, limit, label, { required = false } = {}) {
  const text = String(value ?? '').trim();
  if (required && !text) throw new CalendarError('required_field', `请填写${label}。`);
  if (text.length > limit) throw new CalendarError('field_too_long', `${label}最多 ${limit} 字。`);
  return text;
}

function validate(value, { patch = false } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CalendarError('invalid_request', '日历内容必须是对象。');
  const allowed = new Set(['day', 'title', 'body', 'kind', 'recurrence', 'anniversary']);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new CalendarError('invalid_field', '日历中含有不支持的字段。');
  if (patch && !Object.keys(value).length) throw new CalendarError('empty_patch', '没有需要修改的内容。');
  const out = {};
  if (!patch || Object.hasOwn(value, 'day')) out.day = requireDay(value.day);
  if (!patch || Object.hasOwn(value, 'title')) out.title = safeText(value.title, CALENDAR_LIMITS.title, '标题', { required: true });
  if (!patch || Object.hasOwn(value, 'body')) out.body = safeText(value.body, CALENDAR_LIMITS.body, '记录内容');
  if (!patch || Object.hasOwn(value, 'kind')) {
    out.kind = value.kind || 'event';
    if (!['event', 'note'].includes(out.kind)) throw new CalendarError('invalid_kind', '记录类型只能是日程或随记。');
  }
  if (!patch || Object.hasOwn(value, 'recurrence')) {
    out.recurrence = value.recurrence || 'none';
    if (!['none', 'yearly'].includes(out.recurrence)) throw new CalendarError('invalid_recurrence', '仅支持不重复或每年重复。');
  }
  if (Object.hasOwn(value, 'anniversary')) out.anniversary = validateAnniversary(value.anniversary);
  return out;
}

function validateAnniversary(value) {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['startDay', 'mode', 'targetDays', 'pinned'].includes(key))
    || typeof value.pinned !== 'boolean') {
    throw new CalendarError('invalid_anniversary', '纪念日需要起始日期、类型和侧栏显示设置。');
  }
  const anniversary = { startDay: value.startDay, mode: value.mode, targetDays: value.targetDays ?? null, pinned: value.pinned };
  try { anniversaryCalendarDay(anniversary); }
  catch { throw new CalendarError('invalid_anniversary', '纪念日日期或目标天数无效。'); }
  return anniversary;
}

function applyAnniversary(entry, patch, previous = null) {
  const anniversary = Object.hasOwn(patch, 'anniversary') ? patch.anniversary : previous;
  if (!anniversary) return { ...entry, anniversary: null };
  const day = anniversaryCalendarDay(anniversary);
  const recurrence = anniversary.mode === 'yearly' ? 'yearly' : 'none';
  // A plain calendar edit cannot silently detach or move an anniversary.
  if (!Object.hasOwn(patch, 'anniversary') &&
    ((Object.hasOwn(patch, 'day') && patch.day !== day) ||
      (Object.hasOwn(patch, 'recurrence') && patch.recurrence !== recurrence) ||
      (Object.hasOwn(patch, 'kind') && patch.kind !== 'event'))) {
    throw new CalendarError('anniversary_conflict', '请通过纪念日设置修改起始日期、类型或目标天数。');
  }
  return { ...entry, day, kind: 'event', recurrence, anniversary };
}

function anniversaryFromRow(row) {
  return row.anniversary_mode ? { startDay: row.anniversary_start_day, mode: row.anniversary_mode,
    targetDays: row.anniversary_target_days, pinned: Boolean(row.anniversary_pinned) } : null;
}

function anniversaryColumns(value) {
  return [value?.startDay ?? null, value?.mode ?? null, value?.targetDays ?? null, value?.pinned ? 1 : 0];
}

async function ensureColumn(db, name, definition) {
  const columns = () => db.prepare('PRAGMA table_info(coast_calendar_entries_v2)').all();
  if ((await columns()).results.some(row => row.name === name)) return;
  try { await db.prepare('ALTER TABLE coast_calendar_entries_v2 ADD COLUMN ' + name + ' ' + definition).run(); }
  catch (error) {
    if (!(await columns()).results.some(row => row.name === name)) throw error;
  }
}

async function initialize(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS coast_calendar_entries_v2 (
    id TEXT PRIMARY KEY,
    day TEXT NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    recurrence TEXT NOT NULL DEFAULT 'none',
    author TEXT NOT NULL,
    source TEXT NOT NULL,
    conversation_id TEXT,
    source_turn_id TEXT,
    tool_call_id TEXT UNIQUE,
    model_label TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_coast_calendar_entries_v2_day ON coast_calendar_entries_v2(day)').run();
  await ensureColumn(db, 'anniversary_start_day', 'TEXT');
  await ensureColumn(db, 'anniversary_mode', 'TEXT');
  await ensureColumn(db, 'anniversary_target_days', 'INTEGER');
  await ensureColumn(db, 'anniversary_pinned', 'INTEGER NOT NULL DEFAULT 0');
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_coast_calendar_anniversary_pinned ON coast_calendar_entries_v2(anniversary_pinned)').run();
  await db.prepare('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)').run();
  await db.prepare('INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)').bind('calendar-anniversary-v1', Date.now()).run();
}

export async function ensureCalendarSchema(db) {
  if (!db) throw new CalendarError('database_unavailable', '日历暂时无法连接数据库。', 503);
  let pending = schemaPromises.get(db);
  if (!pending) { pending = initialize(db); schemaPromises.set(db, pending); }
  try { await pending; } catch (error) { schemaPromises.delete(db); throw error; }
}

async function find(db, id) {
  return db.prepare('SELECT * FROM coast_calendar_entries_v2 WHERE id = ?').bind(id).first();
}

function actor(context = {}) {
  return context.author === 'owner' ? 'owner' : 'assistant';
}

function hydrate(row, month = '') {
  if (!row) return null;
  let occurrenceDay = row.day;
  if (month && row.recurrence === 'yearly') {
    const candidate = `${month}${row.day.slice(7)}`;
    if (!validDay(candidate) || Number(month.slice(0, 4)) < Number(row.day.slice(0, 4))) return null;
    occurrenceDay = candidate;
  }
  const { anniversary_start_day, anniversary_mode, anniversary_target_days, anniversary_pinned, ...entry } = row;
  const anniversary = anniversaryFromRow(row);
  return { ...entry, occurrence_day: occurrenceDay, ...(anniversary ? { anniversary } : {}) };
}

export async function listCalendarEntries(db, { month = '', all = false, pinned = false } = {}) {
  await ensureCalendarSchema(db);
  if (pinned) {
    const rows = await db.prepare('SELECT * FROM coast_calendar_entries_v2 WHERE anniversary_pinned = 1 AND anniversary_mode IS NOT NULL ORDER BY created_at ASC, id ASC').all();
    return (rows.results || []).map(row => hydrate(row));
  }
  if (all) {
    const rows = await db.prepare('SELECT * FROM coast_calendar_entries_v2 ORDER BY day ASC, created_at ASC').all();
    return (rows.results || []).map((row) => hydrate(row));
  }
  const selected = requireMonth(month || new Date().toISOString().slice(0, 7));
  const [year, mm] = selected.split('-').map(Number);
  const final = new Date(Date.UTC(year, mm, 0)).toISOString().slice(0, 10);
  const rows = await db.prepare(`SELECT * FROM coast_calendar_entries_v2
    WHERE (day >= ? AND day <= ?) OR (recurrence = 'yearly' AND substr(day, 6, 2) = ?)
    ORDER BY day ASC, created_at ASC`).bind(`${selected}-01`, final, String(mm).padStart(2, '0')).all();
  return (rows.results || []).map((row) => hydrate(row, selected)).filter(Boolean)
    .sort((a, b) => a.occurrence_day.localeCompare(b.occurrence_day) || a.created_at - b.created_at);
}

export async function createCalendarEntry(db, value, context = {}) {
  await ensureCalendarSchema(db);
  const patch = validate(value);
  const item = applyAnniversary(patch, patch);
  const idem = String(context.tool_call_id || '').slice(0, 240) || null;
  if (idem) {
    const existing = await db.prepare('SELECT * FROM coast_calendar_entries_v2 WHERE tool_call_id = ?').bind(idem).first();
    if (existing) return hydrate(existing);
  }
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.prepare(`INSERT INTO coast_calendar_entries_v2
    (id, day, kind, title, body, recurrence, author, source, conversation_id, source_turn_id, tool_call_id, model_label, created_at, updated_at, anniversary_start_day, anniversary_mode, anniversary_target_days, anniversary_pinned)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, item.day, item.kind, item.title, item.body, item.recurrence,
      actor(context), context.source === 'official_mcp' ? 'official_mcp' : context.author === 'owner' ? 'manual' : 'coast_chat',
      context.conversation_id || null, context.source_turn_id || null, idem, context.model_label || null, now, now, ...anniversaryColumns(item.anniversary)).run();
  return hydrate(await find(db, id));
}

export async function updateCalendarEntry(db, id, value) {
  await ensureCalendarSchema(db);
  const old = await find(db, String(id || ''));
  if (!old) throw new CalendarError('not_found', '没有找到这条日历记录。', 404);
  const patch = validate(value, { patch: true });
  const entry = applyAnniversary({ ...old, ...patch, updated_at: Date.now() }, patch, anniversaryFromRow(old));
  await db.prepare(`UPDATE coast_calendar_entries_v2
    SET day = ?, kind = ?, title = ?, body = ?, recurrence = ?, updated_at = ?,
      anniversary_start_day = ?, anniversary_mode = ?, anniversary_target_days = ?, anniversary_pinned = ? WHERE id = ?`)
    .bind(entry.day, entry.kind, entry.title, entry.body, entry.recurrence, entry.updated_at, ...anniversaryColumns(entry.anniversary), old.id).run();
  return hydrate(await find(db, old.id));
}

export async function deleteCalendarEntry(db, id) {
  await ensureCalendarSchema(db);
  const old = await find(db, String(id || ''));
  if (!old) throw new CalendarError('not_found', '没有找到这条日历记录。', 404);
  await db.prepare('DELETE FROM coast_calendar_entries_v2 WHERE id = ?').bind(old.id).run();
  return { deleted: true, id: old.id };
}
