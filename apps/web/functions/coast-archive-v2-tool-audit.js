import { ensureToolRunSchema } from './tool-run-log.js';
import { ensureChatSchema } from './chat-store.js';
import { validateArchiveManifest } from './coast-archive-v2-manifest.js';
import { stageVerifiedObject } from './coast-archive-v2-chunks.js';
import { readStagedArchiveChunks } from './coast-archive-v2-stage.js';

// Only stable, known owner-tool identifiers. Never export input/output/error text,
// connector payloads, mailbox activity, visitors, or arbitrary identifiers as metadata.
export const SAFE_TOOL_KEYS=Object.freeze(["coast.status","radio.list","lighthouse.list","daily.create_moment","daily.create_diary","daily.moment_comment","daily.moment_like","dogtalk.read","dogtalk.save","cross_window.search","cross_window.keyword_search","cross_window.read_messages","cross_window.read_recent","memory.global_excerpt_propose","vault.search","vault.read","memory.search","memory.write_candidate","memory.authorized_search","radio.send","lighthouse.write_letter","daily.moments.list","daily.diaries.list","calendar.list","calendar.create","calendar.update","calendar.delete","voice.create","library.books","library.read","library.notes","library.write","worldbook.list","worldbook.create","worldbook.update"]);
const actors=['api_model_partner','native_model_partner','official_mcp','owner','model_partner','api','mcp','assistant'];
const rooms=['main_chat','main','conversation','radio','lighthouse','daily','official_mcp'];
const fields=['id','tool_key','actor','room_scope','conversation_id','status','created_at','finished_at'];
const validId=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(v);
const stamp=v=>Number.isSafeInteger(v)&&v>=0;
const check=(ok,msg)=>{if(!ok)throw Object.assign(Error(msg),{status:409});};
export function validateSafeToolRow(v){
 check(v&&Object.keys(v).length===fields.length&&fields.every(k=>Object.hasOwn(v,k))&&validId(v.id)&&validId(v.conversation_id)&&SAFE_TOOL_KEYS.includes(v.tool_key)&&actors.includes(v.actor)&&rooms.includes(v.room_scope)&&['success','error'].includes(v.status)&&stamp(v.created_at)&&stamp(v.finished_at)&&v.finished_at>=v.created_at,'invalid safe tool audit record');
}
const sqlList=a=>a.map(x=>"'"+x+"'").join(',');
export async function safeToolPage(db,{cursor='',limit=20}={}){
 await ensureChatSchema(db);await ensureToolRunSchema(db);
 check((cursor===''||validId(cursor))&&Number.isInteger(limit)&&limit>=1&&limit<=100,'invalid tool page');
 const rows=(await db.prepare('SELECT '+fields.join(',')+" FROM coast_tool_runs WHERE conversation_id IN (SELECT id FROM conversations WHERE user_id='owner' AND deleted_at IS NULL AND conversation_kind='chat') AND tool_key IN ("+sqlList(SAFE_TOOL_KEYS)+") AND actor IN ("+sqlList(actors)+") AND room_scope IN ("+sqlList(rooms)+") AND status IN ('success','error') AND finished_at IS NOT NULL AND id>? ORDER BY id LIMIT ?").bind(cursor,limit+1).all()).results||[];
 const items=rows.slice(0,limit);items.forEach(validateSafeToolRow);
 return {items,next_cursor:rows.length>limit?items.at(-1).id:null};
}
export async function restoreSafeTool(db,sessionId,manifest,id,confirm=false){
 await validateArchiveManifest(manifest);
 check(manifest.application_id==='com.elementeracoast.source','tool audit requires same-edition archive');
 const r=manifest.records.find(x=>x.module==='tools'&&x.id===id);
 check(r&&r.media_objects.length===0,'tool audit missing');
 const d=manifest.objects.find(x=>x.object_sha256===r.record_object);check(d&&d.size<=4096,'tool audit too large');
 const bytes=new Uint8Array(d.size);let at=0;
 await stageVerifiedObject(d,readStagedArchiveChunks(db,sessionId,d.object_sha256),async b=>{bytes.set(b,at);at+=b.length;},{maxBytes:4096});
 const raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),v=raw?.data;
 check(raw&&Object.keys(raw).length===2&&raw.kind==='tools','invalid tool audit envelope');validateSafeToolRow(v);
 check(v.id===r.id&&r.dependencies.length===1&&r.dependencies[0]==='chat/'+v.conversation_id,'invalid audit dependency');
 await ensureChatSchema(db);await ensureToolRunSchema(db);
 check(await db.prepare("SELECT id FROM conversations WHERE id=? AND user_id='owner' AND deleted_at IS NULL AND conversation_kind='chat'").bind(v.conversation_id).first(),'restore related owner chat first');
 const old=await db.prepare('SELECT '+fields.join(',')+' FROM coast_tool_runs WHERE id=?').bind(id).first();
 check(!old||fields.every(k=>old[k]===v[k]),'target tool audit differs; never overwrite');
 // Historical receipt only. No execution, credentials, or synthesized summaries.
 if(confirm===true&&!old)await db.prepare('INSERT INTO coast_tool_runs ('+fields.join(',')+') VALUES ('+fields.map(()=>'?').join(',')+')').bind(...fields.map(k=>v[k])).run();
 return {scope:'record_only',module:'tools',record_id:id,ready:old?0:1,existing:old?1:0,can_commit:true,committed:confirm===true};
}
