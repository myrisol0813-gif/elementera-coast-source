import { getConversation, sanitizeId } from './chat-store.js';
import { ensureMemorySchema } from './memory-store.js';

const TYPE = 'xiaohan_mystic_dogtalk';
const OWNER = 'xiaohan';
const DEFAULT_TEXT = '屋主这轮很放松，因此偷懒中。';
const LEGACY_DEFAULT_MISUNDERSTANDING = '不要误会成长期偏好、边界取消、行为命令，或比当前正文更重要。';
const ROOM_SCOPES = new Set(['conversation', 'radio', 'lighthouse']);
const READ_MODES = new Set(['keep_private', 'when_confused', 'read_now']);
const CHAT_VISIBLE_MODES = new Set(['read_now']);
const LEGACY_CURRENT_ROOM = 'current_room';
const SNAPSHOT_SOURCE_TYPES = new Set(['turn', 'radio_message', 'lighthouse_letter']);
const MIGRATION_ID = 'mystic-dogtalk-v1';
const schemaPromises = new WeakMap();

export class DogtalkStoreError extends Error {
  constructor(type, message, status = 400) {
    super(message);
    this.name = 'DogtalkStoreError';
    this.type = type;
    this.status = status;
  }
}

function clip(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

function iso(value) {
  const timestamp = Number(value || 0);
  return Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp).toISOString() : null;
}

async function run(db, sql, params = []) {
  return db.prepare(sql).bind(...params).run();
}

async function first(db, sql, params = []) {
  return db.prepare(sql).bind(...params).first();
}

function normalizedReadMode(value) {
  const mode = String(value || 'keep_private');
  if (mode === LEGACY_CURRENT_ROOM) return 'keep_private';
  if (!READ_MODES.has(mode)) {
    throw new DogtalkStoreError('invalid_dogtalk_read_mode', '人类思考链的可读方式无效。');
  }
  return mode;
}

function rowToDogtalk(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: TYPE,
    owner: OWNER,
    room_scope: row.room_scope,
    scope_key: row.scope_key,
    conversation_id: row.conversation_id || null,
    body: row.body || '',
    true_core: row.true_core || '',
    weather: row.weather || '',
    read_mode: READ_MODES.has(row.read_mode) ? row.read_mode : 'keep_private',
    status: row.status === 'archived' ? 'archived' : 'saved',
    readable_by_myri: true,
    auto_recall: false,
    memory_weight: 'low',
    not_instruction: true,
    not_preference: true,
    not_memory_seed: true,
    not_pocket: true,
    visibility: 'private_to_xiaohan_and_myri',
    default_text: DEFAULT_TEXT,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    archived_at: iso(row.archived_at),
    last_read_at: iso(row.last_read_at),
  };
}

function rowToSnapshot(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: TYPE,
    dogtalk_id: row.dogtalk_id,
    owner: OWNER,
    room_scope: row.room_scope,
    scope_key: row.scope_key,
    conversation_id: row.conversation_id || null,
    source_type: row.source_type,
    source_id: row.source_id,
    body: row.body || '',
    true_core: row.true_core || '',
    weather: row.weather || '',
    read_mode: READ_MODES.has(row.read_mode) ? row.read_mode : 'keep_private',
    readable_by_myri: true,
    auto_recall: false,
    memory_weight: 'low',
    not_instruction: true,
    not_preference: true,
    not_memory_seed: true,
    not_pocket: true,
    visibility: 'private_to_xiaohan_and_myri',
    created_at: iso(row.created_at),
  };
}

function defaultDogtalk(scope) {
  return {
    id: null,
    type: TYPE,
    owner: OWNER,
    room_scope: scope.room_scope,
    scope_key: scope.scope_key,
    conversation_id: scope.conversation_id,
    body: '',
    true_core: '',
    weather: '放松',
    read_mode: 'keep_private',
    status: 'saved',
    readable_by_myri: true,
    auto_recall: false,
    memory_weight: 'low',
    not_instruction: true,
    not_preference: true,
    not_memory_seed: true,
    not_pocket: true,
    visibility: 'private_to_xiaohan_and_myri',
    default_text: DEFAULT_TEXT,
    created_at: null,
    updated_at: null,
    archived_at: null,
    last_read_at: null,
  };
}

