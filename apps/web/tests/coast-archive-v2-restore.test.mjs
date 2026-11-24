import test from 'node:test';
import assert from 'node:assert/strict';
import { D1Database } from './d1-helper.mjs';
import { ensureVoiceSchema,voiceClipAudio } from '../functions/voice-clips.js';
import { ensureMemorySchema } from '../functions/memory-store/memory-schema.js';
import { digestBytes } from '../functions/coast-archive-v2-chunks.js';
import { archiveDetailPage } from '../functions/coast-archive-v2-details.js';
import { createConversation } from '../functions/chat-store.js';
import { uploadChatAttachment,getChatAttachmentRecord } from '../functions/chat-attachments.js';
import { readArchiveAttachment } from '../functions/coast-archive-v2-media.js';
import { readArchiveChat,readArchiveVoice } from '../functions/coast-archive-v2-records.js';
import { MODULES,encodeRecordObject } from '../functions/coast-archive-v2-manifest.js';
import { createArchiveSession,registerArchiveObject,putArchiveChunk } from '../functions/coast-archive-v2-stage.js';
import { saveTreasure } from '../functions/coast-vault-treasures.js';
import { restoreArchiveRecord } from '../functions/coast-archive-v2-restore-record.js';
import { restoreArchiveChatGroup } from '../functions/coast-archive-v2-restore.js';
test('staged chat group preview and atomic restoration retain raw history and media',async()=>{
 const db=new D1Database(),target=new D1Database(),c=await createConversation(db,'Archive chat group','main');
 const b=new Uint8Array([1,2,3]);
 const a=await uploadChatAttachment(db,c.id,{name:'fixture.bin',type:'application/octet-stream',size:b.length,arrayBuffer:async()=>b.buffer});
 const chat=await readArchiveChat(db,c.id),attachment=await readArchiveAttachment(db,c.id,a.id);
 const chatObj=await encodeRecordObject({kind:'chat',data:chat}),attachObj=await encodeRecordObject({kind:'attachment',data:attachment.metadata});
 const objects=[chatObj,attachObj,attachment],records=[{module:'chat',id:c.id,record_object:chatObj.descriptor.object_sha256,media_objects:[],dependencies:[]},{module:'attachments',id:a.id,record_object:attachObj.descriptor.object_sha256,media_objects:[attachment.descriptor.object_sha256],dependencies:['chat/'+c.id]}];
 const manifest={format:'elementera-coast-archive',version:2,workspace:'backend',application_id:'com.elementeracoast.source',exported_at:'2026-01-01T00:00:00Z',modules:MODULES.map(module=>({module,coverage:['chat','attachments'].includes(module)?'partial':'unavailable',count:records.filter(r=>r.module===module).length})),records,objects:objects.map(o=>o.descriptor)};
 await ensureVoiceSchema(db);
 await db.prepare('INSERT INTO coast_voice_clips (id,conversation_id,source,voice_id,text,audio_bytes,created_at) VALUES (?,?,?,?,?,?,?)').bind('voice-fixture',c.id,'manual','voice','fixture',3,1).run();
 await db.prepare('INSERT INTO coast_voice_chunks (clip_id,chunk_index,body_b64) VALUES (?,?,?)').bind('voice-fixture',0,'BAUG').run();
 const v=await readArchiveVoice(db,'voice-fixture'),vRecord=await encodeRecordObject({kind:'voice',data:v.metadata});
 objects.push(vRecord,v);records.push({module:'voice',id:'voice-fixture',record_object:vRecord.descriptor.object_sha256,media_objects:[v.descriptor.object_sha256],dependencies:['chat/'+c.id]});
 await ensureMemorySchema(db);
 await db.prepare('INSERT INTO conversation_soils (conversation_id,current_text,created_at,updated_at) VALUES (?,?,?,?)').bind(c.id,'原始思维壤',1,1).run();
 const soil=(await archiveDetailPage(db,'thinking_soil')).items[0],soilRecord=await encodeRecordObject({kind:'thinking_soil',data:soil});
 objects.push(soilRecord);records.push({module:'thinking_soil',id:'thinking_soil:'+await digestBytes(new TextEncoder().encode(JSON.stringify([c.id]))),record_object:soilRecord.descriptor.object_sha256,media_objects:[],dependencies:['chat/'+c.id]});
 await saveTreasure(db,{kind:'audio',conversation_id:c.id,source_id:'voice-fixture',notes:'保留备注'});
 for(const data of (await archiveDetailPage(db,'vault_treasures')).items){
   const o=await encodeRecordObject({kind:'vault_treasures',data});objects.push(o);
   records.push({module:'vault',id:'vault_treasures:'+await digestBytes(new TextEncoder().encode(JSON.stringify([data.id]))),record_object:o.descriptor.object_sha256,media_objects:[],dependencies:['chat/'+c.id]});
 }
 manifest.objects=objects.map(o=>o.descriptor);for(const m of manifest.modules){m.count=records.filter(r=>r.module===m.module).length;if(m.count)m.coverage='partial';}
 const session=await createArchiveSession(target);
 for(const o of objects){await registerArchiveObject(target,session.id,o.descriptor);for(let i=0;i<o.chunks.length;i++)await putArchiveChunk(target,session.id,o.descriptor.object_sha256,i,o.chunks[i]);}
 const treasure=records.find(r=>r.module==='vault');
 await assert.rejects(()=>restoreArchiveRecord(target,session.id,manifest,'vault',treasure.id,true),/restore owner chat first/);
 const preview=await restoreArchiveChatGroup(target,session.id,manifest,c.id,false);
 assert.equal(preview.committed,false);assert.equal(preview.attachments,1);
 await assert.rejects(()=>readArchiveChat(target,c.id));
 const result=await restoreArchiveChatGroup(target,session.id,manifest,c.id,true);
 assert.equal(result.committed,true);assert.equal(result.voices,1);assert.equal(result.soils,1);
 assert.deepEqual([...await voiceClipAudio(target,'voice-fixture')],[4,5,6]);
 assert.deepEqual((await archiveDetailPage(target,'thinking_soil')).items,[soil]);
 assert.deepEqual(await readArchiveChat(target,c.id),chat);
 assert.equal((await restoreArchiveRecord(target,session.id,manifest,'vault',treasure.id,false)).ready,1);
 assert.equal((await archiveDetailPage(target,'vault_treasures')).items.length,0);
 await restoreArchiveRecord(target,session.id,{...manifest,workspace:'local'},'vault',treasure.id,true);
 assert.deepEqual((await archiveDetailPage(target,'vault_treasures')).items,(await archiveDetailPage(db,'vault_treasures')).items);
 assert.deepEqual([...new Uint8Array((await getChatAttachmentRecord(target,c.id,a.id)).data)],[1,2,3]);
 await assert.rejects(()=>restoreArchiveChatGroup(target,session.id,manifest,c.id,true),/already exists/);
});

