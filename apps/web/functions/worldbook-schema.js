const WORLDBOOK_MIGRATION_ID = 'coast-worldbook-empty-v5';
const schemaPromises = new WeakMap();

const RETIRED_SYSTEM_ENTRY_IDS = Object.freeze([
  'elementera-coast',
  'myrisol-myri',
  'official-myri',
  'api-myri',
  'coast-mailbox',
  'radio-room',
  'lighthouse-letters',
  'thinking-soil',
  'memory-pocket',
  'memory-library',
  'seed-library',
  'coast-dictionary',
  'custom-instructions',
  'treasury',
  'cross-window-touch',
  'memory-orb',
  'context-manifest',
  'kelivo-principle',
  'visitor-notebook',
  'window-seed',
  'global-memory',
]);

async function run(db, sql, params = []) {
  return db.prepare(sql).bind(...params).run();
}

async function first(db, sql, params = []) {
  return db.prepare(sql).bind(...params).first();
}

async function initialize(db) {
  await run(db, `CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`);
  await run(db, `CREATE TABLE IF NOT EXISTS coast_worldbook_entries (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    keywords_json TEXT NOT NULL DEFAULT '[]',
    use_regex INTEGER NOT NULL DEFAULT 0,
    case_sensitive INTEGER NOT NULL DEFAULT 0,
    constant_active INTEGER NOT NULL DEFAULT 0,
    priority INTEGER NOT NULL DEFAULT 0,
    scan_depth INTEGER NOT NULL DEFAULT 4,
    inject_position TEXT NOT NULL DEFAULT 'before_memory',
    enabled INTEGER NOT NULL DEFAULT 1,
    scope TEXT NOT NULL DEFAULT 'owner',
    visitor_safe INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_worldbook_active
    ON coast_worldbook_entries(enabled, scope, priority DESC)`);

  const alreadyClean = await first(db, 'SELECT id FROM schema_migrations WHERE id = ?', [WORLDBOOK_MIGRATION_ID]);
  if (!alreadyClean) {
    for (const id of RETIRED_SYSTEM_ENTRY_IDS) {
      await run(db, 'DELETE FROM coast_worldbook_entries WHERE id = ?', [id]);
    }
    await run(db, 'INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)', [
      WORLDBOOK_MIGRATION_ID,
      Date.now(),
    ]);
  }
}

export async function ensureWorldbookSchema(db) {
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

export const worldbookMigrationIds = Object.freeze([WORLDBOOK_MIGRATION_ID]);
