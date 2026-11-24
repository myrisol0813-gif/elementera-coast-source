import test from 'node:test';
import assert from 'node:assert/strict';
import { D1Database } from './d1-helper.mjs';
import { createCalendarEntry } from '../functions/calendar-store.js';
import { createWorldbookEntry } from '../functions/worldbook.js';
import { writeCustomInstructions } from '../functions/memory-store/memory-custom-store.js';
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
 await writeCustomInstructions(src,{content:'保留原始指令\n第二段'});
 const rows=[['custom_instructions',(await archiveDetailPage(src,'custom_instructions')).items[0]],['calendar',(await archiveRecordPage(src,'calendar')).items[0]],['worldbook',(await archiveDetailPage(src,'worldbook')).items[0]],['model_profile',(await archiveRecordPage(src,'model_profile')).items[0]]];
 const records=[],objects=[];
 for(const [module,row] of rows){
   const r=await encodeRecordObject({kind:module,data:row});objects.push(r);
   const id=['worldbook','custom_instructions'].includes(module)?module+':'+await digestBytes(new TextEncoder().encode(JSON.stringify([row.id]))):row.id;
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
 for(const [module,row] of rows)assert.deepEqual((['worldbook','custom_instructions'].includes(module)?(await archiveDetailPage(dst,module)).items:(await archiveRecordPage(dst,module)).items)[0],row);
 await dst.prepare("UPDATE coast_worldbook_entries SET content='existing change'").run();
 const w=records.find(r=>r.module==='worldbook');await assert.rejects(()=>restoreArchiveRecord(dst,s.id,m,w.module,w.id,true),/never overwrite/);
});

test('local canonical knowledge restores through the same verified cloud record path',async()=>{
 const src=new D1Database(),dst=new D1Database();
 await writeCustomInstructions(src,{content:'Exact instructions\nSecond line'});
 for(let i=0;i<3;i++)await createWorldbookEntry(src,{title:'Word '+i,content:'Original text',keywords:['wave'],constant_active:true});
 const rows=[...((await archiveDetailPage(src,'custom_instructions')).items.map(row=>['custom_instructions',row])),...((await archiveDetailPage(src,'worldbook')).items.map(row=>['worldbook',row]))];
 const records=[],objects=[];
 for(const [module,row] of rows){
   const o=await encodeRecordObject({kind:module,data:row});objects.push(o);
   records.push({module,id:module+':'+await digestBytes(new TextEncoder().encode(JSON.stringify([row.id]))),record_object:o.descriptor.object_sha256,media_objects:[],dependencies:[]});
 }
 const m={format:'elementera-coast-archive',version:2,workspace:'local',application_id:'com.elementeracoast.source',exported_at:'2026-01-01T00:00:00Z',modules:MODULES.map(module=>({module,coverage:records.some(r=>r.module===module)?'partial':'unavailable',count:records.filter(r=>r.module===module).length})),records,objects:objects.map(o=>o.descriptor)};
 const session=await createArchiveSession(dst);
 for(const o of objects){await registerArchiveObject(dst,session.id,o.descriptor);for(let i=0;i<o.chunks.length;i++)await putArchiveChunk(dst,session.id,o.descriptor.object_sha256,i,o.chunks[i]);}
 for(const r of records){
   assert.equal((await restoreArchiveRecord(dst,session.id,m,r.module,r.id,false)).ready,1);
   assert.equal((await restoreArchiveRecord(dst,session.id,m,r.module,r.id,true)).committed,true);
 }
 for(const r of records)assert.equal((await restoreArchiveRecord(dst,session.id,m,r.module,r.id,false)).existing,1);
 assert.deepEqual((await archiveDetailPage(dst,'custom_instructions')).items,(await archiveDetailPage(src,'custom_instructions')).items);
 assert.deepEqual((await archiveDetailPage(dst,'worldbook')).items,(await archiveDetailPage(src,'worldbook')).items);
 const instructions=records.find(r=>r.module==='custom_instructions');
 await assert.rejects(()=>restoreArchiveRecord(dst,session.id,{...m,application_id:'com.elementeracoast.app'},instructions.module,instructions.id,true),/incompatible edition/);
});

