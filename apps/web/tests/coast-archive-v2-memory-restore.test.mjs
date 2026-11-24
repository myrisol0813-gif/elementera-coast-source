import test from 'node:test';
import assert from 'node:assert/strict';
import { D1Database } from './d1-helper.mjs';
import { createConversation } from '../functions/chat-store.js';
import { createEntry } from '../functions/memory-store/memory-entry-store.js';
import { createPocket } from '../functions/memory-store/memory-pocket-store.js';
import { archiveRecordPage,readArchiveChat } from '../functions/coast-archive-v2-records.js';
import { MODULES,encodeRecordObject } from '../functions/coast-archive-v2-manifest.js';
import { createArchiveSession,registerArchiveObject,putArchiveChunk } from '../functions/coast-archive-v2-stage.js';
import { restoreArchiveRecord } from '../functions/coast-archive-v2-restore-record.js';
import { restoreArchiveChatGroup } from '../functions/coast-archive-v2-restore.js';
test('owner memory and pocket exact restore, target vector indexes reset, conflicts not overwritten',async()=>{
 const src=new D1Database(),dst=new D1Database(),c=await createConversation(src,'fixture','main');
 const entry=await createEntry(src,{entry_type:'memory',title:'记录',life_core:'生命核',content:'原文',source_ref:{note:'history'},memory_level:'core',tag:'历史锚点'});
 const pocket=await createPocket(src,{conversation_id:c.id,source_type:'soil',source_text:'候选原文',fingerprint:'fixture-fingerprint'});
 await src.prepare("UPDATE memory_entries SET vector_id='old-index',embedding_status='ready' WHERE id=?").bind(entry.id).run();
 await src.prepare("UPDATE memory_pockets SET vector_ids_json='[\"old-index\"]',embedding_status='ready' WHERE id=?").bind(pocket.id).run();
 const records=[],objects=[];
 async function add(module,id,data,deps=[]){const o=await encodeRecordObject({kind:module,data});objects.push(o);records.push({module,id,record_object:o.descriptor.object_sha256,media_objects:[],dependencies:deps});}
 await add('chat',c.id,await readArchiveChat(src,c.id));
 await add('memory_entries',entry.id,(await archiveRecordPage(src,'memory_entries')).items[0]);
 await add('memory_pockets',pocket.id,(await archiveRecordPage(src,'memory_pockets')).items[0],['chat/'+c.id]);
 const m={format:'elementera-coast-archive',version:2,workspace:'backend',application_id:'com.elementeracoast.source',exported_at:'2026-01-01T00:00:00Z',modules:MODULES.map(module=>({module,coverage:records.some(r=>r.module===module)?'partial':'unavailable',count:records.filter(r=>r.module===module).length})),records,objects:objects.map(o=>o.descriptor)};
 const s=await createArchiveSession(dst);
 for(const o of objects){await registerArchiveObject(dst,s.id,o.descriptor);for(let i=0;i<o.chunks.length;i++)await putArchiveChunk(dst,s.id,o.descriptor.object_sha256,i,o.chunks[i]);}
 await assert.rejects(()=>restoreArchiveRecord(dst,s.id,m,'memory_pockets',pocket.id,true),/restore related owner chat first/);
 await restoreArchiveChatGroup(dst,s.id,m,c.id,true);
 const local={...m,workspace:'local'};
 for(const r of records.slice(1)){
   assert.equal((await restoreArchiveRecord(dst,s.id,local,r.module,r.id,false)).ready,1);
   assert.equal((await archiveRecordPage(dst,r.module)).items.length,0);
   await restoreArchiveRecord(dst,s.id,local,r.module,r.id,true);
   assert.deepEqual((await archiveRecordPage(dst,r.module)).items,(await archiveRecordPage(src,r.module)).items);
   assert.equal((await restoreArchiveRecord(dst,s.id,m,r.module,r.id,false)).existing,1);
 }
 const e=await dst.prepare('SELECT vector_id,embedding_status FROM memory_entries WHERE id=?').bind(entry.id).first();
 assert.deepEqual({...e},{vector_id:null,embedding_status:'pending'});
 const p=await dst.prepare('SELECT vector_ids_json,embedding_status FROM memory_pockets WHERE id=?').bind(pocket.id).first();
 assert.deepEqual({...p},{vector_ids_json:'[]',embedding_status:'pending'});
 await dst.prepare("UPDATE memory_entries SET content='target revision' WHERE id=?").bind(entry.id).run();
 await assert.rejects(()=>restoreArchiveRecord(dst,s.id,m,'memory_entries',entry.id,true),/never overwrite/);
});
