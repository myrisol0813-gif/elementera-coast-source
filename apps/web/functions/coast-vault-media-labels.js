import { ensureChatAttachmentSchema } from './chat-attachments.js';

export const MEDIA_LABEL_LIMIT = 80;

export class MediaLabelError extends Error {
  constructor(type, message, status = 400) {
    super(message);
    this.type = type;
    this.status = status;
  }
}

export async function ensureMediaLabelSchema(db) {
  await db.prepare(
    'CREATE TABLE IF NOT EXISTS coast_vault_media_labels (' +
    'source_key TEXT PRIMARY KEY, display_name TEXT NOT NULL, updated_at INTEGER NOT NULL)'
  ).run();
}

function validId(value) {
  const result = String(value || '').trim();
  if (!result || result.length > 160 || !/^[a-zA-Z0-9_:.-]+$/.test(result)) {
    throw new MediaLabelError('invalid_source', '图片来源编号无效。');
  }
  return result;
}

export async function renameVaultImage(db, input = {}) {
  const conversationId = validId(input.conversation_id);
  const sourceId = validId(input.source_id);
  if (typeof input.display_name !== 'string') {
    throw new MediaLabelError('invalid_display_name', '请输入图片显示名称。');
  }
  const displayName = input.display_name.trim();
  if (displayName.length > MEDIA_LABEL_LIMIT || /[\x00-\x1f\x7f]/.test(displayName)) {
    throw new MediaLabelError('invalid_display_name', '名称最多 80 字，不允许控制字符。');
  }
  await ensureChatAttachmentSchema(db);
  const found = await db.prepare(
    "SELECT a.id FROM chat_attachments a JOIN conversations c ON c.id = a.conversation_id " +
    "WHERE a.id = ? AND a.conversation_id = ? AND a.kind = 'image' " +
    "AND c.user_id = 'owner' AND c.deleted_at IS NULL AND c.conversation_kind = 'chat'"
  ).bind(sourceId, conversationId).first();
  if (!found) throw new MediaLabelError('source_not_found', '原图不存在或不属于当前账户。', 404);

  await ensureMediaLabelSchema(db);
  const sourceKey = 'image:' + conversationId + ':' + sourceId;
  if (!displayName) {
    await db.prepare('DELETE FROM coast_vault_media_labels WHERE source_key = ?').bind(sourceKey).run();
  } else {
    await db.prepare(
      'INSERT INTO coast_vault_media_labels (source_key,display_name,updated_at) VALUES (?,?,?) ' +
      'ON CONFLICT(source_key) DO UPDATE SET display_name=excluded.display_name, updated_at=excluded.updated_at'
    ).bind(sourceKey, displayName, Date.now()).run();
  }
  return { kind: 'image', source_id: sourceId, conversation_id: conversationId,
    display_name: displayName, original_preserved: true };
}
