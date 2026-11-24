import test from 'node:test';
import assert from 'node:assert/strict';
import { D1Database } from './d1-helper.mjs';
import { createCalendarEntry } from '../functions/calendar-store.js';
import { createWorldbookEntry } from '../functions/worldbook.js';
import { writeProfile } from '../functions/chat-store.js';
import { archiveRecordPage } from '../functions/coast-archive-v2-records.js';
import { archiveDetailPage } from '../functions/coast-archive-v2-details.js';
import { MODULES,encodeRecordObject } from '../functions/coast-archive-v2-manifest.js';
import { digestBytes } from '../functions/coast-archive-v2-chunks.js';
import { createArchiveSession,registerArchiveObject,putArchiveChunk } from '../functions/coast-archive-v2-stage.js';
import { restoreArchiveRecord } from '../functions/coast-archive-v2-restore-record.js';
test('calendar, worldbook and model profile restore exact portable records; preview does not publish',async()=>{
 const src=new D1Database(),dst=new D1Database();
 await createCalendarEntry(src,{day:'2026-08-13',title:'归档纪念日',body:'原始记录',kind:'event',recurrence:'yearly',anniversary:{startDay:'2026-08-13',mode:'yearly',targetDays:null,pinned:true}},{author:'owner'});
 await createWorldbookEntry(src,{title:'词条',content:'保留的正文',keywords:['海岸'],priority:10});
 await writeProfile(src,{current_chat_model:'fixture/model',model_box:{chat:['fixture/model'],free:[],image:[]}});
 const rows=[['calendar',(await archiveRecordPage(src,'calendar')).items[0]],['worldbook',(await archiveDetailPage(src,'worldbook')).items[0]],['model_profile',(await archiveRecordPage(src,'model_profile')).items[0]]];
 const records=[],objects=[];
 for(const [module,row] of rows){
   const r=await encodeRecordObject({kind:module,data:row});objects.push(r);
   const id=module==='worldbook'?'worldbook:'+await digestBytes(new TextEncoder().encode(JSON.stringify([row.id]))):row.id;
   records.push({module,id,record_object:r.descriptor.object_sha256,media_objects:[],dependencies:[]});
 }
 const m={format:'elementera-coast-archive',version:2,workspace:'backend',application_id:'com.elementeracoast.source',exported_at:'2026-01-01T00:00:00Z',modules:MODULES.map(module=>({module,coverage:records.some(r=>r.module===module)?'partial':'unavailable',count:records.filter(r=>r.module===module).length})),records,objects:objects.map(o=>o.descriptor)};
 const s=await createArchiveSession(dst);
 for(const o of objects){await registerArchiveObject(dst,s.id,o.descriptor);for(let i=0;i<o.chunks.length;i++)await putArchiveChunk(dst,s.id,o.descriptor.object_sha256,i,o.chunks[i]);}
 for(const r of records){
   const before=await restoreArchiveRecord(dst,s.id,m,r.module,r.id,false);assert.equal(before.ready,1);assert.equal(before.committed,false);
   const after=await restoreArchiveRecord(dst,s.id,m,r.module,r.id,true);assert.equal(after.committed,true);
   assert.equal((await restoreArchiveRecord(dst,s.id,m,r.module,r.id,false)).existing,1);
 }
 for(const [module,row] of rows)assert.deepEqual((module==='worldbook'?(await archiveDetailPage(dst,module)).items:(await archiveRecordPage(dst,module)).items)[0],row);
 await dst.prepare("UPDATE coast_worldbook_entries SET content='existing change'").run();
 const w=records.find(r=>r.module==='worldbook');await assert.rejects(()=>restoreArchiveRecord(dst,s.id,m,w.module,w.id,true),/never overwrite/);
});
