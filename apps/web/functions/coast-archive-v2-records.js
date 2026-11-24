import { ensureChatSchema } from './chat-store.js';
import { ensureMemorySchema } from './memory-store/memory-schema.js';
import { MEMORY_OWNER_ID } from './memory-store/memory-normalize.js';
import { ensureCalendarSchema } from './calendar-store.js';
import { ensureVoiceSchema, voiceClipAudio, VOICE_LIMITS } from './voice-clips.js';
import { ARCHIVE_CHUNK_BYTES, digestBytes, describeObject } from './coast-archive-v2-chunks.js';
const id=/^[A-Za-z0-9_.:-]{1,160}$/;
const check=(ok,msg)=>{if(!ok)throw Object.assign(Error(msg),{status:400});};
const active="SELECT id FROM conversations WHERE user_id='owner' AND deleted_at IS NULL AND conversation_kind='chat'";
const memColumns='id,entry_type,scope,conversation_id,title,life_core,content,usage_hint,avoid_hint,source_type,source_ref_json,promoted_from_id,memory_level,status,user_confirmed,recall_count,last_recalled_at,memory_tags_json,supersedes_entry_id,last_confirmed_at,revision_action,source_model,source_window,source_time,tag,migration_status,created_at,updated_at,deleted_at';
const pocketColumns='id,conversation_id,source_type,source_ref_json,source_text,suggested_title,suggested_life_core,suggested_usage_hint,suggested_avoid_hint,candidate_id,title,life_core,content,usage_hint,avoid_hint,source_refs_json,source_excerpt,fingerprint,status,resolved_entry_id,recall_count,last_recalled_at,memory_tags_json,source_model,source_window,source_time,tag,migration_status,supersedes_entry_id,last_confirmed_at,revision_action,created_at,updated_at,deleted_at';
// Fixed module registry, no user-provided table or column names.
const modules={
  chat:{ensure:ensureChatSchema,sql:"SELECT id, title, room_type, created_at,updated_at,deleted_at,title_manual,title_generated_at,title_model_id,source,source_window_id FROM conversations WHERE user_id='owner' AND deleted_at IS NULL AND conversation_kind='chat'"},
  memory_entries:{ensure:ensureMemorySchema,sql:"SELECT "+memColumns+" FROM memory_entries WHERE user_id=? AND deleted_at IS NULL AND ((scope='global' AND conversation_id IS NULL) OR (scope='conversation' AND conversation_id IN ("+active+")))",params:[MEMORY_OWNER_ID]},
  memory_pockets:{ensure:ensureMemorySchema,sql:"SELECT "+pocketColumns+" FROM memory_pockets WHERE user_id=? AND deleted_at IS NULL AND conversation_id IN ("+active+")",params:[MEMORY_OWNER_ID]},
  calendar:{ensure:ensureCalendarSchema,sql:"SELECT * FROM coast_calendar_entries_v2 WHERE 1=1"},
  voice:{ensure:ensureVoiceSchema,sql:"SELECT v.id,v.conversation_id,v.turn_id,v.message_id,v.source,v.model_label,v.voice_id,v.text,v.audio_bytes,v.created_at FROM coast_voice_clips v WHERE v.conversation_id IN ("+active+")"}
};
export const RECORD_MODULES=Object.freeze(Object.keys(modules));
export async function archiveRecordPage(db,module,{cursor='',limit=20}={}){
  check(Object.hasOwn(modules,module),'unsupported record module');
  check(cursor===''||id.test(cursor),'invalid archive cursor');
  check(Number.isInteger(limit)&&limit>=1&&limit<=100,'invalid archive page size');
  const m=modules[module];await m.ensure(db);
  // Chat list is metadata only: history is fetched individually, never truncated to a UI preview.
  const rows=(await db.prepare(m.sql+' AND id>? ORDER BY id LIMIT ?').bind(...(m.params||[]),cursor,limit+1).all()).results||[];
  const items=rows.slice(0,limit);
  return {items,next_cursor:rows.length>limit?items.at(-1).id:null};
}
export async function readArchiveChat(db,conversationId){
  check(id.test(conversationId),'invalid conversation id');await ensureChatSchema(db);
  const conversation=await db.prepare(modules.chat.sql+' AND id=?').bind(conversationId).first();
  if(!conversation)throw Object.assign(Error('conversation not found'),{status:404});
  const row=await db.prepare('SELECT state_json,updated_at FROM conversation_states WHERE conversation_id=?').bind(conversationId).first();
  if(!row)throw Object.assign(Error('conversation history missing'),{status:409});
  // Preserve the persisted JSON text, including historical receipt numeric tokens.
  return {conversation,history_json:row.state_json,history_updated_at:row.updated_at};
}
export async function readArchiveVoice(db,clipId){
  check(id.test(clipId),'invalid voice clip id');await ensureVoiceSchema(db);
  const metadata=await db.prepare(modules.voice.sql+' AND id=?').bind(clipId).first();
  if(!metadata)throw Object.assign(Error('voice clip not found'),{status:404});
  const bytes=await voiceClipAudio(db,clipId);
  check(bytes.length===metadata.audio_bytes&&bytes.length>0&&bytes.length<=VOICE_LIMITS.audio_bytes,'voice original incomplete');
  const chunks=[];for(let i=0;i<bytes.length;i+=ARCHIVE_CHUNK_BYTES)chunks.push(bytes.subarray(i,i+ARCHIVE_CHUNK_BYTES));
  const descriptor=await describeObject(bytes.length,await Promise.all(chunks.map(digestBytes)),{maxBytes:VOICE_LIMITS.audio_bytes});
  return {metadata,descriptor,chunks};
}
