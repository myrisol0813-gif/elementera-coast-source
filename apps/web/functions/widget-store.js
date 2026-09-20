const schemaPromises = new WeakMap();
const AUTHORS = new Set(['owner', 'model_partner']);

export class WidgetStoreError extends Error {
  constructor(type, message, status = 400) {
    super(message);
    this.name = 'WidgetStoreError';
    this.type = type;
    this.status = status;
  }
}

function clean(value, max = 12000) {
  return String(value ?? '').trim().slice(0, max);
}
function cleanId(value, prefix) {
  const raw = String(value || '').replace(/[^\w:.-]/g, '_').slice(0, 160);
  return raw || prefix + '_' + crypto.randomUUID();
}
function cleanAuthor(value) {
  const result = String(value || 'owner');
  return AUTHORS.has(result) ? result : 'owner';
}
function cleanDate(value) {
  const raw = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : new Date().toISOString().slice(0, 10);
}
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

export async function ensureWidgetSchema(db) {
  if (!db?.prepare) throw new WidgetStoreError('chat_db_not_configured', 'Chat database is not configured.', 503);
  let ready = schemaPromises.get(db);
  if (!ready) {
    ready = (async () => {
      await run(db, "CREATE TABLE IF NOT EXISTS source_widget_moments (id TEXT PRIMARY KEY, date TEXT NOT NULL, author TEXT NOT NULL, text TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)");
      await run(db, "CREATE TABLE IF NOT EXISTS source_widget_diaries (id TEXT PRIMARY KEY, date TEXT NOT NULL, author TEXT NOT NULL, weather TEXT NOT NULL DEFAULT '', mood TEXT NOT NULL DEFAULT '', tags_json TEXT NOT NULL DEFAULT '[]', text TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)");
      await run(db, 'CREATE INDEX IF NOT EXISTS idx_source_widget_moments_date ON source_widget_moments(date DESC, created_at DESC)');
      await run(db, 'CREATE INDEX IF NOT EXISTS idx_source_widget_diaries_date ON source_widget_diaries(date DESC, created_at DESC)');
    })();
    schemaPromises.set(db, ready);
  }
  try {
    await ready;
  } catch (error) {
    schemaPromises.delete(db);
    throw error;
  }
}

function momentFromRow(row) {
  return {
    id: row.id,
    date: row.date,
    author: row.author,
    text: row.text || '',
    created_at: new Date(Number(row.created_at)).toISOString(),
    updated_at: new Date(Number(row.updated_at)).toISOString(),
  };
}
function diaryFromRow(row) {
  let tags = [];
  try { tags = JSON.parse(row.tags_json || '[]'); } catch {}
  return {
    id: row.id,
    date: row.date,
    author: row.author,
    weather: row.weather || '',
    mood: row.mood || '',
    tags: Array.isArray(tags) ? tags : [],
    text: row.text || '',
    created_at: new Date(Number(row.created_at)).toISOString(),
    updated_at: new Date(Number(row.updated_at)).toISOString(),
  };
}

export async function listWidgetMoments(db) {
  await ensureWidgetSchema(db);
  return (await all(db, 'SELECT * FROM source_widget_moments ORDER BY date DESC, created_at DESC LIMIT 300')).map(momentFromRow);
}
export async function createWidgetMoment(db, value = {}) {
  await ensureWidgetSchema(db);
  const text = clean(value.text, 12000);
  if (!text) throw new WidgetStoreError('empty_moment', '短帖需要正文。');
  const item = {
    id: cleanId(value.id, 'moment'),
    date: cleanDate(value.date),
    author: cleanAuthor(value.author),
    text,
    created_at: Date.now(),
  };
  await run(db, 'INSERT INTO source_widget_moments (id, date, author, text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [item.id, item.date, item.author, item.text, item.created_at, item.created_at]);
  return momentFromRow(await first(db, 'SELECT * FROM source_widget_moments WHERE id = ?', [item.id]));
}
export async function deleteWidgetMoment(db, value) {
  await ensureWidgetSchema(db);
  const target = cleanId(value, 'moment');
  const row = await first(db, 'SELECT * FROM source_widget_moments WHERE id = ?', [target]);
  if (!row) throw new WidgetStoreError('moment_not_found', '短帖不存在。', 404);
  await run(db, 'DELETE FROM source_widget_moments WHERE id = ?', [target]);
  return momentFromRow(row);
}

export async function listWidgetDiaries(db) {
  await ensureWidgetSchema(db);
  return (await all(db, 'SELECT * FROM source_widget_diaries ORDER BY date DESC, created_at DESC LIMIT 300')).map(diaryFromRow);
}
export async function createWidgetDiary(db, value = {}) {
  await ensureWidgetSchema(db);
  const text = clean(value.text, 50000);
  if (!text) throw new WidgetStoreError('empty_diary', '日记需要正文。');
  const tags = (Array.isArray(value.tags) ? value.tags : []).map((item) => clean(item, 60)).filter(Boolean).slice(0, 20);
  const item = {
    id: cleanId(value.id, 'diary'),
    date: cleanDate(value.date),
    author: cleanAuthor(value.author),
    weather: clean(value.weather, 80),
    mood: clean(value.mood, 120),
    tags,
    text,
    created_at: Date.now(),
  };
  await run(db, 'INSERT INTO source_widget_diaries (id, date, author, weather, mood, tags_json, text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [item.id, item.date, item.author, item.weather, item.mood, JSON.stringify(tags), item.text, item.created_at, item.created_at]);
  return diaryFromRow(await first(db, 'SELECT * FROM source_widget_diaries WHERE id = ?', [item.id]));
}
export async function deleteWidgetDiary(db, value) {
  await ensureWidgetSchema(db);
  const target = cleanId(value, 'diary');
  const row = await first(db, 'SELECT * FROM source_widget_diaries WHERE id = ?', [target]);
  if (!row) throw new WidgetStoreError('diary_not_found', '日记不存在。', 404);
  await run(db, 'DELETE FROM source_widget_diaries WHERE id = ?', [target]);
  return diaryFromRow(row);
}
