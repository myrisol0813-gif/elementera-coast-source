import { ensureMemorySchema } from './memory-store/memory-schema.js';
import { MEMORY_OWNER_ID,ENTRY_TYPES,ENTRY_SCOPES,ENTRY_STATUSES,MEMORY_LEVELS,POCKET_SOURCE_TYPES,POCKET_STATUSES,MAX_TITLE,MAX_LIFE_CORE,MAX_ENTRY_CONTENT,MAX_HINT,MAX_SOURCE_TEXT,MAX_SOURCE_EXCERPT,MAX_SOURCE_MODEL,MAX_SOURCE_WINDOW } from './memory-store/memory-normalize.js';
import { memColumns,pocketColumns } from './coast-archive-v2-records.js';
import {readDreamArchive,validateDreamCandidateOrigin} from './dream-tide-archive.js';
import { ensureChatSchema } from './chat-store.js';
const check=(ok,msg)=>{if(!ok)throw Object.assign(Error(msg),{status:409});};
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(v);
const stamp=v=>Number.isSafeInteger(v)&&v>=0;
const text=(v,n)=>typeof v==='string'&&v.length<=n;
const optionalId=v=>v===null||id(v);
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const parse=(raw,limit,valid)=>{check(text(raw,limit),'invalid memory JSON size');let v;try{v=JSON.parse(raw)}catch{check(false,'damaged memory JSON')};check(valid(v),'invalid memory JSON');return v;};
const specs={memory_entries:['memory_entries',memColumns],memory_pockets:['memory_pockets',pocketColumns]};
export const MEMORY_RESTORE_MODULES=Object.freeze(Object.keys(specs));
export async function prepareArchiveMemory(db,r,v,manifest){
 const [table,names]=specs[r.module],fields=names.split(','),pocket=r.module==='memory_pockets';
 check(manifest.application_id==='com.elementeracoast.source','memory restore currently requires same-edition backend archive');
 check(object(v)&&Object.keys(v).length===fields.length&&fields.every(k=>Object.hasOwn(v,k))&&id(v.id)&&v.id===r.id,'invalid memory record identity or schema');
 check(v.deleted_at===null&&stamp(v.created_at)&&stamp(v.updated_at)&&stamp(v.recall_count)&&['last_recalled_at','source_time','last_confirmed_at'].every(k=>v[k]===null||stamp(v[k])),'invalid memory dates');
 check(optionalId(v.supersedes_entry_id)&&text(v.source_model,MAX_SOURCE_MODEL)&&text(v.source_window,MAX_SOURCE_WINDOW)&&text(v.tag,80)&&text(v.migration_status,160)&&text(v.revision_action,160),'invalid memory metadata');
 check(text(v.title,MAX_TITLE)&&text(v.life_core,MAX_LIFE_CORE)&&text(v.content,MAX_ENTRY_CONTENT)&&text(v.usage_hint,MAX_HINT)&&text(v.avoid_hint,MAX_HINT),'invalid memory text');
 parse(v.source_ref_json,4000,object);parse(v.memory_tags_json,20000,a=>Array.isArray(a)&&a.length<=30&&a.every(x=>text(x,80)));
 if(pocket){
   check(id(v.conversation_id)&&POCKET_SOURCE_TYPES.has(v.source_type)&&POCKET_STATUSES.has(v.status)&&text(v.source_text,MAX_SOURCE_TEXT)&&v.source_text.trim(),'invalid pocket fields');
   check(text(v.suggested_title,MAX_TITLE)&&text(v.suggested_life_core,MAX_LIFE_CORE)&&text(v.suggested_usage_hint,MAX_HINT)&&text(v.suggested_avoid_hint,MAX_HINT)&&optionalId(v.candidate_id)&&optionalId(v.resolved_entry_id)&&(v.fingerprint===null||text(v.fingerprint,160))&&text(v.source_excerpt,MAX_SOURCE_EXCERPT),'invalid pocket provenance');
   parse(v.source_refs_json,20000,a=>Array.isArray(a)&&a.length<=8&&a.every(x=>object(x)&&id(x.turn_id)&&['user','assistant','turn'].includes(x.role)));
 }else{
   check(ENTRY_TYPES.has(v.entry_type)&&ENTRY_SCOPES.has(v.scope)&&ENTRY_STATUSES.has(v.status)&&MEMORY_LEVELS.has(v.memory_level)&&(v.entry_type!=='seed'||v.memory_level==='ordinary')&&[0,1].includes(v.user_confirmed)&&v.title.trim()&&v.life_core.trim()&&optionalId(v.promoted_from_id)&&text(v.source_type,40),'invalid memory entry');
   check(v.scope==='global'?v.conversation_id===null:id(v.conversation_id),'invalid memory scope');
 }
 if(v.conversation_id!==null){
   check(r.dependencies.length===1&&r.dependencies[0]==='chat/'+v.conversation_id,'missing memory window dependency');
   await ensureChatSchema(db);
   check(await db.prepare("SELECT id FROM conversations WHERE id=? AND user_id='owner' AND deleted_at IS NULL AND conversation_kind='chat'").bind(v.conversation_id).first(),'restore related owner chat first');
 }else check(r.dependencies.length===0,'invalid memory dependencies');
 if(pocket&&(v.source_type==='dream_tide'||v.id.startsWith('pocket_dream_')))validateDreamCandidateOrigin(await readDreamArchive(db,v.conversation_id),v);
 await ensureMemorySchema(db);
 const existing=await db.prepare('SELECT user_id,'+names+' FROM '+table+' WHERE id=?').bind(v.id).first();
 check(!existing||existing.user_id===MEMORY_OWNER_ID&&fields.every(k=>existing[k]===v[k]),'target memory differs or is not owned; never overwrite');
 if(!existing&&pocket&&v.fingerprint)check(!await db.prepare('SELECT id FROM memory_pockets WHERE user_id=? AND fingerprint=?').bind(MEMORY_OWNER_ID,v.fingerprint).first(),'pocket fingerprint conflict');
 // Derived embedding columns deliberately use their target defaults, pending.
 // Never copy vector IDs between independent indexes.
 return {existing:!!existing,statements:existing?[]:[db.prepare('INSERT INTO '+table+' (user_id,'+names+') VALUES ('+['user_id',...fields].map(()=>'?').join(',')+')').bind(MEMORY_OWNER_ID,...fields.map(k=>v[k]))]};
}
