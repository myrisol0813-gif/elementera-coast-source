import { ensureVoiceSchema, VOICE_LIMITS } from './voice-clips.js';
import { ensureMemorySchema } from './memory-store/memory-schema.js';
import { stageVerifiedObject,digestBytes } from './coast-archive-v2-chunks.js';
const check=(ok,msg)=>{if(!ok)throw Object.assign(Error(msg),{status:409});};
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(v);
const stamp=v=>Number.isSafeInteger(v)&&v>=0;
const columns=(row,names)=>Object.keys(row).length===names.length&&names.every(k=>Object.hasOwn(row,k))&&Object.values(row).every(v=>v===null||typeof v==='string'||Number.isSafeInteger(v));
const insert=(db,table,names,row)=>db.prepare('INSERT INTO '+table+' ('+names.join(',')+') VALUES ('+names.map(()=>'?').join(',')+')').bind(...names.map(k=>row[k]));
function base64(bytes){let s='';for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(s);}
export async function prepareArchiveVoice(db,row,descriptor,source,{conversationId,turns,variantTurns}){
  const names=['id','conversation_id','turn_id','message_id','source','model_label','voice_id','text','audio_bytes','created_at'];
  check(columns(row,names)&&id(row.id)&&row.conversation_id===conversationId&&(row.turn_id==null||turns.has(row.turn_id))&&(row.message_id==null||variantTurns.has(row.message_id)&&(!row.turn_id||variantTurns.get(row.message_id)===row.turn_id)),'voice reference missing');
  check(typeof row.source==='string'&&row.source.length<=160&&typeof row.voice_id==='string'&&row.voice_id.length<=180&&typeof row.text==='string'&&row.text.length<=VOICE_LIMITS.text_chars&&stamp(row.created_at)&&row.audio_bytes===descriptor.size&&descriptor.size>0&&descriptor.size<=VOICE_LIMITS.audio_bytes,'invalid voice metadata');
  await ensureVoiceSchema(db);
  check(!await db.prepare('SELECT id FROM coast_voice_clips WHERE id=?').bind(row.id).first(),'voice already exists');
  check(!await db.prepare('SELECT clip_id FROM coast_voice_chunks WHERE clip_id=? LIMIT 1').bind(row.id).first(),'orphan voice chunks already exist');
  const statements=[insert(db,'coast_voice_clips',names,row)];
  await stageVerifiedObject(descriptor,source,async(chunk,index)=>{statements.push(db.prepare('INSERT INTO coast_voice_chunks (clip_id,chunk_index,body_b64) VALUES (?,?,?)').bind(row.id,index,base64(chunk)));},{maxBytes:VOICE_LIMITS.audio_bytes});
  return statements;
}
const soilFields='conversation_id,current_text,hand_seeds_json,do_not_repeat,pocket_candidates_json,afterthoughts_json,memory_candidates_json,seed_candidates_json,user_portrait_candidate_json,self_portrait_candidate_json,manual_locked,auto_refresh_enabled,organized_through_turn_id,source_assistant_id,tool_call_ids_json,revision,created_at,updated_at,actor,surface,model_label,model_nickname,symbol,display_author,source_conversation_id,source_turn_id,tool_call_id'.split(',');
const snapshotFields='conversation_id,turn_id,assistant_message_id,current_text,afterthoughts_json,revision,model_label,display_author,created_at'.split(',');
export async function prepareArchiveSoil(db,recordId,kind,row,{conversationId,turns,variantTurns}){
  check(['thinking_soil','thinking_soil_history'].includes(kind)&&row.conversation_id===conversationId,'soil conversation mismatch');
  const history=kind==='thinking_soil_history',names=history?snapshotFields:soilFields;
  check(columns(row,names)&&typeof row.current_text==='string'&&stamp(row.created_at)&&Number.isSafeInteger(row.revision)&&row.revision>=1,'invalid soil fields');
  const composite=history?[conversationId,row.assistant_message_id]:[conversationId];
  check(recordId===kind+':'+await digestBytes(new TextEncoder().encode(JSON.stringify(composite))),'soil record identity mismatch');
  for(const k of names.filter(k=>k.endsWith('_json'))){check(typeof row[k]==='string','invalid soil JSON');try{JSON.parse(row[k]);}catch{throw Error('damaged soil JSON');}}
  await ensureMemorySchema(db);
  if(history){
    check(turns.has(row.turn_id)&&variantTurns.get(row.assistant_message_id)===row.turn_id,'soil historical source missing');
    check(!await db.prepare('SELECT conversation_id FROM conversation_soil_snapshots WHERE conversation_id=? AND assistant_message_id=?').bind(conversationId,row.assistant_message_id).first(),'soil snapshot already exists');
    return [insert(db,'conversation_soil_snapshots',names,row)];
  }
  check(stamp(row.updated_at)&&[0,1].includes(row.manual_locked)&&[0,1].includes(row.auto_refresh_enabled),'invalid soil settings');
  check(!await db.prepare('SELECT conversation_id FROM conversation_soils WHERE conversation_id=?').bind(conversationId).first(),'soil already exists');
  return [insert(db,'conversation_soils',names,row)];
}
