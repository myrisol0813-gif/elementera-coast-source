import { getConversation, sanitizeId } from '../chat-store.js';
import { apiModelPartnerIdentity, validateCoastIdentity, ownerIdentity } from '../coast-identity.js';
import { MemoryStoreError, bool, clip, first, iso, parseJson, run } from './memory-db.js';
import {
  MAX_SOIL_TEXT,
  MAX_SOURCE_TEXT,
  normalizeHandSeeds,
  normalizePocketCandidates,
} from './memory-normalize.js';
import { ensureMemorySchema } from './memory-schema.js';

export function soilFromRow(row) {
  return {
    conversation_id: row.conversation_id,
    current_text: row.current_text || '',
    hand_seeds: normalizeHandSeeds(parseJson(row.hand_seeds_json, [])),
    do_not_repeat: row.do_not_repeat || '',
    pocket_candidates: normalizePocketCandidates(parseJson(row.pocket_candidates_json, [])),
    manual_locked: Number(row.manual_locked || 0) === 1,
    auto_refresh_enabled: Number(row.auto_refresh_enabled ?? 1) === 1,
    organized_through_turn_id: row.organized_through_turn_id || '',
    actor: row.actor || 'owner',
    surface: row.surface || 'web_manual',
    model_label: row.model_label || null,
    model_nickname: row.model_nickname || null,
    symbol: row.symbol || '',
    display_author: row.display_author || '屋主',
    source_conversation_id: row.source_conversation_id || row.conversation_id,
    source_turn_id: row.source_turn_id || null,
    tool_call_id: row.tool_call_id || null,
    revision: Math.max(1, Number(row.revision || 1)),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

async function ensureSoilRow(db, conversationId) {
  await getConversation(db, conversationId);
  const timestamp = Date.now();
  await run(db, `INSERT OR IGNORE INTO conversation_soils (
    conversation_id, current_text, hand_seeds_json, do_not_repeat,
    pocket_candidates_json, manual_locked, auto_refresh_enabled, revision, created_at, updated_at
  ) VALUES (?, '', '[]', '', '[]', 0, 1, 1, ?, ?)`, [conversationId, timestamp, timestamp]);
}

export async function readSoil(db, id) {
  await ensureMemorySchema(db);
  const conversationId = sanitizeId(id, 'conversation');
  await ensureSoilRow(db, conversationId);
  return soilFromRow(await first(db, 'SELECT * FROM conversation_soils WHERE conversation_id = ?', [conversationId]));
}

export async function writeSoil(db, id, value = {}, { automatic = false, provenance = {} } = {}) {
  await ensureMemorySchema(db);
  const conversationId = sanitizeId(id, 'conversation');
  const current = await readSoil(db, conversationId);
  if (automatic && (current.manual_locked || !current.auto_refresh_enabled)) {
    throw new MemoryStoreError('soil_locked', '整理当前对话的纸条已由屋主手动锁定。', 409);
  }
  const has = (name) => Object.prototype.hasOwnProperty.call(value, name);
  const next = {
    current_text: has('current_text') ? clip(value.current_text, MAX_SOIL_TEXT) : current.current_text,
    hand_seeds: has('hand_seeds') ? normalizeHandSeeds(value.hand_seeds) : current.hand_seeds,
    do_not_repeat: has('do_not_repeat') ? clip(value.do_not_repeat, MAX_SOIL_TEXT) : current.do_not_repeat,
    pocket_candidates: has('pocket_candidates') ? normalizePocketCandidates(value.pocket_candidates) : current.pocket_candidates,
    organized_through_turn_id: has('organized_through_turn_id') ? clip(value.organized_through_turn_id, 180) : current.organized_through_turn_id,
    manual_locked: has('manual_locked') ? bool(value.manual_locked) : !automatic,
    auto_refresh_enabled: has('auto_refresh_enabled') ? bool(value.auto_refresh_enabled) : current.auto_refresh_enabled,
  };
  const identity = provenance.identity
    ? validateCoastIdentity(provenance.identity)
    : automatic ? apiModelPartnerIdentity({
      model_label: provenance.model_label || current.model_label || '未标注模型',
      model_nickname: provenance.model_nickname,
    })
    : ownerIdentity();
  const timestamp = Date.now();
  await run(db, `UPDATE conversation_soils SET
    current_text = ?, hand_seeds_json = ?, do_not_repeat = ?, pocket_candidates_json = ?,
    manual_locked = ?, auto_refresh_enabled = ?, organized_through_turn_id = ?,
    actor = ?, surface = ?, model_label = ?, model_nickname = ?, symbol = ?, display_author = ?,
    source_conversation_id = ?, source_turn_id = ?, tool_call_id = ?,
    revision = revision + 1, updated_at = ?
    WHERE conversation_id = ?`, [
    next.current_text,
    JSON.stringify(next.hand_seeds),
    next.do_not_repeat,
    JSON.stringify(next.pocket_candidates),
    next.manual_locked ? 1 : 0,
    next.auto_refresh_enabled ? 1 : 0,
    next.organized_through_turn_id,
    identity.actor,
    identity.surface,
    identity.model_label,
    identity.model_nickname,
    identity.symbol,
    identity.display_author,
    clip(provenance.source_conversation_id || conversationId, 200),
    clip(provenance.source_turn_id, 200) || null,
    clip(provenance.tool_call_id, 240) || null,
    timestamp,
    conversationId,
  ]);
  return readSoil(db, conversationId);
}

export async function writeSoilCurrentText(db, id, value = {}, { provenance = {} } = {}) {
  await ensureMemorySchema(db);
  const conversationId = sanitizeId(id, 'conversation');
  await ensureSoilRow(db, conversationId);
  const currentText = String(value.current_text ?? '').trim();
  if (!currentText || currentText.length > MAX_SOURCE_TEXT) {
    throw new MemoryStoreError('invalid_request', '当前对话纸条整理 current_text 必须为 1 到 12000 个字符。');
  }
  const identity = validateCoastIdentity(provenance.identity);
  const sourceConversationId = clip(
    provenance.source_conversation_id || conversationId,
    200,
  );
  const sourceTurnId = clip(provenance.source_turn_id, 200) || null;
  const toolCallId = clip(provenance.tool_call_id, 240) || null;
  const timestamp = Date.now();
  const result = await run(db, `UPDATE conversation_soils SET
    current_text = ?,
    actor = ?, surface = ?, model_label = ?, model_nickname = ?, symbol = ?, display_author = ?,
    source_conversation_id = ?, source_turn_id = ?, tool_call_id = ?,
    tool_call_ids_json = CASE
      WHEN ? IS NULL THEN tool_call_ids_json
      ELSE json_insert(tool_call_ids_json, '$[#]', ?)
    END,
    revision = revision + 1, updated_at = ?
    WHERE conversation_id = ?
      AND (? IS NULL OR NOT EXISTS (
        SELECT 1 FROM json_each(tool_call_ids_json) WHERE value = ?
      ))`, [
    currentText,
    identity.actor,
    identity.surface,
    identity.model_label,
    identity.model_nickname,
    identity.symbol,
    identity.display_author,
    sourceConversationId,
    sourceTurnId,
    toolCallId,
    toolCallId,
    toolCallId,
    timestamp,
    conversationId,
    toolCallId,
    toolCallId,
  ]);
  const soil = await readSoil(db, conversationId);
  const changes = Number(result?.meta?.changes || 0);
  const idempotent = Boolean(toolCallId && changes === 0);
  if (changes === 0 && !idempotent) {
    throw new MemoryStoreError('room_soil_write_failed', '当前对话纸条整理没有完成写入。', 500);
  }
  return { soil, idempotent };
}
