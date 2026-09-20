const schemaPromises = new WeakMap();

function clean(value, max = 400) {
  return String(value ?? '').trim().slice(0, max);
}
function bool(value) {
  return value === true || Number(value) === 1;
}
async function run(db, sql, params = []) {
  return db.prepare(sql).bind(...params).run();
}
async function all(db, sql, params = []) {
  const result = await db.prepare(sql).bind(...params).all();
  return result?.results || [];
}
export async function ensureToolRunLogSchema(db) {
  if (!db?.prepare) return;
  let ready = schemaPromises.get(db);
  if (!ready) {
    ready = run(db, `CREATE TABLE IF NOT EXISTS source_tool_runs (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      window_id TEXT NOT NULL DEFAULT '',
      conversation_id TEXT NOT NULL DEFAULT '',
      tool_name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '',
      target TEXT NOT NULL DEFAULT '',
      success INTEGER NOT NULL DEFAULT 0,
      error_summary TEXT NOT NULL DEFAULT '',
      delivered_to_model INTEGER NOT NULL DEFAULT 0,
      shown_in_turn_context INTEGER NOT NULL DEFAULT 0,
      redacted INTEGER NOT NULL DEFAULT 1
    )`);
    schemaPromises.set(db, ready);
  }
  try {
    await ready;
  } catch (error) {
    schemaPromises.delete(db);
    throw error;
  }
}
export async function appendToolRun(db, value = {}) {
  await ensureToolRunLogSchema(db);
  const id = clean(value.id, 180) || `tool-run-${crypto.randomUUID()}`;
  const createdAt = Number(value.created_at) || Date.now();
  await run(db, `INSERT INTO source_tool_runs (
    id, created_at, window_id, conversation_id, tool_name, category, target,
    success, error_summary, delivered_to_model, shown_in_turn_context, redacted
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    id, createdAt, clean(value.window_id, 180), clean(value.conversation_id, 180),
    clean(value.tool_name, 180), clean(value.category, 120), clean(value.target, 400),
    bool(value.success) ? 1 : 0, clean(value.error_summary, 500),
    bool(value.delivered_to_model) ? 1 : 0, bool(value.shown_in_turn_context) ? 1 : 0,
    value.redacted === false ? 0 : 1,
  ]);
  return { id, created_at: new Date(createdAt).toISOString() };
}
export async function listToolRuns(db, { limit = 50 } = {}) {
  if (!db?.prepare) return [];
  await ensureToolRunLogSchema(db);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 50));
  const rows = await all(db, `SELECT * FROM source_tool_runs ORDER BY created_at DESC LIMIT ?`, [safeLimit]);
  return rows.map((row) => ({
    id: row.id,
    created_at: new Date(Number(row.created_at)).toISOString(),
    window_id: row.window_id,
    conversation_id: row.conversation_id,
    tool_name: row.tool_name,
    category: row.category,
    target: row.target,
    success: Number(row.success) === 1,
    error_summary: row.error_summary,
    delivered_to_model: Number(row.delivered_to_model) === 1,
    shown_in_turn_context: Number(row.shown_in_turn_context) === 1,
    redacted: Number(row.redacted) !== 0,
  }));
}
