import test from 'node:test';
import assert from 'node:assert/strict';
import { D1Database } from './d1-helper.mjs';
import { createUserPortraitCandidate,confirmUserPortraitCandidate,readUserPortrait } from '../functions/memory-store/user-portrait-store.js';
import { createGlobalExcerptCandidate,confirmGlobalExcerptCandidate,readGlobalExcerpt } from '../functions/memory-store/global-excerpt-store.js';
import { archiveDetailPage } from '../functions/coast-archive-v2-details.js';
import { MODULES,encodeRecordObject } from '../functions/coast-archive-v2-manifest.js';
import { digestBytes } from '../functions/coast-archive-v2-chunks.js';
import { createArchiveSession,registerArchiveObject,putArchiveChunk } from '../functions/coast-archive-v2-stage.js';
import { restoreArchiveRecord } from '../functions/coast-archive-v2-restore-record.js';
test('portrait group preserves body, candidate and revision history; refuses existing target edits',async()=>{
 const src=new D1Database(),dst=new D1Database(),conflict=new D1Database();
 const records=[],objects=[];
 for(const [module,create,confirm] of [['user_portrait',createUserPortraitCandidate,confirmUserPortraitCandidate],['self_portrait',createGlobalExcerptCandidate,confirmGlobalExcerptCandidate]]){
   const c=await create(src,{proposed_body:'first',reason:'reason'});await confirm(src,c.id,{edited_body:'confirmed text'});
   await create(src,{proposed_body:'next candidate',reason:'pending'});
   for(const kind of [module,module+'_candidates',module+'_revisions'])for(const data of (await archiveDetailPage(src,kind)).items){
     const o=await encodeRecordObject({kind,data});objects.push(o);
     records.push({module,id:kind+':'+await digestBytes(new TextEncoder().encode(JSON.stringify([data.id]))),record_object:o.descriptor.object_sha256,media_objects:[],dependencies:[]});
   }
 }
 const m={format:'elementera-coast-archive',version:2,workspace:'backend',application_id:'com.elementeracoast.source',exported_at:'2026-01-01T00:00:00Z',modules:MODULES.map(module=>({module,coverage:records.some(r=>r.module===module)?'partial':'unavailable',count:records.filter(r=>r.module===module).length})),records,objects:objects.map(o=>o.descriptor)};
 async function stage(db){const s=await createArchiveSession(db);for(const o of objects){await registerArchiveObject(db,s.id,o.descriptor);for(let i=0;i<o.chunks.length;i++)await putArchiveChunk(db,s.id,o.descriptor.object_sha256,i,o.chunks[i]);}return s.id;}
 const sid=await stage(dst);
 for(const [module,read] of [['user_portrait',readUserPortrait],['self_portrait',readGlobalExcerpt]]){
   const root=records.find(r=>r.module===module&&r.id.startsWith(module+':'));
   assert.equal((await restoreArchiveRecord(dst,sid,m,module,root.id,false)).ready,3);
   assert.equal((await read(dst)).body,'');
   assert.equal((await restoreArchiveRecord(dst,sid,m,module,root.id,true)).committed,true);
   for(const kind of [module,module+'_candidates',module+'_revisions'])assert.deepEqual((await archiveDetailPage(dst,kind)).items,(await archiveDetailPage(src,kind)).items);
   assert.equal((await restoreArchiveRecord(dst,sid,m,module,root.id,false)).existing,3);
 }
 const c=await createUserPortraitCandidate(conflict,{proposed_body:'existing'});
 await confirmUserPortraitCandidate(conflict,c.id,{});
 const cs=await stage(conflict),r=records.find(x=>x.id.startsWith('user_portrait:'));
 await assert.rejects(()=>restoreArchiveRecord(conflict,cs,m,r.module,r.id,true),/never overwrite/);
 assert.equal((await readUserPortrait(conflict)).body,'existing');
});
