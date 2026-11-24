import { ensureUserPortraitSchema } from './memory-store/user-portrait-store.js';
import { ensureGlobalExcerptSchema } from './memory-store/global-excerpt-store.js';
import { validateArchiveManifest } from './coast-archive-v2-manifest.js';
import { stageVerifiedObject,digestBytes } from './coast-archive-v2-chunks.js';
import { readStagedArchiveChunks } from './coast-archive-v2-stage.js';
const check=(ok,msg)=>{if(!ok)throw Object.assign(Error(msg),{status:409});};
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(v);
const stamp=v=>Number.isSafeInteger(v)&&v>=0;
const text=(v,n)=>typeof v==='string'&&v.length<=n;
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const rootFields='id,body,write_enabled,revision,created_at,updated_at'.split(',');
const candidateFields='id,proposed_body,change_kind,reason,source_conversation_id,source_message_id,source_model,created_at'.split(',');
const revisionFields='id,revision,before_body,after_body,source_conversation_id,source_message_id,model_reason,confirmation_mode,operator,created_at'.split(',');
export const PORTRAIT_RESTORE_MODULES=Object.freeze(['user_portrait','self_portrait']);
export async function restoreArchivePortrait(db,sessionId,manifest,module,recordId,confirm=false){
 await validateArchiveManifest(manifest);
 check(['backend','local'].includes(manifest.workspace)&&manifest.application_id==='com.elementeracoast.source'&&PORTRAIT_RESTORE_MODULES.includes(module),'portrait restore requires same-edition archive');
 const group=manifest.records.filter(r=>r.module===module),objects=new Map(manifest.objects.map(o=>[o.object_sha256,o]));
 check(group.length>0&&group.length<=88&&group.reduce((n,r)=>n+objects.get(r.record_object).size,0)<=16*1024*1024,'portrait exceeds current transaction budget');
 const table=module==='user_portrait'?'user_portrait':'global_excerpt';
 const kinds={[module]:[table,rootFields],[module+'_candidates']:[table+'_candidates',candidateFields],[module+'_revisions']:[table+'_revisions',revisionFields]};
 const rows=[];
 for(const r of group){
   check(r.media_objects.length===0&&r.dependencies.length===0,'invalid portrait dependency');
   const d=objects.get(r.record_object);check(d.size<=1800000,'portrait record too large');
   const bytes=new Uint8Array(d.size);let at=0;
   await stageVerifiedObject(d,readStagedArchiveChunks(db,sessionId,d.object_sha256),async b=>{bytes.set(b,at);at+=b.length;},{maxBytes:1800000});
   const raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
   check(exact(raw,['kind','data'])&&Object.hasOwn(kinds,raw.kind),'invalid portrait record kind');
   const [target,fields]=kinds[raw.kind],v=raw.data;
   check(exact(v,fields)&&id(v.id)&&stamp(v.created_at)&&r.id===raw.kind+':'+await digestBytes(new TextEncoder().encode(JSON.stringify([v.id]))),'invalid portrait identity');
   if(raw.kind===module)check(v.id==='global'&&r.id===recordId&&text(v.body,240000)&&[0,1].includes(v.write_enabled)&&Number.isSafeInteger(v.revision)&&v.revision>=1&&stamp(v.updated_at),'invalid portrait root');
   else{
     check([v.source_conversation_id,v.source_message_id].every(x=>x===null||id(x)),'invalid portrait provenance');
     if(raw.kind.endsWith('_candidates'))check(text(v.proposed_body,240000)&&v.proposed_body.trim()&&text(v.change_kind,40)&&text(v.reason,4000)&&text(v.source_model,200),'invalid portrait candidate');
     else check(Number.isSafeInteger(v.revision)&&v.revision>=2&&text(v.before_body,240000)&&text(v.after_body,240000)&&text(v.model_reason,4000)&&['confirm','edited_confirm','clear'].includes(v.confirmation_mode)&&text(v.operator,40),'invalid portrait revision');
   }
   rows.push({target,fields,v,kind:raw.kind});
 }
 const roots=rows.filter(x=>x.kind===module);check(roots.length===1,'portrait root missing');
 const root=roots[0].v,history=rows.filter(x=>x.kind===module+'_revisions').map(x=>x.v).sort((a,b)=>a.revision-b.revision);
 check(history.length===root.revision-1&&history.every((v,i)=>v.revision===i+2&&(i===0||v.before_body===history[i-1].after_body))&&(!history.length||history.at(-1).after_body===root.body),'portrait history incomplete or inconsistent');
 await (module==='user_portrait'?ensureUserPortraitSchema:ensureGlobalExcerptSchema)(db);
 const current=await db.prepare('SELECT '+rootFields.join(',')+' FROM '+table+" WHERE id='global'").first();
 const existingCandidates=(await db.prepare('SELECT '+candidateFields.join(',')+' FROM '+table+'_candidates').all()).results||[];
 const existingRevisions=(await db.prepare('SELECT '+revisionFields.join(',')+' FROM '+table+'_revisions').all()).results||[];
 const same=(a,b,fields)=>a&&b&&fields.every(k=>a[k]===b[k]);
 const sameRows=(existing,wanted,fields)=>existing.length===wanted.length&&wanted.every(v=>same(existing.find(e=>e.id===v.id),v,fields));
 const identical=same(current,root,rootFields)&&sameRows(existingCandidates,rows.filter(x=>x.kind===module+'_candidates').map(x=>x.v),candidateFields)&&sameRows(existingRevisions,history,revisionFields);
 check(identical||current&&current.body===''&&current.revision===1&&current.write_enabled===1&&current.created_at===current.updated_at&&!existingCandidates.length&&!existingRevisions.length,'target portrait already has content or history; never overwrite');
 if(confirm===true&&!identical){
   // Fail the whole batch if the blank target changed after the read.
   const guard=db.prepare('INSERT INTO '+table+" (id,body,write_enabled,revision,created_at,updated_at) SELECT 'global',NULL,1,1,0,0 WHERE NOT EXISTS (SELECT 1 FROM "+table+" WHERE id='global' AND body='' AND revision=1 AND write_enabled=1 AND created_at=? AND updated_at=?) OR EXISTS(SELECT 1 FROM "+table+"_candidates) OR EXISTS(SELECT 1 FROM "+table+"_revisions)").bind(current.created_at,current.updated_at);
   const statements=[guard,db.prepare('UPDATE '+table+" SET body=?,write_enabled=?,revision=?,created_at=?,updated_at=? WHERE id='global'").bind(root.body,root.write_enabled,root.revision,root.created_at,root.updated_at)];
   for(const {target,fields,v,kind} of rows)if(kind!==module)statements.push(db.prepare('INSERT INTO '+target+' ('+fields.join(',')+') VALUES ('+fields.map(()=>'?').join(',')+')').bind(...fields.map(k=>v[k])));
   await db.batch(statements);
 }
 return {scope:'portrait_group',module,record_id:recordId,candidates:rows.filter(x=>x.kind.endsWith('_candidates')).length,revisions:history.length,ready:identical?0:rows.length,existing:identical?rows.length:0,can_commit:true,committed:confirm===true};
}