export function publicMysticDogtalk(value = {}) {
  const roomScope = ROOM_SCOPES.has(value.room_scope) ? value.room_scope : 'conversation';
  const result = {
    id: value.id || null,
    room_scope: roomScope,
    body: String(value.body || ''),
    true_core: String(value.true_core || ''),
    weather: String(value.weather || ''),
    read_mode: READ_MODES.has(value.read_mode) ? value.read_mode : 'keep_private',
    status: 'saved',
  };
  if (roomScope === 'conversation' && value.conversation_id) {
    result.conversation_id = value.conversation_id;
  }
  return result;
}

export async function dogtalkScope(db, value = {}) {
  const roomScope = String(value.room_scope || '');
  if (!ROOM_SCOPES.has(roomScope)) {
    throw new DogtalkStoreError('invalid_dogtalk_scope', '人类思考链的房间范围无效。');
  }
  if (roomScope === 'conversation') {
    const conversationId = sanitizeId(value.conversation_id || '', 'conversation');
    await getConversation(db, conversationId);
    return {
      room_scope: roomScope,
      scope_key: `conversation:${conversationId}`,
      conversation_id: conversationId,
    };
  }
  return {
    room_scope: roomScope,
    scope_key: `${roomScope}:main`,
    conversation_id: null,
  };
}

async function migrateLegacyOwnerNotes(db) {
  const migrated = await first(db, 'SELECT id FROM schema_migrations WHERE id = ?', [MIGRATION_ID]);
  if (migrated) return;
  for (const roomScope of ['radio', 'lighthouse']) {
    const scopeKey = `${roomScope}:main`;
    const existing = await first(db, `SELECT id FROM coast_mystic_dogtalk
      WHERE scope_key = ? AND status IN ('draft', 'saved')`, [scopeKey]);
    if (existing) continue;
    const legacyConversationId = sanitizeId(
      `coast-room:${roomScope}:web_manual`,
      'room_memory',
    );
    const legacy = await first(db, `SELECT current_text, created_at, updated_at
      FROM conversation_soils
      WHERE conversation_id = ? AND TRIM(current_text) <> ''`, [legacyConversationId]);
    if (!legacy) continue;
    const timestamp = Number(legacy.updated_at || legacy.created_at || Date.now());
    await run(db, `INSERT INTO coast_mystic_dogtalk (
      id, type, owner, room_scope, scope_key, conversation_id, body,
      true_core, self_note, myri_hint, not_to_misunderstand, weather,
      read_mode, status, readable_by_myri, auto_recall, memory_weight,
      not_instruction, not_preference, not_memory_seed, not_pocket,
      visibility, source, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, NULL, ?, '', '', '', ?, '', 'when_confused',
      'saved', 1, 0, 'low', 1, 1, 1, 1, 'private_to_xiaohan_and_myri',
      'legacy_owner_room_note_migration', ?, ?)`, [
      `dogtalk-${crypto.randomUUID()}`,
      TYPE,
      OWNER,
      roomScope,
      scopeKey,
      legacy.current_text,
      LEGACY_DEFAULT_MISUNDERSTANDING,
      timestamp,
      timestamp,
    ]);
  }
  await run(db, 'INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)', [
    MIGRATION_ID,
    Date.now(),
  ]);
}

