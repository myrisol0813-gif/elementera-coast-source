import { ensureDailySchema } from './daily-schema.js';
import { ensureChatSchema } from './chat-store.js';
import { validateArchiveManifest } from './coast-archive-v2-manifest.js';
import { stageVerifiedObject,digestBytes } from './coast-archive-v2-chunks.js';
import { readStagedArchiveChunks } from './coast-archive-v2-stage.js';
const check=(ok,msg)=>{if(!ok)throw Object.assign(Error(msg),{status:409});};
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(v);
const stamp=v=>Number.isSafeInteger(v)&&v>=0;
const text=(v,n)=>typeof v==='string'&&v.length<=n;
const opt=(v,n)=>v===null||text(v,n);
const day=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const roles=['owner','model_partner','api','mcp'];
const profileFields='id,owner_avatar_dataurl,model_partner_avatar_dataurl,moment_cover_dataurl,model_partner_display_name,updated_at';
const common='id,date,author,source,text,conversation_id,source_turn_id,tool_call_id,actor,surface,model_label,model_nickname,symbol,display_author,created_at,updated_at';
const specs={
 daily_moments:['daily_moments',common+',status,reason,published_at',['id']],
 daily_diaries:['daily_diaries',common+',weather,mood,tags_json',['id']],
 daily_comments:['daily_moment_comments','id,moment_id,author,text,created_at,model_id,usage_json',['id']],
 daily_likes:['daily_moment_likes','moment_id,actor,created_at',['moment_id','actor']],
 daily_profile:['daily_profile',profileFields,['id']]
};
const identity=async(kind,v,keys)=>kind+':'+await digestBytes(new TextEncoder().encode(JSON.stringify(keys.map(k=>v[k]))));
const validRole=v=>roles.includes(v);
export async function restoreArchiveDaily(db,sessionId,manifest,recordId,confirm=false){
 await validateArchiveManifest(manifest);
 check(manifest.workspace==='backend'&&manifest.application_id==='com.elementeracoast.source','daily restore currently requires same-edition backend archive');
 const root=manifest.records.find(r=>r.module==='daily'&&r.id===recordId);
 check(root,'daily record missing');
 const rootKey='daily/'+recordId;
 const group=manifest.records.filter(r=>r===root||r.module==='daily'&&r.dependencies.includes(rootKey));
 const objects=new Map(manifest.objects.map(d=>[d.object_sha256,d]));
 check(group.length<=90&&group.reduce((n,r)=>n+objects.get(r.record_object).size,0)<=16*1024*1024,'daily group exceeds transaction budget');
 const rows=[];
 for(const r of group){
   check(r.media_objects.length===0,'unexpected daily media');
   const d=objects.get(r.record_object);check(d.size<=1800000,'daily record too large');
   const bytes=new Uint8Array(d.size);let at=0;
   await stageVerifiedObject(d,readStagedArchiveChunks(db,sessionId,d.object_sha256),async b=>{bytes.set(b,at);at+=b.length;},{maxBytes:1800000});
   const raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
   check(raw&&Object.keys(raw).length===2&&Object.hasOwn(specs,raw.kind),'invalid daily record kind');
   const [table,names,keys]=specs[raw.kind],fields=names.split(','),v=raw.data;
   check(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===fields.length&&fields.every(k=>Object.hasOwn(v,k))&&keys.every(k=>id(v[k]))&&r.id===await identity(raw.kind,v,keys),'invalid daily identity or fields');
   rows.push({r,kind:raw.kind,table,fields,keys,v});
 }
 const head=rows.find(x=>x.r===root),v=head.v;
 check(['daily_moments','daily_diaries','daily_profile'].includes(head.kind),'restore daily parent first');
 await ensureDailySchema(db);await ensureChatSchema(db);
 for(const x of rows){
   const {r,kind,v}=x;
   if(kind==='daily_profile'){
     check(x===head&&v.id==='owner'&&r.dependencies.length===0&&stamp(v.updated_at),'invalid daily profile');
     for(const k of x.fields.filter(k=>k.endsWith('_dataurl')))check(text(v[k],k==='moment_cover_dataurl'?1200000:360000)&&(!v[k]||/^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/i.test(v[k])),'invalid daily profile image');
     const name=v[x.fields.find(k=>k.endsWith('_display_name'))];check(text(name,80)&&name.trim()===name&&name.length>0&&!/[\r\n\t]/.test(name),'invalid profile name');
   }else if(kind==='daily_moments'||kind==='daily_diaries'){
     check(x===head&&day(v.date)&&validRole(v.author)&&(v.actor===null||validRole(v.actor))&&['manual','chat_tool'].includes(v.source)&&text(v.text,kind==='daily_moments'?12000:24000)&&v.text.trim()&&stamp(v.created_at)&&stamp(v.updated_at),'invalid daily content');
     check(['conversation_id','source_turn_id','tool_call_id'].every(k=>v[k]===null||id(v[k]))&&['surface','model_label','model_nickname','display_author'].every(k=>opt(v[k],180))&&opt(v.symbol,80),'invalid daily provenance');
     if(v.conversation_id){
       check(r.dependencies.length===1&&r.dependencies[0]==='chat/'+v.conversation_id,'missing daily chat dependency');
       const c=await db.prepare("SELECT s.state_json FROM conversations c JOIN conversation_states s ON s.conversation_id=c.id WHERE c.id=? AND c.user_id='owner' AND c.deleted_at IS NULL AND c.conversation_kind='chat'").bind(v.conversation_id).first();
       check(c&&(!v.source_turn_id||JSON.parse(c.state_json).turns.some(t=>t.id===v.source_turn_id)),'restore related owner chat first');
     }else check(!v.source_turn_id&&r.dependencies.length===0,'invalid daily source');
     if(kind==='daily_moments')check(v.status==='published'&&opt(v.reason,1000)&&(v.published_at===null||stamp(v.published_at)),'unsupported moment status');
     else {const tags=JSON.parse(v.tags_json);check(opt(v.weather,80)&&opt(v.mood,120)&&Array.isArray(tags)&&tags.length<=20&&tags.every(t=>text(t,80)),'invalid diary metadata');}
   }else{
     check(head.kind==='daily_moments'&&v.moment_id===head.v.id&&r.dependencies.length===1&&r.dependencies[0]===rootKey&&stamp(v.created_at),'invalid daily child reference');
     if(kind==='daily_comments'){
       check(validRole(v.author)&&text(v.text,2000)&&v.text.trim()&&opt(v.model_id,180),'invalid comment');
       if(v.usage_json!==null){const usage=JSON.parse(v.usage_json);check(usage&&typeof usage==='object'&&!Array.isArray(usage)&&Object.entries(usage).every(([k,n])=>['prompt_tokens','completion_tokens','reasoning_tokens','cached_tokens','total_tokens'].includes(k)&&stamp(n)),'invalid comment usage');}
     }else check(validRole(v.actor),'invalid like actor');
   }
 }
 const prior=await db.prepare('SELECT '+head.fields.join(',')+' FROM '+head.table+' WHERE id=?').bind(v.id).first();
 const same=(a,b,fields)=>a&&fields.every(k=>a[k]===b[k]);
 if(prior){
   check(same(prior,v,head.fields),'target daily record differs; never overwrite');
   if(head.kind==='daily_moments')for(const kind of ['daily_comments','daily_likes']){
     const [table,names]=specs[kind],fields=names.split(','),wanted=rows.filter(x=>x.kind===kind).map(x=>x.v);
     const existing=(await db.prepare('SELECT '+names+' FROM '+table+' WHERE moment_id=?').bind(v.id).all()).results||[];
     check(existing.length===wanted.length&&wanted.every(x=>existing.some(y=>same(y,x,fields))),'target moment comments or likes differ; never overwrite');
   }
 }else{
   if(head.kind==='daily_moments')for(const table of ['daily_moment_comments','daily_moment_likes'])check(!await db.prepare('SELECT moment_id FROM '+table+' WHERE moment_id=? LIMIT 1').bind(v.id).first(),'orphan daily records already exist');
   if(v.tool_call_id)check(!await db.prepare('SELECT id FROM '+head.table+' WHERE tool_call_id=?').bind(v.tool_call_id).first(),'daily tool call conflict');
   for(const x of rows.filter(x=>x.kind==='daily_comments'))check(!await db.prepare('SELECT id FROM daily_moment_comments WHERE id=?').bind(x.v.id).first(),'daily comment conflict');
   const ordered=[head,...rows.filter(x=>x!==head)];
   if(confirm===true)await db.batch(ordered.map(x=>db.prepare('INSERT INTO '+x.table+' ('+x.fields.join(',')+') VALUES ('+x.fields.map(()=>'?').join(',')+')').bind(...x.fields.map(k=>x.v[k]))));
 }
 return {scope:'daily_group',module:'daily',record_id:recordId,comments:rows.filter(x=>x.kind==='daily_comments').length,likes:rows.filter(x=>x.kind==='daily_likes').length,ready:prior?0:rows.length,existing:prior?rows.length:0,can_commit:true,committed:confirm===true};
}