test('local V2 calendar record restores through existing portable cloud migration',async()=>{
 const dst=new D1Database();
 const data={id:'local-calendar',day:'2026-11-24',occurrence_day:'2026-11-24',kind:'event',title:'本机纪念',body:'原文',recurrence:'none',author:'owner',source:'manual',created_at:'2026-11-24T00:00:00Z',updated_at:'2026-11-24T00:00:00Z'};
 const o=await encodeRecordObject({kind:'local_calendar',data});
 const record={module:'calendar',id:data.id,record_object:o.descriptor.object_sha256,media_objects:[],dependencies:[]};
 const m={format:'elementera-coast-archive',version:2,workspace:'local',application_id:'com.elementeracoast.source',exported_at:'2026-11-24T00:00:00Z',modules:MODULES.map(module=>({module,coverage:module==='calendar'?'partial':'unavailable',count:module==='calendar'?1:0})),records:[record],objects:[o.descriptor]};
 const s=await createArchiveSession(dst);await registerArchiveObject(dst,s.id,o.descriptor);for(let i=0;i<o.chunks.length;i++)await putArchiveChunk(dst,s.id,o.descriptor.object_sha256,i,o.chunks[i]);
 assert.equal((await restoreArchiveRecord(dst,s.id,m,'calendar',data.id,false)).ready,1);
 assert.equal((await archiveRecordPage(dst,'calendar')).items.length,0);
 assert.equal((await restoreArchiveRecord(dst,s.id,m,'calendar',data.id,true)).committed,true);
 const row=(await archiveRecordPage(dst,'calendar')).items[0];assert.equal(row.title,data.title);assert.equal(row.body,data.body);assert.equal(row.author,'owner');assert.equal(row.created_at,Date.parse(data.created_at));
});

import { ensureToolRunSchema } from '../functions/tool-run-log.js';
import { safeToolPage,validateSafeToolRow } from '../functions/coast-archive-v2-tool-audit.js';
import { createConversation } from '../functions/chat-store.js';
import { readArchiveChat } from '../functions/coast-archive-v2-records.js';
import { restoreArchiveChatGroup } from '../functions/coast-archive-v2-restore.js';

test('archive tool audit never emits secrets or mailbox activity; records are not replayed',async()=>{
 const src=new D1Database(),dst=new D1Database(),c=await createConversation(src,'fixture','main');
 await ensureToolRunSchema(src);
 for(const [id,key,room,status] of [['safe1','memory.search','main_chat','success'],['visitor1','mailbox.reply','main_chat','success'],['connector1','connector.fetch','main_chat','success'],['visitor2','memory.search','mailbox','success'],['running1','memory.search','main_chat','running']]){
  await src.prepare('INSERT INTO coast_tool_runs (id,tool_key,actor,room_scope,conversation_id,status,input_summary,output_summary,error_message,created_at,finished_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind(id,key,'api_model_partner',room,c.id,status,'SECRET_INPUT','SECRET_OUTPUT','SECRET_ERROR',10,status==='running'?null:20).run();
 }
 const page=await safeToolPage(src);assert.equal(page.items.length,1);
 const v=page.items[0];assert.equal(v.id,'safe1');assert.ok(!JSON.stringify(v).includes('SECRET'));
 assert.throws(()=>validateSafeToolRow({...v,input_summary:'SECRET_INPUT'}),/invalid safe/);
 const chat=await encodeRecordObject({kind:'chat',data:await readArchiveChat(src,c.id)}),audit=await encodeRecordObject({kind:'tools',data:v});
 const records=[{module:'chat',id:c.id,record_object:chat.descriptor.object_sha256,media_objects:[],dependencies:[]},{module:'tools',id:v.id,record_object:audit.descriptor.object_sha256,media_objects:[],dependencies:['chat/'+c.id]}];
 const m={format:'elementera-coast-archive',version:2,workspace:'backend',application_id:'com.elementeracoast.source',exported_at:'2026-01-01T00:00:00Z',modules:MODULES.map(module=>({module,coverage:records.some(r=>r.module===module)?'partial':'unavailable',count:records.filter(r=>r.module===module).length})),records,objects:[chat.descriptor,audit.descriptor]};
 const session=await createArchiveSession(dst);for(const o of [chat,audit]){await registerArchiveObject(dst,session.id,o.descriptor);for(let i=0;i<o.chunks.length;i++)await putArchiveChunk(dst,session.id,o.descriptor.object_sha256,i,o.chunks[i]);}
 await assert.rejects(()=>restoreArchiveRecord(dst,session.id,m,'tools',v.id,true),/related owner chat/);
 await restoreArchiveChatGroup(dst,session.id,m,c.id,true);
 assert.equal((await restoreArchiveRecord(dst,session.id,m,'tools',v.id,false)).ready,1);
 assert.equal((await restoreArchiveRecord(dst,session.id,{...m,workspace:'local'},'tools',v.id,true)).committed,true);
 assert.equal((await restoreArchiveRecord(dst,session.id,m,'tools',v.id,false)).existing,1);
 const restored=await dst.prepare('SELECT input_summary,output_summary,error_message FROM coast_tool_runs WHERE id=?').bind(v.id).first();
 assert.deepEqual({...restored},{input_summary:null,output_summary:null,error_message:null});
 assert.deepEqual((await safeToolPage(dst)).items,[v]);
});
