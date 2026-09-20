const schemaPromises = new WeakMap();
function clean(value, max = 200) { return String(value ?? '').trim().slice(0, max); }
async function run(db, sql, params = []) { return db.prepare(sql).bind(...params).run(); }
async function first(db, sql, params = []) { return db.prepare(sql).bind(...params).first(); }
export async function ensureModelMetadataSchema(db) {
  let ready = schemaPromises.get(db);
  if (!ready) {
    ready = run(db, `CREATE TABLE IF NOT EXISTS source_model_metadata (conversation_id TEXT NOT NULL, message_id TEXT NOT NULL, status TEXT NOT NULL, sanitized INTEGER NOT NULL DEFAULT 1, snapshot_json TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (conversation_id, message_id))`);
    schemaPromises.set(db, ready);
  }
  try { await ready; } catch (error) { schemaPromises.delete(db); throw error; }
}
export async function writeMessageModelMetadata(db, conversationId, messageId, snapshot = {}) {
  await ensureModelMetadataSchema(db);
  const conversation = clean(conversationId, 180), message = clean(messageId, 180);
  if (!conversation || !message) return null;
  const safe = snapshot && typeof snapshot === 'object' ? snapshot : { status:'not_returned', sanitized:true, metadata:null, raw_metadata_sanitized:null };
  const encoded = JSON.stringify(safe);
  if (encoded.length > 900000) throw new Error('model_metadata_too_large');
  await run(db, `INSERT INTO source_model_metadata (conversation_id,message_id,status,sanitized,snapshot_json,updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(conversation_id,message_id) DO UPDATE SET status=excluded.status,sanitized=excluded.sanitized,snapshot_json=excluded.snapshot_json,updated_at=excluded.updated_at`, [conversation,message,clean(safe.status || 'saved',40),safe.sanitized === false ? 0 : 1,encoded,Date.now()]);
  return safe;
}
export async function readMessageModelMetadata(db, conversationId, messageId) {
  await ensureModelMetadataSchema(db);
  const row = await first(db, 'SELECT snapshot_json FROM source_model_metadata WHERE conversation_id = ? AND message_id = ?', [clean(conversationId,180),clean(messageId,180)]);
  if (!row) return { status:'not_returned', sanitized:true, metadata:null, raw_metadata_sanitized:null };
  try { return JSON.parse(row.snapshot_json); } catch { return { status:'save_failed', sanitized:true, metadata:null, raw_metadata_sanitized:null }; }
}
export async function deleteConversationModelMetadata(db, conversationId) { await ensureModelMetadataSchema(db); await run(db, 'DELETE FROM source_model_metadata WHERE conversation_id = ?', [clean(conversationId,180)]); }