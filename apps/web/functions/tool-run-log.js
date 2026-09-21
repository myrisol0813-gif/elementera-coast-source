const TOOL_RUN_MIGRATION_ID = 'coast-tool-runs-v1';
const schemaPromises = new WeakMap();

async function run(db, sql, params = []) { return db.prepare(sql).bind(...params).run(); }
async function all(db, sql, params = []) {
  const result = await db.prepare(sql).bind(...params).all();
  return result?.results || [];
}

async function initialize(db) {
  await run(db, `CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`);
  await run(db, `CREATE TABLE IF NOT EXISTS coast_tool_runs (
    id TEXT PRIMARY KEY,
    tool_key TEXT NOT NULL,
    actor TEXT NOT NULL,
    room_scope TEXT NOT NULL,
    conversation_id TEXT,
    status TEXT NOT NULL,
    input_summary TEXT,
    output_summary TEXT,
    error_message TEXT,
    created_at INTEGER NOT NULL,
    finished_at INTEGER
  )`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_tool_runs_recent
    ON coast_tool_runs(created_at DESC, tool_key, status)`);
  await run(db, 'INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)', [
    TOOL_RUN_MIGRATION_ID,
    Date.now(),
  ]);
}

export async function ensureToolRunSchema(db) {
  let ready = schemaPromises.get(db);
  if (!ready) {
    ready = initialize(db);
    schemaPromises.set(db, ready);
  }
  try {
    await ready;
  } catch (error) {
    schemaPromises.delete(db);
    throw error;
  }
}

function clip(value, max) { return String(value ?? '').trim().slice(0, max); }
function iso(value) { return value ? new Date(Number(value)).toISOString() : null; }
function parse(value, fallback = null) { try { return JSON.parse(value || '') ?? fallback; } catch { return fallback; } }

function compact(value, depth = 0) {
  if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) {
    return typeof value === 'string' ? value.slice(0, 240) : value;
  }
  if (depth >= 2) return '[nested]';
  if (Array.isArray(value)) return { count: value.length };
  if (typeof value !== 'object') return String(value).slice(0, 120);
  return Object.fromEntries(Object.entries(value).slice(0, 18).map(([key, item]) => [key, compact(item, depth + 1)]));
}

export function summarizeToolValue(toolKey, value) {
  if (String(toolKey).startsWith('mailbox.')) {
    const object = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const safeCounts = {};
    for (const key of ['batch_id', 'visitor_count', 'message_count', 'reply_count', 'failure_count', 'needs_owner_attention_count', 'status', 'ok']) {
      if (object[key] != null && typeof object[key] !== 'object') safeCounts[key] = object[key];
    }
    return JSON.stringify({ privacy: 'mailbox_content_redacted', ...safeCounts }).slice(0, 2000);
  }
  if (String(toolKey).startsWith('dogtalk.')) {
    const object = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return JSON.stringify({
      privacy: 'dogtalk_content_redacted',
      id: object.id || object.dogtalk?.id || null,
      snapshot_id: object.snapshot?.id || null,
      status: object.status || object.dogtalk?.status || null,
    }).slice(0, 2000);
  }
  if (/^(?:radio\.|lighthouse\.|memory\.|daily\.)/u.test(String(toolKey))) {
    const object = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const counts = {};
    for (const [key, item] of Object.entries(object)) {
      if (Array.isArray(item)) counts[`${key}_count`] = item.length;
      else if (item && typeof item === 'object') {
        if (Array.isArray(item.records)) counts[`${key}_record_count`] = item.records.length;
        if (item.id) counts[`${key}_id`] = item.id;
      } else if (['id', 'status', 'ok', 'room_scope', 'conversation_id'].includes(key)) counts[key] = item;
    }
    return JSON.stringify({ privacy: 'content_redacted', ...counts }).slice(0, 2000);
  }
  return (JSON.stringify(compact(value)) || 'null').slice(0, 2000);
}

export async function startToolRun(db, definition, input, context = {}) {
  await ensureToolRunSchema(db);
  const id = crypto.randomUUID();
  await run(db, `INSERT INTO coast_tool_runs (
    id, tool_key, actor, room_scope, conversation_id, status,
    input_summary, output_summary, error_message, created_at, finished_at
  ) VALUES (?, ?, ?, ?, ?, 'running', ?, NULL, NULL, ?, NULL)`, [
    id,
    definition.tool_key,
    clip(context.actor || 'api_model_partner', 80),
    clip(context.room_scope || context.surface || 'main_chat', 80),
    clip(context.conversation_id, 200) || null,
    summarizeToolValue(definition.tool_key, input),
    Date.now(),
  ]);
  return id;
}

export async function finishToolRun(db, id, { status, output, error } = {}) {
  await ensureToolRunSchema(db);
  const toolRun = await db.prepare('SELECT tool_key FROM coast_tool_runs WHERE id = ?').bind(id).first();
  if (!toolRun) return;
  await run(db, `UPDATE coast_tool_runs SET
    status = ?, output_summary = ?, error_message = ?, finished_at = ? WHERE id = ?`, [
    status === 'success' ? 'success' : 'error',
    output == null ? null : summarizeToolValue(toolRun.tool_key, output),
    error
      ? (String(toolRun.tool_key).startsWith('mailbox.')
        ? `mailbox_tool_failed:${clip(error?.type || error?.name || 'error', 120)}`
        : clip(error?.message || error, 1000))
      : null,
    Date.now(),
    id,
  ]);
}

export async function listToolRuns(db, { limit = 80, status, tool_key: toolKey, conversation_id: conversationId, ids = [] } = {}) {
  await ensureToolRunSchema(db);
  const conditions = [];
  const params = [];
  if (status) { conditions.push('status = ?'); params.push(clip(status, 40)); }
  if (toolKey) { conditions.push('tool_key = ?'); params.push(clip(toolKey, 100)); }
  if (conversationId) { conditions.push('conversation_id = ?'); params.push(clip(conversationId, 200)); }
  const cleanIds = (Array.isArray(ids) ? ids : String(ids || '').split(','))
    .map((id) => clip(id, 180))
    .filter(Boolean)
    .slice(0, 32);
  if (cleanIds.length) {
    conditions.push(`id IN (${cleanIds.map(() => '?').join(',')})`);
    params.push(...cleanIds);
  }
  params.push(Math.min(200, Math.max(1, Number(limit) || 80)));
  const rows = await all(db, `SELECT * FROM coast_tool_runs
    ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
    ORDER BY created_at DESC LIMIT ?`, params);
  return rows.map((row) => ({
    id: row.id,
    tool_key: row.tool_key,
    actor: row.actor,
    room_scope: row.room_scope,
    conversation_id: row.conversation_id || null,
    status: row.status,
    input_summary: parse(row.input_summary, {}),
    output_summary: parse(row.output_summary, null),
    error_message: row.error_message || null,
    created_at: iso(row.created_at),
    finished_at: iso(row.finished_at),
  }));
}
