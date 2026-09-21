const MAILBOX_MIGRATION_IDS = Object.freeze([
  'mailbox-friend-chat-v1',
  'mailbox-room-memory-v2',
  'mailbox-test-data-reset-20260920',
]);
const schemaPromises = new WeakMap();

async function run(db, sql, params = []) {
  return db.prepare(sql).bind(...params).run();
}

async function first(db, sql, params = []) {
  return db.prepare(sql).bind(...params).first();
}

async function tableColumns(db, table) {
  const result = await db.prepare(`PRAGMA table_info(${table})`).all();
  return new Set((result?.results || []).map((column) => column.name));
}

async function ensureColumns(db, table, declarations) {
  const columns = await tableColumns(db, table);
  for (const [name, declaration] of declarations) {
    if (columns.has(name)) continue;
    await run(db, `ALTER TABLE ${table} ADD COLUMN ${name} ${declaration}`);
  }
}

async function initialize(db) {
  await run(db, `CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`);

  await run(db, `CREATE TABLE IF NOT EXISTS mailbox_visitors (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    preferred_name TEXT,
    passphrase_hash TEXT NOT NULL UNIQUE,
    passphrase_lookup TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_seen_at TEXT,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    allow_memory INTEGER NOT NULL DEFAULT 1 CHECK (allow_memory IN (0, 1)),
    privacy_level TEXT NOT NULL DEFAULT 'sealed' CHECK (privacy_level = 'sealed'),
    note_for_owner TEXT
  )`);

  await run(db, `CREATE TABLE IF NOT EXISTS mailbox_patrol_batches (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'processing'
      CHECK (status IN ('processing', 'completed')),
    visitor_count INTEGER NOT NULL DEFAULT 0,
    message_count INTEGER NOT NULL DEFAULT 0,
    reply_count INTEGER NOT NULL DEFAULT 0,
    failure_count INTEGER NOT NULL DEFAULT 0,
    needs_owner_attention_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    completed_at TEXT
  )`);

  await run(db, `CREATE TABLE IF NOT EXISTS mailbox_messages (
    id TEXT PRIMARY KEY,
    visitor_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('visitor', 'model_partner', 'system')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'sent'
      CHECK (status IN ('sent', 'waiting_for_model_partner', 'replied', 'hidden', 'error')),
    reply_batch_id TEXT,
    is_visible_to_owner INTEGER NOT NULL DEFAULT 0
      CHECK (is_visible_to_owner IN (0, 1)),
    safety_flag TEXT,
    FOREIGN KEY(visitor_id) REFERENCES mailbox_visitors(id),
    FOREIGN KEY(reply_batch_id) REFERENCES mailbox_patrol_batches(id)
  )`);

  await run(db, `CREATE TABLE IF NOT EXISTS mailbox_reply_queue (
    id TEXT PRIMARY KEY,
    visitor_id TEXT NOT NULL UNIQUE,
    latest_message_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'processing', 'replied', 'needs_owner_attention', 'error')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    processed_at TEXT,
    processed_by TEXT,
    error_note TEXT,
    needs_owner_attention INTEGER NOT NULL DEFAULT 0
      CHECK (needs_owner_attention IN (0, 1)),
    owner_attention_reason TEXT,
    processing_batch_id TEXT,
    FOREIGN KEY(visitor_id) REFERENCES mailbox_visitors(id),
    FOREIGN KEY(latest_message_id) REFERENCES mailbox_messages(id),
    FOREIGN KEY(processing_batch_id) REFERENCES mailbox_patrol_batches(id)
  )`);

  await run(db, `CREATE TABLE IF NOT EXISTS visitor_notebook_entries (
    id TEXT PRIMARY KEY,
    visitor_id TEXT NOT NULL,
    entry_type TEXT NOT NULL DEFAULT 'memory' CHECK (entry_type = 'memory'),
    title TEXT NOT NULL DEFAULT '',
    life_core TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL,
    usage_hint TEXT NOT NULL DEFAULT '',
    avoid_hint TEXT NOT NULL DEFAULT '',
    source_message_id TEXT,
    source_pocket_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 1 CHECK (confidence >= 0 AND confidence <= 1),
    visibility TEXT NOT NULL DEFAULT 'model_partner_only'
      CHECK (visibility IN ('model_partner_only', 'visitor_visible')),
    status TEXT NOT NULL DEFAULT 'active'
      CHECK (status IN ('active', 'archived')),
    generated_by_model TEXT,
    model_nickname TEXT,
    generation_source TEXT NOT NULL DEFAULT 'official_mcp'
      CHECK (generation_source IN ('official_mcp', 'legacy_mailbox')),
    source_conversation_id TEXT,
    source_turn_id TEXT,
    tool_call_id TEXT,
    archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
    FOREIGN KEY(visitor_id) REFERENCES mailbox_visitors(id),
    FOREIGN KEY(source_message_id) REFERENCES mailbox_messages(id)
  )`);

  await ensureColumns(db, 'visitor_notebook_entries', [
    ['entry_type', "TEXT NOT NULL DEFAULT 'memory' CHECK (entry_type = 'memory')"],
    ['title', "TEXT NOT NULL DEFAULT ''"],
    ['life_core', "TEXT NOT NULL DEFAULT ''"],
    ['usage_hint', "TEXT NOT NULL DEFAULT ''"],
    ['avoid_hint', "TEXT NOT NULL DEFAULT ''"],
    ['source_pocket_id', 'TEXT'],
    ['status', "TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived'))"],
    ['generated_by_model', 'TEXT'],
    ['model_nickname', 'TEXT'],
    ['generation_source', "TEXT NOT NULL DEFAULT 'legacy_mailbox' CHECK (generation_source IN ('official_mcp', 'legacy_mailbox'))"],
    ['source_conversation_id', 'TEXT'],
    ['source_turn_id', 'TEXT'],
    ['tool_call_id', 'TEXT'],
  ]);

  await run(db, `CREATE TABLE IF NOT EXISTS mailbox_thinking_notes (
    id TEXT PRIMARY KEY,
    visitor_id TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    source_message_id TEXT,
    archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
    FOREIGN KEY(visitor_id) REFERENCES mailbox_visitors(id),
    FOREIGN KEY(source_message_id) REFERENCES mailbox_messages(id)
  )`);

  await run(db, `CREATE TABLE IF NOT EXISTS mailbox_thought_soils (
    visitor_id TEXT PRIMARY KEY,
    current_text TEXT NOT NULL DEFAULT '',
    hand_seeds_json TEXT NOT NULL DEFAULT '[]',
    do_not_repeat TEXT NOT NULL DEFAULT '',
    pocket_candidates_json TEXT NOT NULL DEFAULT '[]',
    source_message_id TEXT,
    organized_through_message_id TEXT,
    manual_locked INTEGER NOT NULL DEFAULT 0 CHECK (manual_locked IN (0, 1)),
    auto_refresh_enabled INTEGER NOT NULL DEFAULT 1 CHECK (auto_refresh_enabled IN (0, 1)),
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
    model_label TEXT,
    model_nickname TEXT,
    source_conversation_id TEXT,
    source_turn_id TEXT,
    tool_call_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(visitor_id) REFERENCES mailbox_visitors(id),
    FOREIGN KEY(source_message_id) REFERENCES mailbox_messages(id)
  )`);

  await run(db, `CREATE TABLE IF NOT EXISTS mailbox_memory_pockets (
    id TEXT PRIMARY KEY,
    visitor_id TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    source_message_id TEXT,
    title TEXT NOT NULL,
    life_core TEXT NOT NULL,
    content TEXT NOT NULL,
    usage_hint TEXT NOT NULL DEFAULT '',
    avoid_hint TEXT NOT NULL DEFAULT '',
    source_excerpt TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'confirmed', 'discarded', 'archived')),
    resolved_entry_id TEXT,
    generated_by_model TEXT,
    model_nickname TEXT,
    generation_source TEXT NOT NULL DEFAULT 'official_mcp'
      CHECK (generation_source = 'official_mcp'),
    source_conversation_id TEXT,
    source_turn_id TEXT,
    tool_call_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    resolved_at TEXT,
    FOREIGN KEY(visitor_id) REFERENCES mailbox_visitors(id),
    FOREIGN KEY(source_message_id) REFERENCES mailbox_messages(id)
  )`);

  const migrationTimestamp = new Date().toISOString();
  await run(db, `INSERT OR IGNORE INTO mailbox_thought_soils (
    visitor_id, current_text, hand_seeds_json, do_not_repeat,
    pocket_candidates_json, source_message_id, organized_through_message_id,
    manual_locked, auto_refresh_enabled, revision, model_label, model_nickname,
    source_conversation_id, source_turn_id, tool_call_id, created_at, updated_at
  ) SELECT
    v.id,
    COALESCE((SELECT n.content FROM mailbox_thinking_notes n
      WHERE n.visitor_id = v.id AND n.archived = 0
      ORDER BY n.updated_at DESC, n.id DESC LIMIT 1), ''),
    '[]', '', '[]',
    (SELECT n.source_message_id FROM mailbox_thinking_notes n
      WHERE n.visitor_id = v.id AND n.archived = 0
      ORDER BY n.updated_at DESC, n.id DESC LIMIT 1),
    (SELECT n.source_message_id FROM mailbox_thinking_notes n
      WHERE n.visitor_id = v.id AND n.archived = 0
      ORDER BY n.updated_at DESC, n.id DESC LIMIT 1),
    0, 1, 1, NULL, NULL, NULL, NULL, NULL,
    COALESCE((SELECT MIN(n.created_at) FROM mailbox_thinking_notes n
      WHERE n.visitor_id = v.id AND n.archived = 0), ?),
    COALESCE((SELECT MAX(n.updated_at) FROM mailbox_thinking_notes n
      WHERE n.visitor_id = v.id AND n.archived = 0), ?)
  FROM mailbox_visitors v
  WHERE EXISTS (SELECT 1 FROM mailbox_thinking_notes n
    WHERE n.visitor_id = v.id AND n.archived = 0)`, [
    migrationTimestamp,
    migrationTimestamp,
  ]);

  await run(db, `UPDATE visitor_notebook_entries SET
    title = CASE WHEN TRIM(title) = ''
      THEN SUBSTR(REPLACE(REPLACE(content, CHAR(10), ' '), CHAR(13), ' '), 1, 80)
      ELSE title END,
    life_core = CASE WHEN TRIM(life_core) = '' THEN content ELSE life_core END,
    status = CASE WHEN archived = 1 THEN 'archived' ELSE 'active' END,
    generation_source = CASE
      WHEN generated_by_model IS NULL THEN 'legacy_mailbox'
      ELSE 'official_mcp' END`);

  await run(db, `CREATE INDEX IF NOT EXISTS idx_mailbox_messages_visitor_created
    ON mailbox_messages(visitor_id, created_at)`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_mailbox_messages_waiting
    ON mailbox_messages(visitor_id, status, created_at)`);
  await run(db, `CREATE UNIQUE INDEX IF NOT EXISTS idx_mailbox_model_partner_reply_batch
    ON mailbox_messages(visitor_id, reply_batch_id)
    WHERE role = 'model_partner' AND reply_batch_id IS NOT NULL`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_mailbox_queue_status_updated
    ON mailbox_reply_queue(status, updated_at)`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_mailbox_notebook_visitor_active
    ON visitor_notebook_entries(visitor_id, archived, updated_at)`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_mailbox_thinking_visitor_active
    ON mailbox_thinking_notes(visitor_id, archived, updated_at)`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_mailbox_soil_updated
    ON mailbox_thought_soils(updated_at)`);
  await run(db, `CREATE UNIQUE INDEX IF NOT EXISTS idx_mailbox_soil_tool_call
    ON mailbox_thought_soils(visitor_id, tool_call_id)
    WHERE tool_call_id IS NOT NULL`);
  await run(db, `CREATE UNIQUE INDEX IF NOT EXISTS idx_mailbox_pocket_fingerprint
    ON mailbox_memory_pockets(visitor_id, fingerprint)`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_mailbox_pocket_visitor_status
    ON mailbox_memory_pockets(visitor_id, status, updated_at)`);
  await run(db, `CREATE UNIQUE INDEX IF NOT EXISTS idx_mailbox_notebook_tool_call
    ON visitor_notebook_entries(visitor_id, tool_call_id)
    WHERE tool_call_id IS NOT NULL`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_mailbox_patrol_completed
    ON mailbox_patrol_batches(completed_at)`);

  const resetMigrationId = 'mailbox-test-data-reset-20260920';
  const resetApplied = await first(db, 'SELECT id FROM schema_migrations WHERE id = ?', [resetMigrationId]);
  if (!resetApplied) {
    await db.batch([
      db.prepare('DELETE FROM mailbox_reply_queue'),
      db.prepare('DELETE FROM mailbox_memory_pockets'),
      db.prepare('DELETE FROM visitor_notebook_entries'),
      db.prepare('DELETE FROM mailbox_thought_soils'),
      db.prepare('DELETE FROM mailbox_thinking_notes'),
      db.prepare('DELETE FROM mailbox_messages'),
      db.prepare('DELETE FROM mailbox_patrol_batches'),
      db.prepare('DELETE FROM mailbox_visitors'),
      db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').bind(
        resetMigrationId,
        Date.now(),
      ),
    ]);
  }

  for (const migrationId of MAILBOX_MIGRATION_IDS) {
    await run(db, 'INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)', [
      migrationId,
      Date.now(),
    ]);
  }
}

export async function ensureMailboxSchema(db) {
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

export const mailboxMigrationIds = MAILBOX_MIGRATION_IDS;
