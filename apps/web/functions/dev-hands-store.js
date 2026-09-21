const DEV_HANDS_MIGRATION_ID = 'coast-dev-hands-v1';
const schemaPromises = new WeakMap();

export const DEV_HAND_DEFAULTS = Object.freeze({
  github_read: true,
  github_write: false,
  github_dangerous: false,
  ci_actions: true,
  apk_artifact: true,
  wolf_update: true,
  notion_read: true,
  notion_write: true,
  notion_delete: false,
});

const SETTING_KEYS = Object.freeze(Object.keys(DEV_HAND_DEFAULTS));
const SENSITIVE_KEY = /(?:token|secret|cookie|authorization|password|keystore|private[_-]?key|client[_-]?secret|env)/iu;
const SECRET_PATTERNS = Object.freeze([
  /github_pat_[A-Za-z0-9_]+/gu,
  /gh[pousr]_[A-Za-z0-9]+/gu,
  /Bearer\s+[A-Za-z0-9._~+/=-]+/giu,
  /(?:Authorization|Cookie)\s*:\s*[^\r\n]+/giu,
  /-----BEGIN (?:[A-Z0-9][A-Z0-9 ]* )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9][A-Z0-9 ]* )?PRIVATE KEY-----/giu,
]);
const CREDENTIAL_LINE = /(?:authorization|cookie|token|secret|password|keystore|private[_ -]?key|client[_ -]?secret)/iu;

async function run(db, sql, params = []) { return db.prepare(sql).bind(...params).run(); }
async function all(db, sql, params = []) {
  const result = await db.prepare(sql).bind(...params).all();
  return result?.results || [];
}

