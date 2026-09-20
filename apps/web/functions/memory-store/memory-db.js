export class MemoryStoreError extends Error {
  constructor(type, message, status = 400) {
    super(message);
    this.name = 'MemoryStoreError';
    this.type = type;
    this.status = status;
  }
}

export function hasMemoryDatabase(env) {
  return Boolean(env?.COAST_CHAT_DB && typeof env.COAST_CHAT_DB.prepare === 'function');
}

export function clip(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

export function bool(value, fallback = false) {
  if (value == null) return fallback;
  return value === true || Number(value) === 1;
}

export function parseJson(value, fallback) {
  try {
    return JSON.parse(value || '') ?? fallback;
  } catch {
    return fallback;
  }
}

export function iso(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? new Date(number).toISOString() : null;
}

export function summaryRange(value = {}) {
  const parse = (input) => typeof input === 'number' ? input : Date.parse(String(input || ''));
  const from = Math.trunc(parse(value.from));
  const to = Math.trunc(parse(value.to));
  if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0 || from >= to) {
    throw new MemoryStoreError('invalid_memory_summary_range', '整理物的总结时间范围无效。');
  }
  return { from, to };
}

export async function run(db, sql, params = []) {
  return db.prepare(sql).bind(...params).run();
}

export async function first(db, sql, params = []) {
  return db.prepare(sql).bind(...params).first();
}

export async function all(db, sql, params = []) {
  const result = await db.prepare(sql).bind(...params).all();
  return result?.results || [];
}

export async function ensureColumn(db, table, column, declaration) {
  const columns = await all(db, `PRAGMA table_info(${table})`);
  if (columns.some((item) => item.name === column)) return;
  try {
    await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`).run();
  } catch (error) {
    const current = await all(db, `PRAGMA table_info(${table})`);
    if (!current.some((item) => item.name === column)) throw error;
  }
}
