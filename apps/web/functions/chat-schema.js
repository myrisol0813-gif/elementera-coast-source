import { migrateLegacyRooms } from './room-conversation-migration.js';

const USER_ID = 'owner';
const MIGRATION_ID = 'chat-json-state-v4';
const ROOM_TYPE_MIGRATION_ID = 'chat-room-type-v1';
const schemaPromises = new WeakMap();

async function run(db, sql, params = []) {
  return db.prepare(sql).bind(...params).run();
}

async function first(db, sql, params = []) {
  return db.prepare(sql).bind(...params).first();
}

async function all(db, sql, params = []) {
  const result = await db.prepare(sql).bind(...params).all();
  return result?.results || [];
}

function iso(value) {
  const timestamp = Number(value || 0);
  return Number.isFinite(timestamp) && timestamp > 0
    ? new Date(timestamp).toISOString()
    : new Date().toISOString();
}

function clamp(value, length) {
  return length < 1 ? 0 : Math.min(Math.max(0, Number(value) || 0), length - 1);
}

async function tableExists(db, table) {
  return Boolean(await first(db, 'SELECT name FROM sqlite_master WHERE type = ? AND name = ?', ['table', table]));
}

async function ensureColumn(db, table, column, declaration) {
  const columns = await all(db, `PRAGMA table_info(${table})`);
  if (columns.some((item) => item.name === column)) return;
  try {
    await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`).run();
  } catch (error) {
    const current = await all(db, `PRAGMA table_info(${table})`);
    if (!current.some((item) => item.name === column)) throw error;
  }
}

async function createLatestSchema(db) {
  await run(db, `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  await run(db, `CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    title_manual INTEGER DEFAULT 0,
    title_generated_at INTEGER,
    title_model_id TEXT,
    archived_at INTEGER,
    room_type TEXT NOT NULL DEFAULT 'main',
    source TEXT NOT NULL DEFAULT 'coast',
    source_window_id TEXT
  )`);
  await run(db, `CREATE TABLE IF NOT EXISTS conversation_states (
    conversation_id TEXT PRIMARY KEY,
    state_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  await run(db, `CREATE TABLE IF NOT EXISTS chat_profiles (
    user_id TEXT PRIMARY KEY,
    assistant_avatar_dataurl TEXT,
    current_chat_model TEXT,
    current_image_model TEXT,
    model_box_json TEXT,
    updated_at INTEGER NOT NULL
  )`);
  await run(db, `CREATE TABLE IF NOT EXISTS conversation_landing_letters (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    letter_text TEXT NOT NULL,
    letter_hash TEXT NOT NULL,
    assistant_turn_id TEXT NOT NULL,
    landing_version INTEGER NOT NULL,
    sent_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(conversation_id, model_id, landing_version),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id)
  )`);
  await run(db, `CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`);

  await ensureColumn(db, 'conversations', 'title_manual', 'INTEGER DEFAULT 0');
  await ensureColumn(db, 'conversations', 'title_generated_at', 'INTEGER DEFAULT NULL');
  await ensureColumn(db, 'conversations', 'title_model_id', 'TEXT DEFAULT NULL');
  await ensureColumn(db, 'conversations', 'archived_at', 'INTEGER DEFAULT NULL');
  await ensureColumn(db, 'conversations', 'conversation_kind', "TEXT NOT NULL DEFAULT 'chat'");
  await ensureColumn(db, 'conversations', 'room_type', "TEXT NOT NULL DEFAULT 'main'");
  await ensureColumn(db, 'conversations', 'source', "TEXT NOT NULL DEFAULT 'coast'");
  await ensureColumn(db, 'conversations', 'source_window_id', 'TEXT DEFAULT NULL');
  await run(db, "UPDATE conversations SET room_type = 'main' WHERE room_type IS NULL OR room_type NOT IN ('main', 'radio', 'lighthouse')");
  await run(db, "UPDATE conversations SET source = 'coast' WHERE source IS NULL OR TRIM(source) = ''");
  await run(db, 'INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)', [ROOM_TYPE_MIGRATION_ID, Date.now()]);
}

async function readNormalizedTurns(db, conversationId) {
  const turns = await all(db, `SELECT id, position, active_user_variant_id, updated_at
    FROM turns
    WHERE conversation_id = ? AND deleted_at IS NULL
    ORDER BY position ASC, created_at ASC`, [conversationId]);
  if (!turns.length) return [];

  const turnIds = turns.map((turn) => turn.id);
  const placeholders = turnIds.map(() => '?').join(',');
  const users = await all(db, `SELECT id, turn_id, position, content, created_at
    FROM user_variants
    WHERE deleted_at IS NULL AND turn_id IN (${placeholders})
    ORDER BY turn_id ASC, position ASC`, turnIds);
  const assistants = await all(db, `SELECT id, turn_id, user_variant_id, user_variant_position, position,
      content, error_detail, is_active, created_at
    FROM assistant_variants
    WHERE deleted_at IS NULL AND turn_id IN (${placeholders})
    ORDER BY turn_id ASC, user_variant_position ASC, position ASC`, turnIds);

  const usersByTurn = new Map();
  const userPositions = new Map();
  for (const row of users) {
    const list = usersByTurn.get(row.turn_id) || [];
    list.push({ id: row.id, content: row.content || '', created_at: iso(row.created_at) });
    usersByTurn.set(row.turn_id, list);
  }
  for (const [turnId, list] of usersByTurn) {
    list.forEach((variant, index) => userPositions.set(`${turnId}:${variant.id}`, index));
  }

  const assistantsByBranch = new Map();
  const activeByBranch = new Map();
  for (const row of assistants) {
    const linkedPosition = row.user_variant_id
      ? userPositions.get(`${row.turn_id}:${row.user_variant_id}`)
      : null;
    const branch = linkedPosition == null ? Number(row.user_variant_position || 0) : linkedPosition;
    const key = `${row.turn_id}:${branch}`;
    const list = assistantsByBranch.get(key) || [];
    list.push({
      id: row.id,
      content: row.content || '',
      created_at: iso(row.created_at),
      ...(row.error_detail ? { errorDetail: row.error_detail } : {}),
    });
    if (Number(row.is_active || 0) === 1) activeByBranch.set(key, list.length - 1);
    assistantsByBranch.set(key, list);
  }

  return turns.map((row) => {
    const userVariants = usersByTurn.get(row.id) || [];
    const activeUser = userVariants.findIndex((variant) => variant.id === row.active_user_variant_id);
    const variantsByUserVariant = {};
    const activeByUserVariant = {};
    for (let index = 0; index < Math.max(1, userVariants.length); index += 1) {
      const branch = `${row.id}:${index}`;
      variantsByUserVariant[String(index)] = assistantsByBranch.get(branch) || [];
      activeByUserVariant[String(index)] = clamp(
        activeByBranch.get(branch),
        variantsByUserVariant[String(index)].length || 1,
      );
    }
    return {
      id: row.id,
      user: { active: activeUser >= 0 ? activeUser : 0, variants: userVariants },
      assistant: { activeByUserVariant, variantsByUserVariant },
    };
  });
}

async function migrateJsonStates(db, normalizeState) {
  if (await first(db, 'SELECT id FROM schema_migrations WHERE id = ?', [MIGRATION_ID])) return;
  const hasNormalizedTables = await Promise.all([
    tableExists(db, 'turns'),
    tableExists(db, 'user_variants'),
    tableExists(db, 'assistant_variants'),
  ]).then((values) => values.every(Boolean));
  const missing = await all(db, `SELECT c.id
    FROM conversations c
    LEFT JOIN conversation_states s ON s.conversation_id = c.id
    WHERE c.user_id = ? AND s.conversation_id IS NULL`, [USER_ID]);

  for (const conversation of missing) {
    const turns = hasNormalizedTables ? await readNormalizedTurns(db, conversation.id) : [];
    const state = normalizeState({ turns });
    const timestamp = Date.now();
    await run(db, `INSERT OR IGNORE INTO conversation_states (conversation_id, state_json, updated_at)
      VALUES (?, ?, ?)`, [conversation.id, JSON.stringify(state), timestamp]);
  }
  await run(db, 'INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)', [MIGRATION_ID, Date.now()]);
}

async function initialize(db, normalizeState) {
  await createLatestSchema(db);
  await migrateJsonStates(db, normalizeState);
  await migrateLegacyRooms(db, normalizeState);
  await run(db, 'CREATE INDEX IF NOT EXISTS idx_conversations_owner ON conversations(user_id, deleted_at, updated_at)');
  await run(db, `CREATE INDEX IF NOT EXISTS idx_conversations_room_type
    ON conversations(user_id, room_type, deleted_at, updated_at DESC)`);
  await run(db, `CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_source_window
    ON conversations(user_id, source, source_window_id)
    WHERE source_window_id IS NOT NULL`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_landing_letters_latest
    ON conversation_landing_letters(conversation_id, model_id, landing_version DESC)`);
  const timestamp = Date.now();
  await run(db, 'INSERT OR IGNORE INTO users (id, created_at, updated_at) VALUES (?, ?, ?)', [USER_ID, timestamp, timestamp]);
  await run(db, 'UPDATE users SET updated_at = ? WHERE id = ?', [timestamp, USER_ID]);
}

export async function ensureChatSchema(db, normalizeState) {
  let ready = schemaPromises.get(db);
  if (!ready) {
    ready = initialize(db, normalizeState);
    schemaPromises.set(db, ready);
  }
  try {
    await ready;
  } catch (error) {
    schemaPromises.delete(db);
    throw error;
  }
}
