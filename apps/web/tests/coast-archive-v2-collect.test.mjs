import { openArchiveV2 } from '../elementera-mcp/deploy-pages/public/core/archive-v2-read.js';
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

test('browser reopens the streamed archive and verifies all object chunks before upload',async()=>{
 const f=await fixture(),m=await collectArchiveV2({...f,applicationId:'com.elementeracoast.app'});
 const zip=new Blob(f.parts),opened=await openArchiveV2(zip,validateArchiveManifest);
 assert.deepEqual(opened.manifest,m);
 for(const d of m.objects){let n=0;for await(const chunk of opened.objectChunks(d))n+=chunk.length;assert.equal(n,d.size);}
 // Mutate an original payload, keeping its central-directory metadata intact.
 const bytes=new Uint8Array(await zip.arrayBuffer()),d=new DataView(bytes.buffer);
 let p=d.getUint32(bytes.length-6,true);
 while(d.getUint32(p,true)===0x02014b50){
   const len=d.getUint16(p+28,true),name=decoder.decode(bytes.subarray(p+46,p+46+len));
   if(name==='objects/'+f.descriptor.object_sha256){const local=d.getUint32(p+42,true);bytes[local+30+d.getUint16(local+26,true)+d.getUint16(local+28,true)]^=255;break;}
   p+=46+len+d.getUint16(p+30,true)+d.getUint16(p+32,true);
 }
 const broken=await openArchiveV2(new Blob([bytes]),validateArchiveManifest);
 await assert.rejects(async()=>{for await(const b of broken.objectChunks(f.descriptor)){}},/digest|CRC/);
});

test('portable browser settings are explicit, verified and do not include credentials',async()=>{
 const {parseDeviceBasic,decodeDeviceBasic,restoreDeviceBasic}=await import('../elementera-mcp/deploy-pages/public/core/archive-v2-device-settings.js');
 const f=await fixture(),m=await collectArchiveV2({...f,applicationId:'com.elementeracoast.source',deviceBasic:{replySequenceToolBudget:0,replySequenceTokenBudget:95000,toolCallLimit:41,contextBudget:0,apiKey:'secret'}});
 const opened=await openArchiveV2(new Blob(f.parts),validateArchiveManifest);
 const row=m.records.find(r=>r.module==='appearance');
 const d=m.objects.find(d=>d.object_sha256===row.record_object);const parts=[];for await(const b of opened.objectChunks(d))parts.push(b);
 const envelope=JSON.parse(await new Blob(parts).text());
 assert.equal(envelope.data.basic_settings.replySequenceToolBudget,'0');assert.equal(envelope.data.basic_settings.apiKey,undefined);
 const parsed=decodeDeviceBasic(row,envelope);
 assert.equal(parsed.contextBudget,0);assert.equal(parsed.replySequenceTokenBudget,95000);
 const state={runControl:{},preferences:{theme:'old'},secret:'target'};
 const storage={read:()=>state,update:fn=>fn(state)};
 restoreDeviceBasic(storage,parsed);
 assert.equal(state.runControl.toolCallLimit,41);assert.equal(state.runControl.replySequenceToolBudget,0);assert.equal(state.preferences.theme,'old');assert.equal(state.secret,'target');
 assert.throws(()=>parseDeviceBasic({...envelope.data.basic_settings,replySequenceToolBudget:'999'}));
 assert.throws(()=>restoreDeviceBasic(storage,{...parsed,replySequenceToolBudget:999}));
 assert.equal(state.runControl.replySequenceToolBudget,0);
});

test('studio is contained only in the portable device record and old device settings still decode',async()=>{
 const {decodeDeviceBasic}=await import('../elementera-mcp/deploy-pages/public/core/archive-v2-device-settings.js');
 const {studioFromEnvelope}=await import('../elementera-mcp/deploy-pages/public/rest-box/studio-archive.mjs');
 const studio={version:1,layout:{version:1,rooms:{}},household:{version:1},room:'study',pets:false,reducedMotion:true,poseChoices:{}};
 const f=await fixture(),m=await collectArchiveV2({...f,applicationId:'com.elementeracoast.source',deviceBasic:{toolCallLimit:41},restStudio:studio});
 const files=entries(new Uint8Array(await new Blob(f.parts).arrayBuffer()));
 const r=m.records.find(r=>r.module==='appearance'),env=JSON.parse(decoder.decode(files.get('objects/'+r.record_object)));
 assert.deepEqual(studioFromEnvelope(r,env),studio);
 assert.equal(decodeDeviceBasic(r,env).toolCallLimit,41);
 assert.equal(m.records.filter(r=>r.module==='appearance').length,1);
 for(const row of m.records.filter(r=>r.module!=='appearance'))assert.equal(JSON.parse(decoder.decode(files.get('objects/'+row.record_object))).data.rest_studio,undefined);
});
