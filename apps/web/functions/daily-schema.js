const CORE_MIGRATION_ID = 'daily-core-v2';
const RETIRE_LEGACY_MIGRATION_ID = 'daily-retire-summary-drafts-albums-v1';
const PROFILE_MIGRATION_ID = 'daily-profile-v1';
const DIARY_TAGS_MIGRATION_ID = 'daily-diary-tags-v1';
const schemaPromises = new WeakMap();

async function run(db, sql, params = []) { return db.prepare(sql).bind(...params).run(); }
async function first(db, sql, params = []) { return db.prepare(sql).bind(...params).first(); }
async function all(db, sql, params = []) { const result = await db.prepare(sql).bind(...params).all(); return result?.results || []; }
async function ensureColumn(db, table, column, declaration) {
  const columns = await all(db, `PRAGMA table_info(${table})`);
  if (!columns.some((item) => item.name === column)) await run(db, `ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);
}
async function retireLegacyDailyTables(db) {
  const applied = await first(db, 'SELECT id FROM schema_migrations WHERE id = ?', [RETIRE_LEGACY_MIGRATION_ID]);
  if (applied) return;
  await run(db, 'DROP TABLE IF EXISTS daily_summaries');
  await run(db, 'DROP TABLE IF EXISTS daily_content_drafts');
  await run(db, 'DROP TABLE IF EXISTS daily_album_items');
  await run(db, 'INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)', [RETIRE_LEGACY_MIGRATION_ID, Date.now()]);
}

async function initialize(db) {
  await run(db, `CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`);
  await run(db, `CREATE TABLE IF NOT EXISTS daily_moments (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    author TEXT NOT NULL,
    source TEXT NOT NULL,
    status TEXT NOT NULL,
    text TEXT NOT NULL,
    conversation_id TEXT,
    source_turn_id TEXT,
    tool_call_id TEXT UNIQUE,
    actor TEXT,
    surface TEXT,
    model_label TEXT,
    model_nickname TEXT,
    symbol TEXT,
    display_author TEXT,
    reason TEXT,
    published_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  await run(db, `CREATE TABLE IF NOT EXISTS daily_moment_comments (
    id TEXT PRIMARY KEY,
    moment_id TEXT NOT NULL,
    author TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    model_id TEXT,
    usage_json TEXT
  )`);
  await run(db, `CREATE TABLE IF NOT EXISTS daily_moment_likes (
    moment_id TEXT NOT NULL,
    actor TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (moment_id, actor)
  )`);
  await run(db, `CREATE TABLE IF NOT EXISTS daily_diaries (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    author TEXT NOT NULL,
    source TEXT NOT NULL,
    weather TEXT,
    mood TEXT,
    tags_json TEXT NOT NULL DEFAULT '[]',
    text TEXT NOT NULL,
    conversation_id TEXT,
    source_turn_id TEXT,
    tool_call_id TEXT,
    actor TEXT,
    surface TEXT,
    model_label TEXT,
    model_nickname TEXT,
    symbol TEXT,
    display_author TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  await run(db, `CREATE TABLE IF NOT EXISTS daily_profile (
    id TEXT PRIMARY KEY,
    xiaohan_avatar_dataurl TEXT NOT NULL DEFAULT '',
    myri_avatar_dataurl TEXT NOT NULL DEFAULT '',
    moment_cover_dataurl TEXT NOT NULL DEFAULT '',
    myri_display_name TEXT NOT NULL DEFAULT '另一位屋主',
    updated_at INTEGER NOT NULL
  )`);

  await ensureColumn(db, 'daily_moment_comments', 'model_id', 'TEXT DEFAULT NULL');
  await ensureColumn(db, 'daily_moment_comments', 'usage_json', 'TEXT DEFAULT NULL');
  await ensureColumn(db, 'daily_profile', 'myri_display_name', "TEXT NOT NULL DEFAULT '另一位屋主'");
  for (const table of ['daily_moments', 'daily_diaries']) {
    await ensureColumn(db, table, 'actor', 'TEXT DEFAULT NULL');
    await ensureColumn(db, table, 'surface', 'TEXT DEFAULT NULL');
    await ensureColumn(db, table, 'model_label', 'TEXT DEFAULT NULL');
    await ensureColumn(db, table, 'model_nickname', 'TEXT DEFAULT NULL');
    await ensureColumn(db, table, 'symbol', 'TEXT DEFAULT NULL');
    await ensureColumn(db, table, 'display_author', 'TEXT DEFAULT NULL');
  }
  await ensureColumn(db, 'daily_diaries', 'conversation_id', 'TEXT DEFAULT NULL');
  await ensureColumn(db, 'daily_diaries', 'source_turn_id', 'TEXT DEFAULT NULL');
  await ensureColumn(db, 'daily_diaries', 'tool_call_id', 'TEXT DEFAULT NULL');
  await ensureColumn(db, 'daily_diaries', 'tags_json', "TEXT NOT NULL DEFAULT '[]'");

  await retireLegacyDailyTables(db);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_daily_moments_feed ON daily_moments(status, published_at DESC, created_at DESC)`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_daily_moments_conversation ON daily_moments(conversation_id, source_turn_id, created_at DESC)`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_daily_moment_comments ON daily_moment_comments(moment_id, created_at)`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_daily_diaries_date ON daily_diaries(date, author, created_at DESC)`);
  await run(db, `CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_diaries_tool_call ON daily_diaries(tool_call_id) WHERE tool_call_id IS NOT NULL`);
  await run(db, 'INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)', [CORE_MIGRATION_ID, Date.now()]);
  await run(db, 'INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)', [PROFILE_MIGRATION_ID, Date.now()]);
  await run(db, 'INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)', [DIARY_TAGS_MIGRATION_ID, Date.now()]);
}

export async function ensureDailySchema(db) {
  let ready = schemaPromises.get(db);
  if (!ready) { ready = initialize(db); schemaPromises.set(db, ready); }
  try { await ready; } catch (error) { schemaPromises.delete(db); throw error; }
}

export const dailyMigrationIds = Object.freeze([
  CORE_MIGRATION_ID,
  RETIRE_LEGACY_MIGRATION_ID,
  PROFILE_MIGRATION_ID,
  DIARY_TAGS_MIGRATION_ID,
]);