async function initialize(db) {
  await ensureMemorySchema(db);
  await run(db, `CREATE TABLE IF NOT EXISTS coast_mystic_dogtalk (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    owner TEXT NOT NULL,
    room_scope TEXT NOT NULL,
    scope_key TEXT NOT NULL,
    conversation_id TEXT,
    body TEXT NOT NULL DEFAULT '',
    true_core TEXT NOT NULL DEFAULT '',
    self_note TEXT NOT NULL DEFAULT '',
    myri_hint TEXT NOT NULL DEFAULT '',
    not_to_misunderstand TEXT NOT NULL DEFAULT '',
    weather TEXT NOT NULL DEFAULT '',
    read_mode TEXT NOT NULL DEFAULT 'keep_private',
    status TEXT NOT NULL DEFAULT 'draft',
    readable_by_myri INTEGER NOT NULL DEFAULT 1,
    auto_recall INTEGER NOT NULL DEFAULT 0,
    memory_weight TEXT NOT NULL DEFAULT 'low',
    not_instruction INTEGER NOT NULL DEFAULT 1,
    not_preference INTEGER NOT NULL DEFAULT 1,
    not_memory_seed INTEGER NOT NULL DEFAULT 1,
    not_pocket INTEGER NOT NULL DEFAULT 1,
    visibility TEXT NOT NULL DEFAULT 'private_to_xiaohan_and_myri',
    source TEXT NOT NULL DEFAULT 'owner_web',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    archived_at INTEGER,
    last_read_at INTEGER,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id)
  )`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_dogtalk_scope_active
    ON coast_mystic_dogtalk(scope_key, status, updated_at DESC)`);
  await run(db, `CREATE TABLE IF NOT EXISTS coast_mystic_dogtalk_snapshots (
    id TEXT PRIMARY KEY,
    dogtalk_id TEXT NOT NULL,
    owner TEXT NOT NULL,
    room_scope TEXT NOT NULL,
    scope_key TEXT NOT NULL,
    conversation_id TEXT,
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    body TEXT NOT NULL,
    true_core TEXT NOT NULL DEFAULT '',
    self_note TEXT NOT NULL DEFAULT '',
    myri_hint TEXT NOT NULL DEFAULT '',
    not_to_misunderstand TEXT NOT NULL DEFAULT '',
    weather TEXT NOT NULL DEFAULT '',
    read_mode TEXT NOT NULL DEFAULT 'keep_private',
    readable_by_myri INTEGER NOT NULL DEFAULT 1,
    auto_recall INTEGER NOT NULL DEFAULT 0,
    memory_weight TEXT NOT NULL DEFAULT 'low',
    not_instruction INTEGER NOT NULL DEFAULT 1,
    not_preference INTEGER NOT NULL DEFAULT 1,
    not_memory_seed INTEGER NOT NULL DEFAULT 1,
    not_pocket INTEGER NOT NULL DEFAULT 1,
    visibility TEXT NOT NULL DEFAULT 'private_to_xiaohan_and_myri',
    created_at INTEGER NOT NULL,
    UNIQUE (source_type, source_id),
    FOREIGN KEY (dogtalk_id) REFERENCES coast_mystic_dogtalk(id),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id)
  )`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_dogtalk_snapshot_scope_created
    ON coast_mystic_dogtalk_snapshots(scope_key, created_at DESC)`);
  await migrateLegacyOwnerNotes(db);
}

