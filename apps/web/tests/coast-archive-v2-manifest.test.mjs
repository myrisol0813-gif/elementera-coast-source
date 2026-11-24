import test from 'node:test';
import assert from 'node:assert/strict';
import { D1Database } from './d1-helper.mjs';
import { createConversation } from '../functions/chat-store.js';
import { ensureMemorySchema } from '../functions/memory-store/memory-schema.js';
import { MEMORY_OWNER_ID } from '../functions/memory-store/memory-normalize.js';
import { ensureVoiceSchema } from '../functions/voice-clips.js';
import { archiveRecordPage, readArchiveChat, readArchiveVoice } from '../functions/coast-archive-v2-records.js';
import { MODULES,encodeRecordObject,validateArchiveManifest } from '../functions/coast-archive-v2-manifest.js';
test('manifest requires explicit coverage, all record objects and dependencies',async()=>{
 const {descriptor}=await encodeRecordObject({id:'c',text:'archive fixture'});
 const r={module:'chat',id:'c',record_object:descriptor.object_sha256,media_objects:[],dependencies:[]};
 const m={format:'elementera-coast-archive',version:2,workspace:'backend',application_id:'com.elementeracoast.app',exported_at:'2026-01-01T00:00:00Z',modules:MODULES.map(module=>({module,coverage:module==='chat'?'complete':'unavailable',count:module==='chat'?1:0})),records:[r],objects:[descriptor]};
 assert.equal((await validateArchiveManifest(m)).declaredComplete,false);
 for(const bad of [{...m,modules:m.modules.slice(1)},{...m,records:[{...r,dependencies:['chat/missing']}]},{...m,objects:[descriptor,descriptor]},{...m,objects:[]}])await assert.rejects(()=>validateArchiveManifest(bad));
});
test('owner record pages preserve source text, raw chat history and original voice',async()=>{
 const db=new D1Database();const c=await createConversation(db,'archive','main');const c2=await createConversation(db,'second','main');
 const first=await archiveRecordPage(db,'chat',{limit:1});const next=await archiveRecordPage(db,'chat',{cursor:first.next_cursor,limit:1});
 assert.deepEqual(new Set([first.items[0].id,next.items[0].id]),new Set([c.id,c2.id]));
 const raw='{"version":4,"turns":[],"test":2.50}';
 await db.prepare('UPDATE conversation_states SET state_json=? WHERE conversation_id=?').bind(raw,c.id).run();
 assert.equal((await readArchiveChat(db,c.id)).history_json,raw);
 await ensureMemorySchema(db);
 const insert='INSERT INTO memory_entries (id,user_id,entry_type,scope,title,life_core,content,created_at,updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1)';
 await db.prepare(insert).bind('m1',MEMORY_OWNER_ID,'memory','global','memory','core','原文').run();
 await db.prepare(insert).bind('m2','unrelated','memory','global','other','core','private').run();
 const memories=await archiveRecordPage(db,'memory_entries');assert.deepEqual(memories.items.map(x=>x.id),['m1']);assert.equal(memories.items[0].content,'原文');
 await ensureVoiceSchema(db);
 await db.prepare('INSERT INTO coast_voice_clips (id,conversation_id,source,voice_id,text,audio_bytes,created_at) VALUES (?,?,?,?,?,?,?)').bind('v1',c.id,'manual','voice-id','voice text',3,1).run();
 await db.prepare('INSERT INTO coast_voice_chunks (clip_id,chunk_index,body_b64) VALUES (?,?,?)').bind('v1',0,'AQID').run();
 // voice reader validates the linked conversation's normal state, not the raw fixture above.
 await db.prepare('UPDATE conversation_states SET state_json=? WHERE conversation_id=?').bind('{"version":4,"turns":[]}',c.id).run();
 const v=await readArchiveVoice(db,'v1');assert.deepEqual([...v.chunks[0]],[1,2,3]);
 assert.equal((await archiveRecordPage(db,'voice')).items[0].id,'v1');
 await assert.rejects(()=>archiveRecordPage(db,'mailbox_messages'));
});
