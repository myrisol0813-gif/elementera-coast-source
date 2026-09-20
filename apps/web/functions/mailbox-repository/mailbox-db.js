export const PATROL_VISITOR_LIMIT = 50;
export const PATROL_MESSAGE_LIMIT = 100;
export const VISITOR_NOTEBOOK_LIMIT = 100;
export const VISITOR_POCKET_LIMIT = 100;
export const OWNER_VISITOR_LIMIT = 200;

export class MailboxRepositoryError extends Error {
  constructor(type, message, status = 400) {
    super(message);
    this.name = 'MailboxRepositoryError';
    this.type = type;
    this.status = status;
  }
}

export function now() {
  return new Date().toISOString();
}

export function boolean(value) {
  return Number(value || 0) === 1;
}

export function boundedLimit(value, fallback, maximum) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0
    ? Math.min(numeric, maximum)
    : fallback;
}

export function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(String(value || ''));
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

export async function first(db, sql, params = []) {
  return db.prepare(sql).bind(...params).first();
}

export async function all(db, sql, params = []) {
  const result = await db.prepare(sql).bind(...params).all();
  return result?.results || [];
}