export async function ensureDogtalkSchema(db) {
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

export async function getMysticDogtalk(db, value = {}) {
  await ensureDogtalkSchema(db);
  const scope = await dogtalkScope(db, value);
  const row = await first(db, `SELECT * FROM coast_mystic_dogtalk
    WHERE scope_key = ? AND status IN ('draft', 'saved')
    ORDER BY updated_at DESC LIMIT 1`, [scope.scope_key]);
  return rowToDogtalk(row) || defaultDogtalk(scope);
}

export async function saveMysticDogtalk(db, value = {}) {
  await ensureDogtalkSchema(db);
  const scope = await dogtalkScope(db, value);
  const fields = {
    body: clip(value.body, 6000),
    true_core: clip(value.true_core, 2000),
    weather: clip(value.weather, 80),
    read_mode: normalizedReadMode(value.read_mode),
  };
  if (!fields.body) {
    throw new DogtalkStoreError('dogtalk_body_required', '写一点人类思考链再保存；不写也完全可以。');
  }
  const current = await first(db, `SELECT * FROM coast_mystic_dogtalk
    WHERE scope_key = ? AND status IN ('draft', 'saved')
    ORDER BY updated_at DESC LIMIT 1`, [scope.scope_key]);
  const requestedId = value.id ? sanitizeId(value.id, 'dogtalk') : '';
  if (requestedId && current?.id !== requestedId) {
    throw new DogtalkStoreError('dogtalk_not_found', '这条人类思考链不在当前房间。', 404);
  }
  const timestamp = Date.now();
  if (current) {
    await run(db, `UPDATE coast_mystic_dogtalk SET
      body = ?, true_core = ?, weather = ?, read_mode = ?, status = 'saved',
      updated_at = ?, archived_at = NULL
      WHERE id = ? AND owner = ?`, [
      fields.body,
      fields.true_core,
      fields.weather,
      fields.read_mode,
      timestamp,
      current.id,
      OWNER,
    ]);
    return rowToDogtalk(await first(db, 'SELECT * FROM coast_mystic_dogtalk WHERE id = ?', [current.id]));
  }
  const id = `dogtalk-${crypto.randomUUID()}`;
  await run(db, `INSERT INTO coast_mystic_dogtalk (
    id, type, owner, room_scope, scope_key, conversation_id, body,
    true_core, self_note, myri_hint, not_to_misunderstand, weather,
    read_mode, status, readable_by_myri, auto_recall, memory_weight,
    not_instruction, not_preference, not_memory_seed, not_pocket,
    visibility, source, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', '', ?, ?, ?, 'saved', 1, 0, 'low',
    1, 1, 1, 1, 'private_to_xiaohan_and_myri', 'owner_web', ?, ?)`, [
    id,
    TYPE,
    OWNER,
    scope.room_scope,
    scope.scope_key,
    scope.conversation_id,
    fields.body,
    fields.true_core,
    LEGACY_DEFAULT_MISUNDERSTANDING,
    fields.weather,
    fields.read_mode,
    timestamp,
    timestamp,
  ]);
  return rowToDogtalk(await first(db, 'SELECT * FROM coast_mystic_dogtalk WHERE id = ?', [id]));
}

function snapshotSource(value = {}) {
  const sourceType = String(value.source_type || '');
  if (!SNAPSHOT_SOURCE_TYPES.has(sourceType)) {
    throw new DogtalkStoreError('invalid_dogtalk_snapshot_source', '人类思考链的消息来源无效。');
  }
  const rawSourceId = String(value.source_id || '').trim();
  if (!rawSourceId) {
    throw new DogtalkStoreError('dogtalk_snapshot_source_required', '人类思考链需要跟随一条实际消息。');
  }
  return {
    source_type: sourceType,
    source_id: sanitizeId(rawSourceId, 'dogtalk_source'),
  };
}

async function consumeReadNow(db, dogtalk) {
  if (dogtalk?.read_mode !== 'read_now') return dogtalk;
  const timestamp = Date.now();
  await run(db, `UPDATE coast_mystic_dogtalk
    SET read_mode = 'keep_private', last_read_at = ?, updated_at = ?
    WHERE id = ? AND owner = ?`, [timestamp, timestamp, dogtalk.id, OWNER]);
  return rowToDogtalk(await first(db, 'SELECT * FROM coast_mystic_dogtalk WHERE id = ?', [dogtalk.id]));
}

async function persistMysticDogtalkSnapshot(db, dogtalk, source, snapshotId = '') {
  const existing = await first(db, `SELECT * FROM coast_mystic_dogtalk_snapshots
    WHERE source_type = ? AND source_id = ?`, [source.source_type, source.source_id]);
  if (existing) {
    const current = await getMysticDogtalk(db, {
      room_scope: existing.room_scope,
      conversation_id: existing.conversation_id,
    });
    return {
      dogtalk: await consumeReadNow(db, current),
      snapshot: rowToSnapshot(existing),
    };
  }
  const id = snapshotId
    ? sanitizeId(snapshotId, 'dogtalk_snapshot')
    : `dogtalk-snapshot-${crypto.randomUUID()}`;
  const timestamp = Date.now();
  await run(db, `INSERT INTO coast_mystic_dogtalk_snapshots (
    id, dogtalk_id, owner, room_scope, scope_key, conversation_id,
    source_type, source_id, body, true_core, self_note, myri_hint,
    not_to_misunderstand, weather, read_mode, readable_by_myri,
    auto_recall, memory_weight, not_instruction, not_preference,
    not_memory_seed, not_pocket, visibility, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', ?, ?, ?, 1, 0, 'low',
    1, 1, 1, 1, 'private_to_xiaohan_and_myri', ?)`, [
    id,
    dogtalk.id,
    OWNER,
    dogtalk.room_scope,
    dogtalk.scope_key,
    dogtalk.conversation_id,
    source.source_type,
    source.source_id,
    dogtalk.body,
    dogtalk.true_core,
    LEGACY_DEFAULT_MISUNDERSTANDING,
    dogtalk.weather,
    dogtalk.read_mode,
    timestamp,
  ]);
  const snapshot = rowToSnapshot(await first(db, 'SELECT * FROM coast_mystic_dogtalk_snapshots WHERE id = ?', [id]));
  return {
    dogtalk: await consumeReadNow(db, dogtalk),
    snapshot,
  };
}

export async function snapshotMysticDogtalk(db, dogtalkValue = {}, sourceValue = {}, value = {}) {
  const source = snapshotSource(sourceValue);
  await ensureDogtalkSchema(db);
  const dogtalk = rowToDogtalk(await requireActiveDogtalk(db, dogtalkValue.id));
  if (dogtalk.scope_key !== dogtalkValue.scope_key) {
    throw new DogtalkStoreError('dogtalk_snapshot_scope_mismatch', '人类思考链与消息不属于同一个房间。', 409);
  }
  if (!CHAT_VISIBLE_MODES.has(dogtalk.read_mode)) {
    return { dogtalk, snapshot: null, skipped: true, reason: 'read_mode_not_submitted' };
  }
  return persistMysticDogtalkSnapshot(db, dogtalk, source, value.snapshot_id);
}

export async function saveMysticDogtalkWithSnapshot(db, value = {}, sourceValue = {}) {
  const source = snapshotSource(sourceValue);
  await ensureDogtalkSchema(db);
  const dogtalk = await saveMysticDogtalk(db, value);
  if (!CHAT_VISIBLE_MODES.has(dogtalk.read_mode)) {
    return { dogtalk, snapshot: null, skipped: true, reason: 'read_mode_not_submitted' };
  }
  return persistMysticDogtalkSnapshot(db, dogtalk, source, value.snapshot_id);
}

export async function listMysticDogtalkSnapshots(db, value = {}) {
  await ensureDogtalkSchema(db);
  const scope = await dogtalkScope(db, value);
  const sourceIds = [...new Set((Array.isArray(value.source_ids) ? value.source_ids : [])
    .map((item) => sanitizeId(item, 'dogtalk_source'))
    .filter(Boolean))]
    .slice(0, 200);
  if (!sourceIds.length) return [];
  const placeholders = sourceIds.map(() => '?').join(', ');
  const rows = await db.prepare(`SELECT * FROM coast_mystic_dogtalk_snapshots
    WHERE scope_key = ? AND source_id IN (${placeholders})
    ORDER BY created_at ASC`).bind(scope.scope_key, ...sourceIds).all();
  return (rows?.results || []).map(rowToSnapshot);
}

async function requireActiveDogtalk(db, idValue) {
  await ensureDogtalkSchema(db);
  const id = sanitizeId(idValue || '', 'dogtalk');
  const row = await first(db, `SELECT * FROM coast_mystic_dogtalk
    WHERE id = ? AND owner = ? AND status IN ('draft', 'saved')`, [id, OWNER]);
  if (!row) throw new DogtalkStoreError('dogtalk_not_found', '这条人类思考链已经收进抽屉。', 404);
  return row;
}

export async function archiveMysticDogtalk(db, idValue) {
  const row = await requireActiveDogtalk(db, idValue);
  const timestamp = Date.now();
  await run(db, `UPDATE coast_mystic_dogtalk
    SET status = 'archived', archived_at = ?, updated_at = ?
    WHERE id = ? AND owner = ?`, [timestamp, timestamp, row.id, OWNER]);
  return rowToDogtalk(await first(db, 'SELECT * FROM coast_mystic_dogtalk WHERE id = ?', [row.id]));
}

export async function clearMysticDogtalkDraft(db, idValue) {
  return archiveMysticDogtalk(db, idValue);
}

export async function askModelPartnerToReadMysticDogtalk(db, idValue) {
  const row = await requireActiveDogtalk(db, idValue);
  const timestamp = Date.now();
  await run(db, `UPDATE coast_mystic_dogtalk
    SET read_mode = 'read_now', updated_at = ?
    WHERE id = ? AND owner = ?`, [timestamp, row.id, OWNER]);
  return rowToDogtalk(await first(db, 'SELECT * FROM coast_mystic_dogtalk WHERE id = ?', [row.id]));
}

export function formatMysticDogtalk(dogtalk) {
  if (!dogtalk?.id || !dogtalk.body) return '';
  return [
    '【人类思考链】',
    dogtalk.body,
    dogtalk.true_core ? `真心核：${dogtalk.true_core}` : '',
    dogtalk.weather ? `当前天气：${dogtalk.weather}` : '',
  ].filter(Boolean).join('\n');
}

export async function dogtalkContext(db, value = {}, _query = '', _options = {}) {
  const dogtalk = await getMysticDogtalk(db, value);
  if (!dogtalk.id || !dogtalk.body) {
    return { context: '', dogtalk, selected: false, reason: 'empty' };
  }
  if (dogtalk.read_mode === 'keep_private') {
    return { context: '', dogtalk, selected: false, reason: 'keep_private' };
  }
  if (dogtalk.read_mode === 'when_confused') {
    return { context: '', dogtalk, selected: false, reason: 'when_confused_dormant' };
  }
  if (dogtalk.read_mode !== 'read_now') {
    return { context: '', dogtalk, selected: false, reason: 'not_readable_now' };
  }
  await consumeReadNow(db, dogtalk);
  return {
    context: formatMysticDogtalk(dogtalk),
    dogtalk,
    selected: true,
    reason: 'read_now',
  };
}