async function initialize(db) {
  await run(db, `CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`);
  await run(db, `CREATE TABLE IF NOT EXISTS coast_dev_settings (
    owner_id TEXT PRIMARY KEY,
    github_read INTEGER NOT NULL,
    github_write INTEGER NOT NULL,
    github_dangerous INTEGER NOT NULL,
    ci_actions INTEGER NOT NULL,
    apk_artifact INTEGER NOT NULL,
    wolf_update INTEGER NOT NULL,
    notion_read INTEGER NOT NULL,
    notion_write INTEGER NOT NULL,
    notion_delete INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  await run(db, `CREATE TABLE IF NOT EXISTS coast_dev_runs (
    id TEXT PRIMARY KEY,
    target_system TEXT NOT NULL,
    action_name TEXT NOT NULL,
    target_ref TEXT,
    operation_type TEXT NOT NULL,
    confirmation_required INTEGER NOT NULL,
    confirmation_confirmed INTEGER NOT NULL,
    status TEXT NOT NULL,
    input_summary TEXT,
    output_summary TEXT,
    error_summary TEXT,
    related_json TEXT,
    created_at INTEGER NOT NULL,
    finished_at INTEGER
  )`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_dev_runs_recent
    ON coast_dev_runs(created_at DESC, target_system, status)`);
  await run(db, `CREATE TABLE IF NOT EXISTS coast_dev_artifact_cache (
    artifact_id TEXT PRIMARY KEY,
    payload_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  await run(db, `CREATE TABLE IF NOT EXISTS coast_update_records (
    id TEXT PRIMARY KEY,
    pwa_cache_version TEXT,
    native_version_code INTEGER,
    native_version_name TEXT,
    artifact_id TEXT,
    artifact_name TEXT,
    apk_sha256 TEXT,
    application_id TEXT,
    overwrite_installable INTEGER NOT NULL DEFAULT 0,
    release_notes TEXT,
    known_risk TEXT,
    created_at INTEGER NOT NULL
  )`);
  await run(db, 'INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)', [
    DEV_HANDS_MIGRATION_ID,
    Date.now(),
  ]);
}

export async function ensureDevHandsSchema(db) {
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

function bool(value) { return value === true || value === 1 || value === '1'; }
function iso(value) { return value ? new Date(Number(value)).toISOString() : null; }
function parse(value, fallback = null) { try { return JSON.parse(value || '') ?? fallback; } catch { return fallback; } }
function clip(value, max = 1000) { return String(value ?? '').trim().slice(0, max); }

function stripCredentialBlocks(value) {
  const lines = String(value ?? '').split(/\r?\n/u);
  const output = [];
  let inEnv = false;
  for (const line of lines) {
    if (/\benv:\s*$/iu.test(line)) {
      output.push('[ENV BLOCK REDACTED]');
      inEnv = true;
      continue;
    }
    if (inEnv) {
      if (/##\[endgroup\]/u.test(line)) {
        inEnv = false;
        output.push(line);
      }
      continue;
    }
    if (CREDENTIAL_LINE.test(line)) {
      output.push('[CREDENTIAL LINE REDACTED]');
      continue;
    }
    output.push(line);
  }
  return output.join('\n');
}

export function redactSecretText(value, max = 4000) {
  let output = String(value ?? '');
  for (const pattern of SECRET_PATTERNS) output = output.replace(pattern, '[REDACTED]');
  output = output.replace(/\b(COAST_(?:GITHUB|NOTION)[A-Z0-9_]*|GITHUB_TOKEN|NOTION_TOKEN)\s*=\s*[^\s,;]+/giu, '$1=[REDACTED]');
  output = stripCredentialBlocks(output);
  return output.slice(0, max);
}

function summarize(value, depth = 0) {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return redactSecretText(value, 320);
  if (depth >= 3) return '[nested]';
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => summarize(item, depth + 1));
  if (typeof value !== 'object') return redactSecretText(String(value), 160);
  return Object.fromEntries(Object.entries(value).slice(0, 32).map(([key, item]) => [
    key,
    SENSITIVE_KEY.test(key) ? '[REDACTED]' : summarize(item, depth + 1),
  ]));
}

export function safeDevSummary(value) {
  return JSON.stringify(summarize(value)).slice(0, 6000);
}

export async function getDevSettings(db) {
  await ensureDevHandsSchema(db);
  const row = await db.prepare('SELECT * FROM coast_dev_settings WHERE owner_id = ?').bind('owner').first();
  if (!row) return { ...DEV_HAND_DEFAULTS, updated_at: null };
  return {
    ...Object.fromEntries(SETTING_KEYS.map((key) => [key, bool(row[key])])),
    updated_at: iso(row.updated_at),
  };
}

export async function updateDevSettings(db, patch = {}) {
  await ensureDevHandsSchema(db);
  const current = await getDevSettings(db);
  const next = Object.fromEntries(SETTING_KEYS.map((key) => [
    key,
    Object.hasOwn(patch, key) ? Boolean(patch[key]) : Boolean(current[key]),
  ]));
  const now = Date.now();
  await run(db, `INSERT INTO coast_dev_settings (
    owner_id, github_read, github_write, github_dangerous, ci_actions,
    apk_artifact, wolf_update, notion_read, notion_write, notion_delete, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(owner_id) DO UPDATE SET
    github_read = excluded.github_read,
    github_write = excluded.github_write,
    github_dangerous = excluded.github_dangerous,
    ci_actions = excluded.ci_actions,
    apk_artifact = excluded.apk_artifact,
    wolf_update = excluded.wolf_update,
    notion_read = excluded.notion_read,
    notion_write = excluded.notion_write,
    notion_delete = excluded.notion_delete,
    updated_at = excluded.updated_at`, [
    'owner', ...SETTING_KEYS.map((key) => next[key] ? 1 : 0), now,
  ]);
  return { ...next, updated_at: iso(now) };
}

export async function startDevRun(db, {
  targetSystem,
  actionName,
  targetRef = '',
  operationType = 'read',
  confirmationRequired = false,
  confirmationConfirmed = false,
  input = null,
} = {}) {
  await ensureDevHandsSchema(db);
  const id = crypto.randomUUID();
  await run(db, `INSERT INTO coast_dev_runs (
    id, target_system, action_name, target_ref, operation_type,
    confirmation_required, confirmation_confirmed, status,
    input_summary, output_summary, error_summary, related_json, created_at, finished_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?, NULL, NULL, NULL, ?, NULL)`, [
    id,
    clip(targetSystem, 80) || 'unknown',
    clip(actionName, 120) || 'unknown',
    clip(targetRef, 260) || null,
    ['read', 'write', 'dangerous'].includes(operationType) ? operationType : 'read',
    confirmationRequired ? 1 : 0,
    confirmationConfirmed ? 1 : 0,
    input == null ? null : safeDevSummary(input),
    Date.now(),
  ]);
  return id;
}

function related(value = {}) {
  const keys = [
    'repo', 'branch', 'commit_sha', 'sha', 'pr_number', 'issue_number', 'workflow_run_id',
    'job_id', 'artifact_id', 'artifact_name', 'page_id', 'pwa_cache_version', 'version_code', 'version_name',
  ];
  const output = {};
  for (const key of keys) {
    const item = value?.[key];
    if (item != null && ['string', 'number', 'boolean'].includes(typeof item)) output[key] = item;
  }
  return output;
}

export async function finishDevRun(db, id, { status = 'success', output = null, error = null } = {}) {
  await ensureDevHandsSchema(db);
  await run(db, `UPDATE coast_dev_runs SET
    status = ?, output_summary = ?, error_summary = ?, related_json = ?, finished_at = ?
    WHERE id = ?`, [
    status === 'success' ? 'success' : 'error',
    output == null ? null : safeDevSummary(output),
    error ? redactSecretText(error?.message || error, 1200) : null,
    JSON.stringify(related(output || {})),
    Date.now(),
    id,
  ]);
}

export async function listDevRuns(db, { limit = 100, target_system: targetSystem = '', status = '' } = {}) {
  await ensureDevHandsSchema(db);
  const conditions = [];
  const params = [];
  if (targetSystem) { conditions.push('target_system = ?'); params.push(clip(targetSystem, 80)); }
  if (status) { conditions.push('status = ?'); params.push(clip(status, 40)); }
  params.push(Math.min(200, Math.max(1, Number(limit) || 100)));
  const rows = await all(db, `SELECT * FROM coast_dev_runs
    ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
    ORDER BY created_at DESC LIMIT ?`, params);
  return rows.map((row) => ({
    id: row.id,
    target_system: row.target_system,
    action_name: row.action_name,
    target_ref: row.target_ref || null,
    operation_type: row.operation_type,
    confirmation_required: bool(row.confirmation_required),
    confirmation_confirmed: bool(row.confirmation_confirmed),
    status: row.status,
    input_summary: parse(row.input_summary, null),
    output_summary: parse(row.output_summary, null),
    error_summary: row.error_summary || null,
    related: parse(row.related_json, {}),
    created_at: iso(row.created_at),
    finished_at: iso(row.finished_at),
  }));
}

export async function readArtifactCache(db, artifactId) {
  await ensureDevHandsSchema(db);
  const row = await db.prepare('SELECT payload_json, updated_at FROM coast_dev_artifact_cache WHERE artifact_id = ?')
    .bind(String(artifactId)).first();
  if (!row) return null;
  return { payload: parse(row.payload_json, null), updated_at: iso(row.updated_at) };
}

export async function writeArtifactCache(db, artifactId, payload) {
  await ensureDevHandsSchema(db);
  await run(db, `INSERT INTO coast_dev_artifact_cache (artifact_id, payload_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(artifact_id) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at`, [
    String(artifactId), JSON.stringify(payload || {}), Date.now(),
  ]);
  return payload;
}

export async function saveUpdateRecord(db, value = {}) {
  await ensureDevHandsSchema(db);
  const id = crypto.randomUUID();
  const now = Date.now();
  await run(db, `INSERT INTO coast_update_records (
    id, pwa_cache_version, native_version_code, native_version_name, artifact_id,
    artifact_name, apk_sha256, application_id, overwrite_installable,
    release_notes, known_risk, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    id,
    clip(value.pwa_cache_version, 120) || null,
    Number.isFinite(Number(value.native_version_code)) ? Math.trunc(Number(value.native_version_code)) : null,
    clip(value.native_version_name, 180) || null,
    clip(value.artifact_id, 120) || null,
    clip(value.artifact_name, 260) || null,
    clip(value.apk_sha256, 128) || null,
    clip(value.application_id, 180) || null,
    value.overwrite_installable === true ? 1 : 0,
    redactSecretText(value.release_notes, 4000) || null,
    redactSecretText(value.known_risk, 3000) || null,
    now,
  ]);
  return { id, created_at: iso(now) };
}

export async function listUpdateRecords(db, limit = 30) {
  await ensureDevHandsSchema(db);
  const rows = await all(db, `SELECT * FROM coast_update_records ORDER BY created_at DESC LIMIT ?`, [
    Math.min(100, Math.max(1, Number(limit) || 30)),
  ]);
  return rows.map((row) => ({
    id: row.id,
    pwa_cache_version: row.pwa_cache_version || null,
    native_version_code: row.native_version_code == null ? null : Number(row.native_version_code),
    native_version_name: row.native_version_name || null,
    artifact_id: row.artifact_id || null,
    artifact_name: row.artifact_name || null,
    apk_sha256: row.apk_sha256 || null,
    application_id: row.application_id || null,
    overwrite_installable: bool(row.overwrite_installable),
    release_notes: row.release_notes || null,
    known_risk: row.known_risk || null,
    created_at: iso(row.created_at),
  }));
}
