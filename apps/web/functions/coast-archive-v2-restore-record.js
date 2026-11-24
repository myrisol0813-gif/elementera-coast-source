import { restoreArchiveLocalRecord } from './coast-archive-v2-restore-local.js';
import { prepareArchiveVault } from './coast-archive-v2-restore-vault.js';
import { restoreArchiveDaily } from './coast-archive-v2-restore-daily.js';
import { PORTRAIT_RESTORE_MODULES,restoreArchivePortrait } from './coast-archive-v2-restore-portrait.js';
import { MEMORY_RESTORE_MODULES,prepareArchiveMemory } from './coast-archive-v2-restore-memory.js';
import { ensureMemorySchema } from './memory-store/memory-schema.js';
import { MAX_CUSTOM_INSTRUCTIONS } from './memory-store/memory-normalize.js';
import { ensureChatSchema, normalizeProfile } from './chat-store.js';
import { ensureCalendarSchema, CALENDAR_LIMITS } from './calendar-store.js';
import { anniversaryCalendarDay } from './calendar-anniversary.js';
import { ensureWorldbookSchema } from './worldbook-schema.js';
import { validateArchiveManifest } from './coast-archive-v2-manifest.js';
import { stageVerifiedObject,digestBytes } from './coast-archive-v2-chunks.js';
import { readStagedArchiveChunks } from './coast-archive-v2-stage.js';
const check=(ok,msg)=>{if(!ok)throw Object.assign(Error(msg),{status:409});};
const stamp=v=>Number.isSafeInteger(v)&&v>=0;
const text=(v,n)=>typeof v==='string'&&v.length<=n;
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(v);
const day=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v&&Number(v.slice(0,4))>=1900&&Number(v.slice(0,4))<=2200;
const exact=(row,fields)=>row&&typeof row==='object'&&!Array.isArray(row)&&Object.keys(row).length===fields.length&&fields.every(k=>Object.hasOwn(row,k));
const specs={
 calendar:['coast_calendar_entries_v2','id,day,kind,title,body,recurrence,author,source,conversation_id,source_turn_id,tool_call_id,model_label,created_at,updated_at,anniversary_start_day,anniversary_mode,anniversary_target_days,anniversary_pinned',ensureCalendarSchema],
 custom_instructions:['memory_custom_instructions','id,content,updated_at,updated_by,source',ensureMemorySchema],
 worldbook:['coast_worldbook_entries','id,title,content,keywords_json,use_regex,case_sensitive,constant_active,priority,scan_depth,inject_position,enabled,scope,visitor_safe,created_at,updated_at',ensureWorldbookSchema],
 model_profile:['chat_profiles','id,assistant_avatar_dataurl,current_chat_model,current_image_model,model_box_json,updated_at',ensureChatSchema]
};
const roles={owner:'owner',assistant:'assistant'};
export async function restoreArchiveRecord(db,sessionId,manifest,module,recordId,confirm=false){
 if(manifest?.workspace==='local')return restoreArchiveLocalRecord(db,sessionId,manifest,module,recordId,confirm);
 if(module==='daily')return restoreArchiveDaily(db,sessionId,manifest,recordId,confirm);
 if(PORTRAIT_RESTORE_MODULES.includes(module))return restoreArchivePortrait(db,sessionId,manifest,module,recordId,confirm);
 await validateArchiveManifest(manifest);
 check(manifest.workspace==='backend'&&(Object.hasOwn(specs,module)||MEMORY_RESTORE_MODULES.includes(module)||module==='vault'),'target does not support this record');
 const r=manifest.records.find(x=>x.module===module&&x.id===recordId);
 check(r&&r.media_objects.length===0,'record missing or media not supported');
 const d=manifest.objects.find(x=>x.object_sha256===r.record_object);
 check(d&&d.size<=1800000,'record exceeds database size limit');
 const bytes=new Uint8Array(d.size);let at=0;
 await stageVerifiedObject(d,readStagedArchiveChunks(db,sessionId,d.object_sha256),async b=>{bytes.set(b,at);at+=b.length;},{maxBytes:1800000});
 const raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 if(module==='vault'){
   const plan=await prepareArchiveVault(db,r,raw,manifest);
   if(confirm===true&&plan.statements.length)await db.batch(plan.statements);
   return {scope:'record_only',module,record_id:r.id,ready:plan.existing?0:1,existing:plan.existing?1:0,can_commit:true,committed:confirm===true};
 }
 if(MEMORY_RESTORE_MODULES.includes(module)){
   check(exact(raw,['kind','data'])&&raw.kind===module,'invalid memory record envelope');
   const plan=await prepareArchiveMemory(db,r,raw.data,manifest);
   if(confirm===true&&plan.statements.length)await db.batch(plan.statements);
   return {scope:'record_only',module,record_id:r.id,ready:plan.existing?0:1,existing:plan.existing?1:0,can_commit:true,committed:confirm===true};
 }
 const [table,names,ensure]=specs[module],fields=names.split(','),v=raw?.data;
 check(exact(raw,['kind','data'])&&raw.kind===module&&exact(v,fields)&&id(v.id),'invalid record fields');
 const expected=['worldbook','custom_instructions'].includes(module)?module+':'+await digestBytes(new TextEncoder().encode(JSON.stringify([v.id]))):v.id;
 check(expected===r.id,'record identity mismatch');
 await ensure(db);
 if(module==='calendar'){
   check(day(v.day)&&text(v.title,CALENDAR_LIMITS.title)&&v.title.trim()&&text(v.body,CALENDAR_LIMITS.body)&&['event','note'].includes(v.kind)&&['none','yearly'].includes(v.recurrence)&&Object.hasOwn(roles,v.author)&&text(v.source,160)&&stamp(v.created_at)&&stamp(v.updated_at),'invalid calendar data');
   check([0,1].includes(v.anniversary_pinned)&&[v.tool_call_id,v.model_label,v.source_turn_id,v.conversation_id].every(x=>x===null||text(x,200)),'invalid calendar metadata');
   if(v.anniversary_mode!==null){
     const a={startDay:v.anniversary_start_day,mode:v.anniversary_mode,targetDays:v.anniversary_target_days,pinned:!!v.anniversary_pinned};
     check(day(a.startDay)&&anniversaryCalendarDay(a)===v.day&&v.kind==='event'&&v.recurrence===(a.mode==='yearly'?'yearly':'none'),'invalid anniversary');
   }else check(v.anniversary_start_day===null&&v.anniversary_target_days===null&&v.anniversary_pinned===0,'invalid anniversary fields');
   if(v.conversation_id){
     check(id(v.conversation_id)&&r.dependencies.length===1&&r.dependencies[0]==='chat/'+v.conversation_id,'calendar dependency missing');
     await ensureChatSchema(db);
     const c=await db.prepare("SELECT s.state_json FROM conversations c JOIN conversation_states s ON s.conversation_id=c.id WHERE c.id=? AND c.user_id='owner' AND c.deleted_at IS NULL AND c.conversation_kind='chat'").bind(v.conversation_id).first();
     check(c&&(!v.source_turn_id||JSON.parse(c.state_json).turns.some(t=>t.id===v.source_turn_id)),'restore related chat first');
   }else check(r.dependencies.length===0&&!v.source_turn_id,'calendar dependency missing');
   v.author=roles[v.author];
 }else if(module==='custom_instructions'){
   check(manifest.application_id==='com.elementeracoast.source'&&v.id==='active'&&r.dependencies.length===0&&text(v.content,MAX_CUSTOM_INSTRUCTIONS)&&stamp(v.updated_at)&&text(v.updated_by,80)&&text(v.source,80),'invalid custom instructions or incompatible edition');
 }else if(module==='worldbook'){
   check(r.dependencies.length===0&&text(v.title,160)&&v.title.trim()&&text(v.content,12000)&&v.content.trim()&&stamp(v.created_at)&&stamp(v.updated_at),'invalid worldbook text');
   check(['use_regex','case_sensitive','constant_active','enabled','visitor_safe'].every(k=>[0,1].includes(v[k]))&&Number.isInteger(v.priority)&&v.priority>=-1000&&v.priority<=1000&&Number.isInteger(v.scan_depth)&&v.scan_depth>=1&&v.scan_depth<=20&&v.inject_position==='before_memory'&&['owner','visitor','both','mailbox','lighthouse','radio','official_mcp','daily'].includes(v.scope),'invalid worldbook settings');
   const keywords=JSON.parse(v.keywords_json);check(Array.isArray(keywords)&&keywords.length<=30&&keywords.every(k=>text(k,160)&&k.trim())&&new Set(keywords).size===keywords.length,'invalid worldbook keywords');
   if(v.use_regex)for(const k of keywords)new RegExp(k,v.case_sensitive?'':'i');
   if(v.enabled&&v.constant_active)check((await db.prepare('SELECT COUNT(*) AS n FROM coast_worldbook_entries WHERE enabled=1 AND constant_active=1').first()).n<3,'constant worldbook capacity reached');
 }else{
   check(r.dependencies.length===0&&v.id==='owner'&&stamp(v.updated_at),'invalid profile identity');
   const box=JSON.parse(v.model_box_json||'{}');
   const profile={assistant_avatar_dataurl:v.assistant_avatar_dataurl||'',current_chat_model:v.current_chat_model||'',current_image_model:v.current_image_model||'',model_box:box};
   check(exact(box,['chat','free','image'])&&['chat','free','image'].every(k=>Array.isArray(box[k])&&box[k].length<=60&&box[k].every(x=>text(x,180))),'invalid model box; credentials not accepted');
   const normalized=normalizeProfile(profile);
   check(normalized.assistant_avatar_dataurl===profile.assistant_avatar_dataurl&&normalized.current_chat_model===profile.current_chat_model&&normalized.current_image_model===profile.current_image_model&&['chat','free','image'].every(k=>JSON.stringify(normalized.model_box[k])===JSON.stringify(box[k])),'target profile would lose fields');
 }
 const keys=fields.map(k=>module==='model_profile'&&k==='id'?'user_id':k);
 const prior=await db.prepare('SELECT '+keys.join(',')+' FROM '+table+' WHERE '+keys[0]+'=?').bind(v.id).first();
 const same=prior&&keys.every((k,i)=>prior[k]===v[fields[i]]);
 check(!prior||same,'target record exists with different content; never overwrite');
 if(confirm===true&&!prior)await db.batch([db.prepare('INSERT INTO '+table+' ('+keys.join(',')+') VALUES ('+keys.map(()=>'?').join(',')+')').bind(...fields.map(k=>v[k]))]);
 return {scope:'record_only',module,record_id:r.id,ready:prior?0:1,existing:prior?1:0,can_commit:true,committed:confirm===true};
}
