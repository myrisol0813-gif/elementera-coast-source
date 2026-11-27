import {readDreamArchive} from './dream-tide-archive.js';
import { safeToolPage } from './coast-archive-v2-tool-audit.js';
import { ensureChatSchema } from './chat-store.js';
import {recoverStaleReplyRuns} from './chat-reply-run.js';
import { ensureMemorySchema } from './memory-store/memory-schema.js';
import { MEMORY_OWNER_ID } from './memory-store/memory-normalize.js';
import { ensureCalendarSchema } from './calendar-store.js';
import { ensureVoiceSchema, voiceClipAudio, VOICE_LIMITS } from './voice-clips.js';
import { ARCHIVE_CHUNK_BYTES, digestBytes, describeObject } from './coast-archive-v2-chunks.js';
const id=/^[A-Za-z0-9_.:-]{1,160}$/;
const check=(ok,msg)=>{if(!ok)throw Object.assign(Error(msg),{status:400});};
const active="SELECT id FROM conversations WHERE user_id='owner' AND deleted_at IS NULL AND conversation_kind='chat'";
export const memColumns='id,entry_type,scope,conversation_id,title,life_core,content,usage_hint,avoid_hint,source_type,source_ref_json,promoted_from_id,memory_level,status,user_confirmed,recall_count,last_recalled_at,memory_tags_json,supersedes_entry_id,last_confirmed_at,revision_action,source_model,source_window,source_time,tag,migration_status,created_at,updated_at,deleted_at';
export const pocketColumns='id,conversation_id,source_type,source_ref_json,source_text,suggested_title,suggested_life_core,suggested_usage_hint,suggested_avoid_hint,candidate_id,title,life_core,content,usage_hint,avoid_hint,source_refs_json,source_excerpt,fingerprint,status,resolved_entry_id,recall_count,last_recalled_at,memory_tags_json,source_model,source_window,source_time,tag,migration_status,supersedes_entry_id,last_confirmed_at,revision_action,created_at,updated_at,deleted_at';
// Fixed module registry, no user-provided table or column names.
const modules={
  chat:{ensure:ensureChatSchema,sql:"SELECT id, title, room_type, created_at,updated_at,deleted_at,title_manual,title_generated_at,title_model_id,source,source_window_id FROM conversations WHERE user_id='owner' AND deleted_at IS NULL AND conversation_kind='chat'"},
  memory_entries:{ensure:ensureMemorySchema,sql:"SELECT "+memColumns+" FROM memory_entries WHERE user_id=? AND deleted_at IS NULL AND ((scope='global' AND conversation_id IS NULL) OR (scope='conversation' AND conversation_id IN ("+active+")))",params:[MEMORY_OWNER_ID]},
  memory_pockets:{ensure:ensureMemorySchema,sql:"SELECT "+pocketColumns+" FROM memory_pockets WHERE user_id=? AND deleted_at IS NULL AND conversation_id IN ("+active+")",params:[MEMORY_OWNER_ID]},
  calendar:{ensure:ensureCalendarSchema,sql:"SELECT id,day,kind,title,body,recurrence,author,source,conversation_id,source_turn_id,tool_call_id,model_label,created_at,updated_at,anniversary_start_day,anniversary_mode,anniversary_target_days,anniversary_pinned FROM coast_calendar_entries_v2 WHERE (conversation_id IS NULL OR conversation_id IN ("+active+"))"},
  model_profile:{ensure:ensureChatSchema,sql:"SELECT user_id AS id,assistant_avatar_dataurl,current_chat_model,current_image_model,model_box_json,updated_at FROM chat_profiles WHERE user_id='owner'",key:"user_id"},
  voice:{ensure:ensureVoiceSchema,sql:"SELECT v.id,v.conversation_id,v.turn_id,v.message_id,v.source,v.model_label,v.voice_id,v.text,v.audio_bytes,v.created_at FROM coast_voice_clips v WHERE v.conversation_id IN ("+active+")"}
};
export const RECORD_MODULES=Object.freeze([...Object.keys(modules),'tools']);
export async function archiveRecordPage(db,module,{cursor='',limit=20}={}){
  if(module==='tools')return safeToolPage(db,{cursor,limit});
  check(Object.hasOwn(modules,module),'unsupported record module');
  check(cursor===''||id.test(cursor),'invalid archive cursor');
  check(Number.isInteger(limit)&&limit>=1&&limit<=100,'invalid archive page size');
  const m=modules[module];await m.ensure(db);
  // Chat list is metadata only: history is fetched individually, never truncated to a UI preview.
  const rows=(await db.prepare(m.sql+' AND '+(m.key||'id')+'>? ORDER BY '+(m.key||'id')+' LIMIT ?').bind(...(m.params||[]),cursor,limit+1).all()).results||[];
  const items=rows.slice(0,limit);
  return {items,next_cursor:rows.length>limit?items.at(-1).id:null};
}
export async function readArchiveChat(db,conversationId){
  check(id.test(conversationId),'invalid conversation id');await ensureChatSchema(db);
  const conversation=await db.prepare(modules.chat.sql+' AND id=?').bind(conversationId).first();
  if(!conversation)throw Object.assign(Error('conversation not found'),{status:404});
  await recoverStaleReplyRuns(db,Date.now(),conversationId);
  // Check the ledger in the same SQL snapshot as the history. Never archive
  // a claimed/pending media slot without the execution state that owns it.
  const row=await db.prepare("SELECT s.state_json,s.updated_at,EXISTS(SELECT 1 FROM chat_reply_runs r WHERE r.conversation_id=s.conversation_id AND r.status='running') AS reply_active FROM conversation_states s WHERE s.conversation_id=?").bind(conversationId).first();
  if(!row)throw Object.assign(Error('conversation history missing'),{status:409});
  if(row.reply_active)throw Object.assign(Error('该窗口正在连续回复，请结束本组后重新导出。'),{status:409,type:'archive_reply_run_active'});
  // Preserve the persisted JSON text, including historical receipt numeric tokens.
  const dream_tide=await readDreamArchive(db,conversationId);
  return {conversation,history_json:row.state_json,history_updated_at:row.updated_at,...(dream_tide?{dream_tide}:{})};
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
