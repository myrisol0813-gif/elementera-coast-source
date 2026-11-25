import test from 'node:test';
import assert from 'node:assert/strict';
import { D1Database } from './d1-helper.mjs';
import { routeArchiveV2 } from '../functions/coast-archive-v2-api.js';
import { routeApi } from '../functions/api-router.js';
import { describeObject,digestBytes,ARCHIVE_CHUNK_BYTES } from '../functions/coast-archive-v2-chunks.js';
import { verifyStagedArchiveObject } from '../functions/coast-archive-v2-stage.js';
const origin='https://coast.test';
test('owner API stages, resumes, validates and cancels objects without live writes',async()=>{
 const db=new D1Database(),env={COAST_CHAT_DB:db},owner={v:2};
 const call=(path,method='GET',body)=>routeApi(new Request(origin+'/api/archive/v2'+path,{method,headers:{Origin:origin},...(body===undefined?{}:{body})}),env,owner);
 assert.equal((await routeArchiveV2(new Request(origin+'/api/archive/v2/sessions'),env,null)).status,401);
 assert.equal((await routeApi(new Request(origin+'/api/archive/v2/sessions',{method:'POST',headers:{Origin:'https://other.test'}}),env,owner)).status,403);
 const create=await call('/sessions','POST');assert.equal(create.status,201);const id=(await create.json()).session.id;
 const first=new Uint8Array(ARCHIVE_CHUNK_BYTES).fill(9),last=new Uint8Array([1,2,3]);
 const descriptor=await describeObject(first.length+last.length,[await digestBytes(first),await digestBytes(last)]);
 const base='/sessions/'+id+'/objects',item=base+'/'+descriptor.object_sha256;
 assert.equal((await call(base,'POST',JSON.stringify(descriptor))).status,200);
 assert.equal((await call(item+'/chunks/1','PUT',new Uint8Array([1,2,4]))).status,400);
 assert.equal((await call(item+'/chunks/0','PUT',first)).status,200);
 assert.deepEqual((await (await call(item)).json()).received,[0]);
 await assert.rejects(()=>verifyStagedArchiveObject(db,id,descriptor.object_sha256));
 assert.equal((await (await call(item+'/chunks/0','PUT',first)).json()).existing,true);
 assert.equal((await call(item+'/chunks/1','PUT',last)).status,200);
 assert.equal((await (await call(item)).json()).complete,true);
 assert.equal((await verifyStagedArchiveObject(db,id,descriptor.object_sha256)).size,descriptor.size);
 assert.equal((await call('/sessions/'+id,'DELETE')).status,200);
 assert.equal((await call(item)).status,404);
 assert.equal(db.database.prepare('SELECT COUNT(*) AS n FROM coast_archive_chunks').get().n,0);
});

test('archive failure reports only fixed operation and safe reason, never database contents or record identity',async()=>{
 const db={prepare(){throw Error('D1_ERROR: no such column: private_column_secret');}};
 const env={COAST_CHAT_DB:db},owner={v:2};
 const response=await routeArchiveV2(new Request(origin+'/api/archive/v2/records/chat/private-record-id'),env,owner);
 assert.equal(response.status,500);
 const error=(await response.json()).error;
 assert.equal(error.stage,'records:chat:detail');
 assert.equal(error.reason,'schema_column');
 assert.match(error.message,/records:chat:detail/);
 assert.match(error.reference,/^[a-f0-9]{8}$/);
 assert.doesNotMatch(JSON.stringify(error),/private_column_secret|private-record-id/);
});

test('creating a session reaps expired staging bytes but preserves active sessions',async()=>{
 const db=new D1Database(),env={COAST_CHAT_DB:db},owner={v:2};
 const call=(path,method='GET',body)=>routeApi(new Request(origin+'/api/archive/v2'+path,{method,headers:{Origin:origin},...(body===undefined?{}:{body})}),env,owner);
 const expired=(await (await call('/sessions','POST')).json()).session.id;
 const active=(await (await call('/sessions','POST')).json()).session.id;
 const bytes=new Uint8Array([4,5,6]),descriptor=await describeObject(bytes.length,[await digestBytes(bytes)]);
 for(const sid of [expired,active]){
   const base='/sessions/'+sid+'/objects';
   assert.equal((await call(base,'POST',JSON.stringify(descriptor))).status,200);
   assert.equal((await call(base+'/'+descriptor.object_sha256+'/chunks/0','PUT',bytes)).status,200);
 }
 await db.prepare('UPDATE coast_archive_sessions SET expires_at=? WHERE id=?').bind(1,expired).run();
 assert.equal((await call('/sessions','POST')).status,201);
 assert.equal((await call('/sessions/'+expired+'/objects/'+descriptor.object_sha256)).status,404);
 assert.equal((await call('/sessions/'+active+'/objects/'+descriptor.object_sha256)).status,200);
 assert.equal(db.database.prepare('SELECT COUNT(*) AS n FROM coast_archive_chunks').get().n,1);
});
