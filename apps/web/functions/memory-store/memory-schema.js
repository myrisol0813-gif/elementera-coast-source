import { ensureChatSchema } from '../chat-store.js';
import { run } from './memory-db.js';

const schemaPromises = new WeakMap();

async function initializeMemorySchema(db) {
  await ensureChatSchema(db);
  await run(db, `CREATE TABLE IF NOT EXISTS conversation_soils (
    conversation_id TEXT PRIMARY KEY,
    current_text TEXT NOT NULL DEFAULT '',
    hand_seeds_json TEXT NOT NULL DEFAULT '[]',
    do_not_repeat TEXT NOT NULL DEFAULT '',
    pocket_candidates_json TEXT NOT NULL DEFAULT '[]',
    manual_locked INTEGER NOT NULL DEFAULT 0,
    auto_refresh_enabled INTEGER NOT NULL DEFAULT 1,
    organized_through_turn_id TEXT NOT NULL DEFAULT '',
    actor TEXT NOT NULL DEFAULT 'owner',
    surface TEXT NOT NULL DEFAULT 'web_manual',
    model_label TEXT DEFAULT NULL,
    model_nickname TEXT DEFAULT NULL,
    symbol TEXT NOT NULL DEFAULT '',
    display_author TEXT NOT NULL DEFAULT 'Owner',
    source_conversation_id TEXT DEFAULT NULL,
    source_turn_id TEXT DEFAULT NULL,
    tool_call_id TEXT DEFAULT NULL,
    tool_call_ids_json TEXT NOT NULL DEFAULT '[]',
    revision INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id)
  )`);
  await run(db, `CREATE TABLE IF NOT EXISTS memory_pockets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'owner',
    conversation_id TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_ref_json TEXT NOT NULL DEFAULT '{}',
    source_text TEXT NOT NULL,
    suggested_title TEXT NOT NULL DEFAULT '',
    suggested_life_core TEXT NOT NULL DEFAULT '',
    suggested_usage_hint TEXT NOT NULL DEFAULT '',
    suggested_avoid_hint TEXT NOT NULL DEFAULT '',
    candidate_id TEXT DEFAULT NULL,
    title TEXT NOT NULL DEFAULT '',
    life_core TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    usage_hint TEXT NOT NULL DEFAULT '',
    avoid_hint TEXT NOT NULL DEFAULT '',
    source_refs_json TEXT NOT NULL DEFAULT '[]',
    source_excerpt TEXT NOT NULL DEFAULT '',
    fingerprint TEXT DEFAULT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    resolved_entry_id TEXT DEFAULT NULL,
    recall_count INTEGER NOT NULL DEFAULT 0,
    last_recalled_at INTEGER DEFAULT NULL,
    vector_ids_json TEXT NOT NULL DEFAULT '[]',
    embedding_model TEXT DEFAULT NULL,
    embedding_version TEXT DEFAULT NULL,
    embedding_status TEXT NOT NULL DEFAULT 'pending',
    embedded_at INTEGER DEFAULT NULL,
    memory_tags_json TEXT NOT NULL DEFAULT '[]',
    source_model TEXT NOT NULL DEFAULT '',
    source_window TEXT NOT NULL DEFAULT '',
    source_time INTEGER,
    tag TEXT NOT NULL DEFAULT '',
    supersedes_entry_id TEXT,
    last_confirmed_at INTEGER,
    revision_action TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER DEFAULT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id)
  )`);
  await run(db, `CREATE TABLE IF NOT EXISTS memory_entries (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'owner',
    entry_type TEXT NOT NULL,
    scope TEXT NOT NULL,
    conversation_id TEXT DEFAULT NULL,
    title TEXT NOT NULL,
    life_core TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    usage_hint TEXT NOT NULL DEFAULT '',
    avoid_hint TEXT NOT NULL DEFAULT '',
    source_type TEXT NOT NULL DEFAULT 'manual',
    source_ref_json TEXT NOT NULL DEFAULT '{}',
    promoted_from_id TEXT DEFAULT NULL,
    memory_level TEXT NOT NULL DEFAULT 'ordinary',
    status TEXT NOT NULL DEFAULT 'active',
    user_confirmed INTEGER NOT NULL DEFAULT 1,
    recall_count INTEGER NOT NULL DEFAULT 0,
    last_recalled_at INTEGER DEFAULT NULL,
    vector_id TEXT DEFAULT NULL,
    embedding_model TEXT DEFAULT NULL,
    embedding_version TEXT DEFAULT NULL,
    embedding_status TEXT NOT NULL DEFAULT 'pending',
    embedded_at INTEGER DEFAULT NULL,
    memory_tags_json TEXT NOT NULL DEFAULT '[]',
    source_model TEXT NOT NULL DEFAULT '',
    source_window TEXT NOT NULL DEFAULT '',
    source_time INTEGER,
    tag TEXT NOT NULL DEFAULT '',
    supersedes_entry_id TEXT,
    last_confirmed_at INTEGER,
    revision_action TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER DEFAULT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id)
  )`);
  await run(db, `CREATE TABLE IF NOT EXISTS memory_custom_instructions (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL,
    updated_by TEXT NOT NULL DEFAULT 'owner',
    source TEXT NOT NULL DEFAULT 'owner_manual'
  )`);
  await run(db, 'CREATE INDEX IF NOT EXISTS idx_soils_updated ON conversation_soils(updated_at)');
  await run(db, `CREATE INDEX IF NOT EXISTS idx_pockets_conversation_status
    ON memory_pockets(conversation_id, status, created_at)`);
  await run(db, `CREATE UNIQUE INDEX IF NOT EXISTS idx_pockets_fingerprint
    ON memory_pockets(user_id, fingerprint)
    WHERE fingerprint IS NOT NULL AND fingerprint <> ''`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_entries_scope_type
    ON memory_entries(user_id, scope, entry_type, status, updated_at)`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_entries_conversation
    ON memory_entries(conversation_id, entry_type, status, updated_at)`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_entries_recall
    ON memory_entries(last_recalled_at, recall_count)`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_entries_facets
    ON memory_entries(user_id, entry_type, tag, source_time)`);
}

export async function ensureMemorySchema(db) {
  let ready = schemaPromises.get(db);
  if (!ready) {
    ready = initializeMemorySchema(db);
    schemaPromises.set(db, ready);
  }
  try {
    await ready;
  } catch (error) {
    schemaPromises.delete(db);
    throw error;
  }
}
