import { ensureMailboxSchema } from '../mailbox-schema.js';
import { first } from './mailbox-db.js';
import { thoughtSoilFromRow } from './mailbox-mappers.js';

export async function readMailboxThoughtSoil(db, visitorId) {
  await ensureMailboxSchema(db);
  return thoughtSoilFromRow(
    await first(db, 'SELECT * FROM mailbox_thought_soils WHERE visitor_id = ?', [visitorId]),
    visitorId,
  );
}

export function mailboxThoughtSoilUpsertStatement(db, value, replyId, timestamp) {
  return db.prepare(`INSERT INTO mailbox_thought_soils (
      visitor_id, current_text, hand_seeds_json, do_not_repeat,
      pocket_candidates_json, source_message_id, organized_through_message_id,
      manual_locked, auto_refresh_enabled, revision, model_label, model_nickname,
      source_conversation_id, source_turn_id, tool_call_id, created_at, updated_at
    ) SELECT ?, ?, ?, ?, ?, ?, ?, 0, 1, 1, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM mailbox_messages WHERE id = ? AND role = 'model_partner')
    ON CONFLICT(visitor_id) DO UPDATE SET
      current_text = excluded.current_text,
      hand_seeds_json = excluded.hand_seeds_json,
      do_not_repeat = excluded.do_not_repeat,
      pocket_candidates_json = excluded.pocket_candidates_json,
      source_message_id = excluded.source_message_id,
      organized_through_message_id = excluded.organized_through_message_id,
      manual_locked = 0,
      auto_refresh_enabled = 1,
      revision = mailbox_thought_soils.revision + 1,
      model_label = excluded.model_label,
      model_nickname = excluded.model_nickname,
      source_conversation_id = excluded.source_conversation_id,
      source_turn_id = excluded.source_turn_id,
      tool_call_id = excluded.tool_call_id,
      updated_at = excluded.updated_at`).bind(
    value.visitor_id,
    value.thought_soil.current_text,
    JSON.stringify(value.thought_soil.hand_seeds),
    value.thought_soil.do_not_repeat,
    JSON.stringify(value.thought_soil.pocket_candidates),
    replyId,
    replyId,
    value.model_label,
    value.model_nickname || null,
    value.source_conversation_id || null,
    value.source_turn_id || replyId,
    value.tool_call_id || null,
    timestamp,
    timestamp,
    replyId,
  );
}
