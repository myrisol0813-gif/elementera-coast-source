import { boolean, parseJson } from './mailbox-db.js';

export function visitorFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    display_name: row.display_name,
    preferred_name: row.preferred_name || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_seen_at: row.last_seen_at || null,
    is_active: boolean(row.is_active),
    allow_memory: boolean(row.allow_memory),
    privacy_level: row.privacy_level,
  };
}

export function messageFromRow(row) {
  return {
    id: row.id,
    visitor_id: row.visitor_id,
    role: row.role,
    content: row.content,
    created_at: row.created_at,
    updated_at: row.updated_at,
    status: row.status,
    reply_batch_id: row.reply_batch_id || null,
  };
}

export function notebookFromRow(row) {
  return {
    id: row.id,
    visitor_id: row.visitor_id,
    entry_type: row.entry_type || 'memory',
    title: row.title || row.life_core || row.content.slice(0, 80),
    life_core: row.life_core || row.content,
    content: row.content,
    usage_hint: row.usage_hint || '',
    avoid_hint: row.avoid_hint || '',
    source_message_id: row.source_message_id || null,
    source_pocket_id: row.source_pocket_id || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    confidence: Number(row.confidence ?? 1),
    visibility: row.visibility,
    status: row.status || (boolean(row.archived) ? 'archived' : 'active'),
    generated_by_model: row.generated_by_model || null,
    model_nickname: row.model_nickname || null,
    generation_source: row.generation_source || 'legacy_mailbox',
    source_conversation_id: row.source_conversation_id || null,
    source_turn_id: row.source_turn_id || null,
  };
}

export function emptyThoughtSoil(visitorId) {
  return {
    visitor_id: visitorId,
    current_text: '',
    hand_seeds: [],
    do_not_repeat: '',
    pocket_candidates: [],
    source_message_id: null,
    organized_through_message_id: null,
    manual_locked: false,
    auto_refresh_enabled: true,
    revision: 1,
    model_label: null,
    model_nickname: null,
    source_conversation_id: null,
    source_turn_id: null,
    created_at: null,
    updated_at: null,
  };
}

export function thoughtSoilFromRow(row, visitorId = row?.visitor_id || '') {
  if (!row) return emptyThoughtSoil(visitorId);
  return {
    visitor_id: row.visitor_id,
    current_text: row.current_text || '',
    hand_seeds: Array.isArray(parseJson(row.hand_seeds_json, []))
      ? parseJson(row.hand_seeds_json, [])
      : [],
    do_not_repeat: row.do_not_repeat || '',
    pocket_candidates: Array.isArray(parseJson(row.pocket_candidates_json, []))
      ? parseJson(row.pocket_candidates_json, [])
      : [],
    source_message_id: row.source_message_id || null,
    organized_through_message_id: row.organized_through_message_id || null,
    manual_locked: boolean(row.manual_locked),
    auto_refresh_enabled: boolean(row.auto_refresh_enabled),
    revision: Math.max(1, Number(row.revision || 1)),
    model_label: row.model_label || null,
    model_nickname: row.model_nickname || null,
    source_conversation_id: row.source_conversation_id || null,
    source_turn_id: row.source_turn_id || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

export function pocketFromRow(row) {
  return {
    id: row.id,
    visitor_id: row.visitor_id,
    title: row.title,
    life_core: row.life_core,
    content: row.content,
    usage_hint: row.usage_hint || '',
    avoid_hint: row.avoid_hint || '',
    source_excerpt: row.source_excerpt || '',
    source_message_id: row.source_message_id || null,
    status: row.status,
    resolved_entry_id: row.resolved_entry_id || null,
    generated_by_model: row.generated_by_model || null,
    model_nickname: row.model_nickname || null,
    generation_source: row.generation_source || 'official_mcp',
    source_conversation_id: row.source_conversation_id || null,
    source_turn_id: row.source_turn_id || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    resolved_at: row.resolved_at || null,
  };
}
