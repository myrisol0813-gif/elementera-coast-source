import { ensureChatSchema, getConversation, readConversationState } from './chat-store.js';
import { ensureChatAttachmentSchema } from './chat-attachments.js';
import { ensureVoiceSchema } from './voice-clips.js';

export const TREASURE_LIMITS = Object.freeze({
  note_chars: 1200, result_page: 40, excerpt_chars: 12000, paragraphs_per_item: 40,
});

export class TreasureError extends Error {
  constructor(type, message, status = 400) {
    super(message);
    this.type = type;
    this.status = status;
  }
}

function validId(value, label) {
  const id = String(value || '').trim();
  if (!id || id.length > 160 || !/^[a-zA-Z0-9_:.-]+$/.test(id)) {
    throw new TreasureError('invalid_' + label, '找不到对应的收藏来源。');
  }
  return id;
}

function like(value) {
  return '%' + String(value).replace(/[!%_]/g, (ch) => '!' + ch) + '%';
}

async function initialize(db) {
  await ensureChatSchema(db);
  await db.prepare(
    'CREATE TABLE IF NOT EXISTS coast_vault_treasures (' +
    'id TEXT PRIMARY KEY, source_key TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, ' +
    'conversation_id TEXT NOT NULL, turn_id TEXT, message_id TEXT, source_id TEXT NOT NULL, ' +
    'role TEXT, excerpt TEXT NOT NULL, selections_json TEXT NOT NULL, notes TEXT NOT NULL, ' +
    'created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)'
  ).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_coast_vault_treasures_time ON coast_vault_treasures(updated_at DESC)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_coast_vault_treasures_conversation ON coast_vault_treasures(conversation_id)').run();
}

export function selectTreasureParagraphs(text, requested) {
  if (requested == null) return { excerpt: text, indices: [] };
  const pieces = String(text).split(/\n\s*\n/);
  if (!Array.isArray(requested) || !requested.length || requested.length > TREASURE_LIMITS.paragraphs_per_item) {
    throw new TreasureError('invalid_selection', '请至少选中一个有效自然段。');
  }
  const indices = [...new Set(requested)];
  if (indices.length !== requested.length || indices.some(i =>
    !Number.isInteger(i) || i < 0 || i >= pieces.length)) {
    throw new TreasureError('invalid_selection', '段落序号与原文不匹配。');
  }
  indices.sort((a, b) => a - b);
  return { excerpt: indices.map(i => pieces[i]).join('\n\n'), indices };
}

function findMessage(state, id) {
  for (const turn of state.turns || []) {
    for (const user of turn.user?.variants || []) {
      if (user.id === id && !user.hidden) return { turn, variant: user, role: 'user' };
    }
    for (const list of Object.values(turn.assistant?.variantsByUserVariant || {})) {
      for (const assistant of list || []) {
        if (assistant.id === id) return { turn, variant: assistant, role: 'assistant' };
      }
    }
  }
  return null;
}

function shape(row) {
  return {
    id: row.id, kind: row.kind, conversation_id: row.conversation_id,
    turn_id: row.turn_id, message_id: row.message_id, source_id: row.source_id,
    role: row.role, excerpt: row.excerpt,
    paragraph_indices: JSON.parse(row.selections_json || '[]'),
    notes: row.notes, created_at: row.created_at, updated_at: row.updated_at,
  };
}

export async function listTreasures(db, { kind = 'all', q = '', cursor = 0, conversation_id = '', turn_id = '' } = {}) {
  await initialize(db);
  const type = String(kind || 'all');
  if (!['all', 'text', 'audio', 'image', 'file'].includes(type)) {
    throw new TreasureError('invalid_kind', '收藏分类无效。');
  }
  const query = String(q || '').trim();
  if (query.length > 100) throw new TreasureError('invalid_query', '搜索词不能超过 100 字。');
  const offset = Number(cursor);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) {
    throw new TreasureError('invalid_cursor', '收藏翻页位置无效。');
  }
  const conversationId = conversation_id ? validId(conversation_id, 'conversation') : '';
  const turnId = turn_id ? validId(turn_id, 'turn') : '';
  const result = await db.prepare(
    "SELECT t.* FROM coast_vault_treasures t JOIN conversations c ON c.id = t.conversation_id " +
    "WHERE c.user_id = 'owner' AND (? = 'all' OR t.kind = ?) " +
    "AND (? = '' OR t.conversation_id = ?) AND (? = '' OR t.turn_id = ?) " +
    "AND (t.excerpt LIKE ? ESCAPE '!' OR t.notes LIKE ? ESCAPE '!') " +
    "ORDER BY t.updated_at DESC, t.id DESC LIMIT ? OFFSET ?"
  ).bind(type, type, conversationId, conversationId, turnId, turnId,
    like(query), like(query), TREASURE_LIMITS.result_page + 1, offset).all();
  const rows = result?.results || [];
  return {
    items: rows.slice(0, TREASURE_LIMITS.result_page).map(shape),
    next_cursor: rows.length > TREASURE_LIMITS.result_page ? String(offset + TREASURE_LIMITS.result_page) : null,
    limits: TREASURE_LIMITS,
  };
}

