import test from 'node:test';
import assert from 'node:assert/strict';
import { ARCHIVE_CHUNK_BYTES, digestBytes, describeObject, stageVerifiedObject, objectPath } from '../functions/coast-archive-v2-chunks.js';
test('V2 stages valid chunks and rejects missing, changed and extra bytes',async()=>{
 const first=new Uint8Array(ARCHIVE_CHUNK_BYTES).fill(7), last=new Uint8Array([1,2,3]);
 const descriptor=await describeObject(first.length+last.length,[await digestBytes(first),await digestBytes(last)]);
 const written=[];
 await stageVerifiedObject(descriptor,[first,last],async(chunk,index)=>written.push([index,chunk.length]));
 assert.deepEqual(written,[[0,first.length],[1,last.length]]);
 assert.equal(objectPath(descriptor),'objects/'+descriptor.object_sha256);
 for(const input of [[first],[first,new Uint8Array([1,2,4])],[first,last,last],[last,first]]) await assert.rejects(()=>stageVerifiedObject(descriptor,input,async()=>{}));
 await assert.rejects(()=>stageVerifiedObject({...descriptor,size:descriptor.size+1},[first,last],async()=>{}));
});
test('large object descriptors are independent of V1 envelope limits',async()=>{
 const hash=await digestBytes(new Uint8Array(ARCHIVE_CHUNK_BYTES));
 const count=3072;
 const descriptor=await describeObject(count*ARCHIVE_CHUNK_BYTES,Array(count).fill(hash));
 assert.equal(descriptor.size,3221225472);
 assert.equal(descriptor.chunks.length,count);
 await assert.rejects(()=>stageVerifiedObject(descriptor,[],async()=>{},{maxBytes:1024}));
});
