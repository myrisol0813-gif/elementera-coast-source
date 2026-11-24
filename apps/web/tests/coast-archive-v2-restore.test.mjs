import test from 'node:test';
import assert from 'node:assert/strict';
import { D1Database } from './d1-helper.mjs';
import { createConversation } from '../functions/chat-store.js';
import { uploadChatAttachment,getChatAttachmentRecord } from '../functions/chat-attachments.js';
import { readArchiveAttachment } from '../functions/coast-archive-v2-media.js';
import { readArchiveChat } from '../functions/coast-archive-v2-records.js';
import { MODULES,encodeRecordObject } from '../functions/coast-archive-v2-manifest.js';
import { createArchiveSession,registerArchiveObject,putArchiveChunk } from '../functions/coast-archive-v2-stage.js';
import { restoreArchiveChatGroup } from '../functions/coast-archive-v2-restore.js';
test('staged chat group preview and atomic restoration retain raw history and media',async()=>{
 const db=new D1Database(),target=new D1Database(),c=await createConversation(db,'Archive chat group','main');
 const b=new Uint8Array([1,2,3]);
 const a=await uploadChatAttachment(db,c.id,{name:'fixture.bin',type:'application/octet-stream',size:b.length,arrayBuffer:async()=>b.buffer});
 const chat=await readArchiveChat(db,c.id),attachment=await readArchiveAttachment(db,c.id,a.id);
 const chatObj=await encodeRecordObject({kind:'chat',data:chat}),attachObj=await encodeRecordObject({kind:'attachment',data:attachment.metadata});
 const objects=[chatObj,attachObj,attachment],records=[{module:'chat',id:c.id,record_object:chatObj.descriptor.object_sha256,media_objects:[],dependencies:[]},{module:'attachments',id:a.id,record_object:attachObj.descriptor.object_sha256,media_objects:[attachment.descriptor.object_sha256],dependencies:['chat/'+c.id]}];
 const manifest={format:'elementera-coast-archive',version:2,workspace:'backend',application_id:'com.elementeracoast.source',exported_at:'2026-01-01T00:00:00Z',modules:MODULES.map(module=>({module,coverage:['chat','attachments'].includes(module)?'partial':'unavailable',count:records.filter(r=>r.module===module).length})),records,objects:objects.map(o=>o.descriptor)};
 const session=await createArchiveSession(target);
 for(const o of objects){await registerArchiveObject(target,session.id,o.descriptor);for(let i=0;i<o.chunks.length;i++)await putArchiveChunk(target,session.id,o.descriptor.object_sha256,i,o.chunks[i]);}
 const preview=await restoreArchiveChatGroup(target,session.id,manifest,c.id,false);
 assert.equal(preview.committed,false);assert.equal(preview.attachments,1);
 await assert.rejects(()=>readArchiveChat(target,c.id));
 const result=await restoreArchiveChatGroup(target,session.id,manifest,c.id,true);
 assert.equal(result.committed,true);
 assert.deepEqual(await readArchiveChat(target,c.id),chat);
 assert.deepEqual([...new Uint8Array((await getChatAttachmentRecord(target,c.id,a.id)).data)],[1,2,3]);
 await assert.rejects(()=>restoreArchiveChatGroup(target,session.id,manifest,c.id,true),/already exists/);
});
