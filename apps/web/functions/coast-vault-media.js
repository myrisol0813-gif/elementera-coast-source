import { ensureChatAttachmentSchema } from './chat-attachments.js';
import { ensureVoiceSchema } from './voice-clips.js';
import { ensureTreasureSchema } from './coast-vault-treasures.js';

export const MEDIA_LIBRARY_LIMITS = Object.freeze({ results_per_page: 40, max_query_chars: 100 });

export class MediaLibraryError extends Error {
  constructor(type, message, status = 400) {
    super(message);
    this.type = type;
    this.status = status;
  }
}

function parameter(value) {
  return '%' + String(value || '').replace(/[!%_]/g, (part) => '!' + part) + '%';
}

function source(row) {
  const id = encodeURIComponent(row.id);
  const conversationId = encodeURIComponent(row.conversation_id);
  return {
    id: row.id, kind: row.kind, source_type: row.kind === 'audio' ? 'voice_clip' : 'chat_attachment',
    conversation_id: row.conversation_id, turn_id: row.turn_id,
    message_id: row.message_id || null,
    name: row.name, mime: row.mime, size: Number(row.size) || 0,
    source_text: row.source_text || null, created_at: Number(row.created_at) || 0,
    treasure_id: row.treasure_id || null, favorited: Boolean(row.treasure_id),
    storage_status: 'server_stored',
    url: row.kind === 'audio'
      ? '/api/voice/clips/' + id + '/audio'
      : '/api/chat/attachments/' + id + '?conversation_id=' + conversationId + '&inline=1',
  };
}

export async function listMediaLibrary(db, { kind = 'all', q = '', cursor = 0 } = {}) {
  const type = String(kind || 'all');
  if (!['all', 'audio', 'image', 'file'].includes(type)) {
    throw new MediaLibraryError('invalid_kind', '媒体分类无效。');
  }
  const search = String(q || '').trim();
  if (search.length > MEDIA_LIBRARY_LIMITS.max_query_chars) {
    throw new MediaLibraryError('invalid_query', '关键词不能超过 100 字。');
  }
  const offset = Number(cursor);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) {
    throw new MediaLibraryError('invalid_cursor', '媒体翻页位置无效。');
  }
  await ensureChatAttachmentSchema(db);
  await ensureVoiceSchema(db);
  await ensureTreasureSchema(db);

  // The existing tables are the source of truth. No duplicate binary store, no
  // paid regeneration and no destructive historical backfill is required.
  const sql = [
    'SELECT media.*, saved.id AS treasure_id FROM (',
    "SELECT a.id, a.conversation_id, a.turn_id, NULL AS message_id,",
    "a.kind AS kind, a.name, a.mime, a.size, NULL AS source_text, a.created_at",
    'FROM chat_attachments a JOIN conversations c ON c.id = a.conversation_id',
    "WHERE c.user_id = 'owner' AND c.deleted_at IS NULL AND c.conversation_kind = 'chat'",
    'UNION ALL',
    'SELECT v.id, v.conversation_id, v.turn_id, v.message_id,',
    "'audio' AS kind, '已生成语音' AS name, 'audio/mpeg' AS mime,",
    'v.audio_bytes AS size, v.text AS source_text, v.created_at',
    'FROM coast_voice_clips v JOIN conversations c ON c.id = v.conversation_id',
    "WHERE c.user_id = 'owner' AND c.deleted_at IS NULL AND c.conversation_kind = 'chat'",
    ') media LEFT JOIN coast_vault_treasures saved ON saved.source_key = (media.kind || \':\' || media.conversation_id || \':\' || media.id)',
    'WHERE (? = \'all\' OR media.kind = ?) AND (media.name LIKE ? ESCAPE \'!\' OR COALESCE(media.source_text, \'\') LIKE ? ESCAPE \'!\')',
    'ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?',
  ].join(' ');
  const result = await db.prepare(sql)
    .bind(type, type, parameter(search), parameter(search),
      MEDIA_LIBRARY_LIMITS.results_per_page + 1, offset).all();
  const rows = result?.results || [];
  const indexed = rows.slice(0, MEDIA_LIBRARY_LIMITS.results_per_page);
  const stateCache = new Map();
  for (const row of indexed) {
    if (row.kind === 'audio' || !row.turn_id) continue;
    if (!stateCache.has(row.conversation_id)) {
      const state = await db.prepare('SELECT state_json FROM conversation_states WHERE conversation_id = ?')
        .bind(row.conversation_id).first();
      let turns = [];
      try { turns = JSON.parse(state?.state_json || '{}').turns || []; } catch { /* no fabricated source */ }
      stateCache.set(row.conversation_id, turns);
    }
    const turn = stateCache.get(row.conversation_id).find(item => item.id === row.turn_id);
    const variants = [
      ...(turn?.user?.variants || []),
      ...Object.values(turn?.assistant?.variantsByUserVariant || {}).flat(),
    ];
    const sourceVariant = variants.find(item => item.attachments?.some(attachment => attachment.id === row.id));
    if (sourceVariant) row.message_id = sourceVariant.id;
  }
  return {
    items: indexed.map(source),
    next_cursor: rows.length > MEDIA_LIBRARY_LIMITS.results_per_page
      ? String(offset + MEDIA_LIBRARY_LIMITS.results_per_page) : null,
    limits: MEDIA_LIBRARY_LIMITS,
    coverage: ['chat_attachments', 'coast_voice_clips'],
    // Imported/external-only media and already-removed attachments are not
    // reconstructed by this read-only index.
  };
}