test('local archive with binary originals restores as a single cloud transaction',async()=>{
 const src=new D1Database(),dst=new D1Database(),c=await createConversation(src,'Local fixture','main');
 const bytes=new Uint8Array([0,255,19,128,0,1]);
 const a=await uploadChatAttachment(src,c.id,{name:'original.bin',type:'application/octet-stream',size:bytes.length,arrayBuffer:async()=>bytes.buffer});
 const chat=await readArchiveChat(src,c.id),media=await readArchiveAttachment(src,c.id,a.id);
 const iso=v=>v==null?null:new Date(v).toISOString();
 const conversation={...chat.conversation,created_at:iso(chat.conversation.created_at),updated_at:iso(chat.conversation.updated_at),title_manual:!!chat.conversation.title_manual,title_generated_at:iso(chat.conversation.title_generated_at)};
 const history={...JSON.parse(chat.history_json),conversation_id:c.id};
 const local=await encodeRecordObject({kind:'local_chat',data:{conversation,history}});
 const attachment=await encodeRecordObject({kind:'attachment',data:media.metadata});
 const records=[{module:'chat',id:c.id,record_object:local.descriptor.object_sha256,media_objects:[],dependencies:[]},{module:'attachments',id:a.id,record_object:attachment.descriptor.object_sha256,media_objects:[media.descriptor.object_sha256],dependencies:['chat/'+c.id]}];
 const objects=[local,attachment,media];
 const manifest={format:'elementera-coast-archive',version:2,workspace:'local',application_id:'com.elementeracoast.source',exported_at:'2026-11-24T00:00:00Z',modules:MODULES.map(module=>({module,coverage:['chat','attachments'].includes(module)?'partial':'unavailable',count:records.filter(r=>r.module===module).length})),records,objects:objects.map(o=>o.descriptor)};
 const session=await createArchiveSession(dst);
 for(const o of objects){await registerArchiveObject(dst,session.id,o.descriptor);for(let i=0;i<o.chunks.length;i++)await putArchiveChunk(dst,session.id,o.descriptor.object_sha256,i,o.chunks[i]);}
 const preview=await restoreArchiveRecord(dst,session.id,manifest,'chat',c.id,false);
 assert.equal(preview.attachments,1);assert.equal(preview.committed,false);
 await assert.rejects(()=>readArchiveChat(dst,c.id));
 await assert.rejects(()=>restoreArchiveChatGroup(dst,session.id,{...manifest,application_id:'com.elementeracoast.app'},c.id,true),/same-edition/);
 await restoreArchiveChatGroup(dst,session.id,manifest,c.id,true);
 assert.deepEqual([...new Uint8Array((await getChatAttachmentRecord(dst,c.id,a.id)).data)],[...bytes]);
 assert.equal((await readArchiveChat(dst,c.id)).conversation.title,'Local fixture');
 await assert.rejects(()=>restoreArchiveChatGroup(dst,session.id,manifest,c.id,true),/already exists/);
});