export async function saveTreasure(db, input = {}) {
  await initialize(db);
  const conversationId = validId(input.conversation_id, 'conversation');
  const sourceId = validId(input.source_id || input.message_id, 'source');
  const kind = String(input.kind || '');
  if (!['text', 'audio', 'image', 'file'].includes(kind)) {
    throw new TreasureError('invalid_kind', '暂不支持该收藏类型。');
  }
  await getConversation(db, conversationId);
  const notes = String(input.notes || '').trim();
  if (notes.length > TREASURE_LIMITS.note_chars) throw new TreasureError('notes_too_long', '备注最多 1200 字。');
  let messageId = null, turnId = null, role = null, excerpt = '', indices = [];
  if (kind === 'text') {
    const state = await readConversationState(db, conversationId);
    const found = findMessage(state, sourceId);
    if (!found) throw new TreasureError('source_not_found', '这条聊天原文已不存在。', 404);
    const selected = selectTreasureParagraphs(found.variant.content, input.paragraph_indices);
    excerpt = selected.excerpt;
    indices = selected.indices;
    messageId = sourceId;
    turnId = found.turn.id;
    role = found.role;
  } else if (kind === 'audio') {
    await ensureVoiceSchema(db);
    const row = await db.prepare(
      'SELECT id, turn_id, message_id, text FROM coast_voice_clips WHERE id = ? AND conversation_id = ?'
    ).bind(sourceId, conversationId).first();
    if (!row) throw new TreasureError('source_not_found', '这段已生成语音不存在，未重新生成。', 404);
    excerpt = row.text || '';
    turnId = row.turn_id;
    messageId = row.message_id;
    role = 'assistant';
  } else {
    await ensureChatAttachmentSchema(db);
    const row = await db.prepare(
      'SELECT id, turn_id, name, kind FROM chat_attachments WHERE id = ? AND conversation_id = ?'
    ).bind(sourceId, conversationId).first();
    if (!row || row.kind !== kind) throw new TreasureError('source_not_found', '这份图片或附件已不存在。', 404);
    excerpt = row.name || '';
    turnId = row.turn_id;
    role = 'user';
  }
  if (excerpt.length > TREASURE_LIMITS.excerpt_chars) {
    throw new TreasureError('excerpt_too_long', '单条摘录最多 12000 字。');
  }
  const sourceKey = kind + ':' + sourceId;
  const now = Date.now();
  const id = 'treasure_' + crypto.randomUUID();
  await db.prepare(
    'INSERT INTO coast_vault_treasures (id,source_key,kind,conversation_id,turn_id,message_id,source_id,role,excerpt,selections_json,notes,created_at,updated_at) ' +
    'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source_key) DO UPDATE SET ' +
    'excerpt = excluded.excerpt, selections_json = excluded.selections_json, notes = excluded.notes, updated_at = excluded.updated_at'
  ).bind(id, sourceKey, kind, conversationId, turnId, messageId, sourceId, role,
    excerpt, JSON.stringify(indices), notes, now, now).run();
  const result = await db.prepare('SELECT * FROM coast_vault_treasures WHERE source_key = ?').bind(sourceKey).first();
  return shape(result);
}

export async function updateTreasure(db, id, { notes } = {}) {
  await initialize(db);
  const key = validId(id, 'treasure');
  if (typeof notes !== 'string' || notes.length > TREASURE_LIMITS.note_chars) {
    throw new TreasureError('invalid_notes', '备注最多 1200 字。');
  }
  const changed = await db.prepare(
    "UPDATE coast_vault_treasures SET notes = ?, updated_at = ? WHERE id = ? " +
    "AND conversation_id IN (SELECT id FROM conversations WHERE user_id = 'owner')"
  ).bind(notes, Date.now(), key).run();
  if (!changed?.meta?.changes) throw new TreasureError('not_found', '收藏不存在。', 404);
  return shape(await db.prepare('SELECT * FROM coast_vault_treasures WHERE id = ?').bind(key).first());
}

export async function removeTreasure(db, id) {
  await initialize(db);
  const key = validId(id, 'treasure');
  const response = await db.prepare(
    "DELETE FROM coast_vault_treasures WHERE id = ? " +
    "AND conversation_id IN (SELECT id FROM conversations WHERE user_id = 'owner')"
  ).bind(key).run();
  return { removed: Boolean(response?.meta?.changes), media_deleted: false };
}

export const ensureTreasureSchema = initialize;
