import test from 'node:test';
import assert from 'node:assert/strict';
import { collectArchiveV2 } from '../elementera-mcp/deploy-pages/public/core/archive-v2-collect.js';
import { MODULES,validateArchiveManifest } from '../functions/coast-archive-v2-manifest.js';
import { digestBytes,describeObject } from '../functions/coast-archive-v2-chunks.js';
const encoder=new TextEncoder(),decoder=new TextDecoder();
function entries(bytes){
 const d=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),end=bytes.length-22;
 assert.equal(d.getUint32(end,true),0x06054b50);
 let p=d.getUint32(end+16,true),count=d.getUint16(end+10,true);const files=new Map();
 for(let i=0;i<count;i++){
   assert.equal(d.getUint32(p,true),0x02014b50);
   const nameLen=d.getUint16(p+28,true),size=d.getUint32(p+24,true),start=d.getUint32(p+42,true);
   const name=decoder.decode(bytes.subarray(p+46,p+46+nameLen));
   assert.equal(d.getUint32(start,true),0x04034b50);
   const dataStart=start+30+d.getUint16(start+26,true)+d.getUint16(start+28,true);
   const data=bytes.slice(dataStart,dataStart+size);
   assert.equal(d.getUint32(dataStart+size,true),0x08074b50);
   assert.equal(d.getUint32(dataStart+size+4,true),d.getUint32(p+16,true));
   files.set(name,data);p+=46+nameLen+d.getUint16(p+30,true)+d.getUint16(p+32,true);
 }
 return files;
}
async function fixture({bad=false}={}){
 const media=new Uint8Array([1,2,3]),descriptor=await describeObject(media.length,[await digestBytes(media)]);
 const parts=[],state={closed:false,aborted:false};
 const sink={write:async b=>parts.push(b.slice()),close:async()=>{state.closed=true;},abort:async()=>{state.aborted=true;parts.length=0;}};
 const page=items=>({items,next_cursor:null});
 const transport={
   capabilities:async()=>({manifest_modules:MODULES,record_modules:['chat'],detail_modules:{library_books:'library',library_covers:'library'}}),
   recordPage:async()=>page([{id:'c'}]),
   chat:async()=>({conversation:{id:'c'},history_json:'{"receipt":2.50}',history_updated_at:1}),
   attachmentPage:async()=>page([{id:'a',conversation_id:'c'}]),
   attachment:async()=>({metadata:{id:'a',conversation_id:'c'},descriptor}),
   attachmentChunk:async()=>bad?new Uint8Array([1,2,4]):media,
   dogtalkPage:async()=>page([]),
   detailPage:async kind=>page(kind==='library_books'?[{id:'book'}]:[{book_id:'book'}]),
   libraryCover:async()=>({metadata:{book_id:'book'},descriptor}),
   libraryCoverChunk:async()=>media,
   validateManifest:validateArchiveManifest
 };
 return {sink,state,transport,descriptor,parts};
}
test('collector writes one object per digest, manifest and raw history in sequential ZIP',async()=>{
 const f=await fixture(),m=await collectArchiveV2({...f,applicationId:'com.elementeracoast.app'});
 assert.equal(f.state.closed,true);assert.equal(f.state.aborted,false);
 const files=entries(new Uint8Array(await new Blob(f.parts).arrayBuffer()));
 assert.deepEqual(JSON.parse(decoder.decode(files.get('manifest.json'))),m);
 assert.deepEqual([...files.get('objects/'+f.descriptor.object_sha256)],[1,2,3]);
 assert.equal(files.size,m.objects.length+1);
 assert.equal(m.records.length,4);
 assert.equal(m.records.filter(r=>r.media_objects.includes(f.descriptor.object_sha256)).length,2);
 const chat=m.records.find(r=>r.module==='chat');
 assert.equal(JSON.parse(decoder.decode(files.get('objects/'+chat.record_object))).data.history_json,'{"receipt":2.50}');
 assert.equal((await validateArchiveManifest(m)).declaredComplete,false);
});
test('damaged originals abort output without finishing an archive',async()=>{
 const f=await fixture({bad:true});
 await assert.rejects(()=>collectArchiveV2({...f,applicationId:'com.elementeracoast.app'}),/corrupt/);
 assert.equal(f.state.aborted,true);assert.equal(f.state.closed,false);assert.equal(f.parts.length,0);
});
