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
  const allowed = new Set(['day', 'title', 'body', 'kind', 'recurrence']);
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
  return out;
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
  return { ...row, occurrence_day: occurrenceDay };
}

export async function listCalendarEntries(db, { month = '', all = false } = {}) {
  await ensureCalendarSchema(db);
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
  const item = validate(value);
  const idem = String(context.tool_call_id || '').slice(0, 240) || null;
  if (idem) {
    const existing = await db.prepare('SELECT * FROM coast_calendar_entries_v2 WHERE tool_call_id = ?').bind(idem).first();
    if (existing) return hydrate(existing);
  }
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.prepare(`INSERT INTO coast_calendar_entries_v2
    (id, day, kind, title, body, recurrence, author, source, conversation_id, source_turn_id, tool_call_id, model_label, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, item.day, item.kind, item.title, item.body, item.recurrence,
      actor(context), context.source === 'official_mcp' ? 'official_mcp' : context.author === 'owner' ? 'manual' : 'coast_chat',
      context.conversation_id || null, context.source_turn_id || null, idem, context.model_label || null, now, now).run();
  return hydrate(await find(db, id));
}

export async function updateCalendarEntry(db, id, value) {
  await ensureCalendarSchema(db);
  const old = await find(db, String(id || ''));
  if (!old) throw new CalendarError('not_found', '没有找到这条日历记录。', 404);
  const patch = validate(value, { patch: true });
  const entry = { ...old, ...patch, updated_at: Date.now() };
  await db.prepare(`UPDATE coast_calendar_entries_v2
    SET day = ?, kind = ?, title = ?, body = ?, recurrence = ?, updated_at = ? WHERE id = ?`)
    .bind(entry.day, entry.kind, entry.title, entry.body, entry.recurrence, entry.updated_at, old.id).run();
  return hydrate(await find(db, old.id));
}

export async function deleteCalendarEntry(db, id) {
  await ensureCalendarSchema(db);
  const old = await find(db, String(id || ''));
  if (!old) throw new CalendarError('not_found', '没有找到这条日历记录。', 404);
  await db.prepare('DELETE FROM coast_calendar_entries_v2 WHERE id = ?').bind(old.id).run();
  return { deleted: true, id: old.id };
}
