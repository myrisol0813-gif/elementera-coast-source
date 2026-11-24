// V2 transport only. No import publication is implemented here.
import { requestJson } from './api.js';
const base='/api/archive/v2';
const segment=(value)=>encodeURIComponent(value);
const sessions=base+'/sessions';
const objects=(id)=>sessions+'/'+segment(id)+'/objects';
const object=(id,hash)=>objects(id)+'/'+segment(hash);
export const archiveV2Transport=Object.freeze({
  capabilities:()=>requestJson(base),
  recordPage:(module,cursor='',limit=20)=>requestJson(base+'/records/'+segment(module)+'?'+new URLSearchParams({cursor,limit})),
  detailPage:(kind,cursor='',limit=20)=>requestJson(base+'/details/'+segment(kind)+'?'+new URLSearchParams({cursor,limit})),
  chat:id=>requestJson(base+'/records/chat/'+segment(id)),
  voice:id=>requestJson(base+'/voice/'+segment(id)),
  libraryCover:id=>requestJson(base+'/library-cover/'+segment(id)),
  preflight:(id,manifest)=>requestJson(sessions+'/'+segment(id)+'/preflight',{method:'POST',body:JSON.stringify(manifest)}),
  createSession:()=>requestJson(sessions,{method:'POST'}),
  listSessions:()=>requestJson(sessions),
  cancelSession:id=>requestJson(sessions+'/'+segment(id),{method:'DELETE'}),
  registerObject:(id,descriptor)=>requestJson(objects(id),{method:'POST',body:JSON.stringify(descriptor)}),
  status:(id,hash)=>requestJson(object(id,hash)),
  putChunk:(id,hash,index,bytes)=>{
    if(!Number.isSafeInteger(index)||index<0||!(bytes instanceof Uint8Array)||bytes.length>1048576)throw Error('invalid archive chunk');
    return requestJson(object(id,hash)+'/chunks/'+index,{method:'PUT',body:bytes,headers:{'Content-Type':'application/octet-stream'}});
  },
  attachmentPage:(cursor='',limit=50)=>requestJson(base+'/inventory/attachments?'+new URLSearchParams({cursor,limit})),
  dogtalkPage:(kind='snapshots',cursor='',limit=50)=>requestJson(base+'/inventory/dogtalk?'+new URLSearchParams({kind,cursor,limit})),
  attachment:(conversation,id)=>requestJson(base+'/attachments/'+segment(conversation)+'/'+segment(id)),
  restoreRecord:(id,manifest,module,record,confirm)=>requestJson(sessions+'/'+segment(id)+'/record-restore/'+segment(module)+'/'+segment(record),{method:'POST',body:JSON.stringify({manifest,confirm})}),
  restoreBook:(id,manifest,book,confirm)=>requestJson(sessions+'/'+segment(id)+'/book-restore/'+segment(book),{method:'POST',body:JSON.stringify({manifest,confirm})}),
  restoreChat:(id,manifest,conversation,confirm)=>requestJson(sessions+'/'+segment(id)+'/chat-restore/'+segment(conversation),{method:'POST',body:JSON.stringify({manifest,confirm})}),
  validateManifest:manifest=>requestJson(base+'/manifest/validate',{method:'POST',body:JSON.stringify(manifest)}),
  attachmentChunk:(conversation,id,descriptor,index)=>readChunk('/attachments/'+segment(conversation)+'/'+segment(id),descriptor,index),
  voiceChunk:(id,descriptor,index)=>readChunk('/voice/'+segment(id),descriptor,index),
  libraryCoverChunk:(id,descriptor,index)=>readChunk('/library-cover/'+segment(id),descriptor,index)
});
async function readChunk(prefix,descriptor,index){
    if(!Number.isSafeInteger(index)||index<0||index>=descriptor.chunks.length)throw Error('invalid archive chunk index');
    const path=base+prefix+'/chunks/'+index+'?'+new URLSearchParams({object_sha256:descriptor.object_sha256});
    const response=await fetch(path,{credentials:'same-origin',cache:'no-store'});
    if(!response.ok)throw Error('attachment chunk request failed: '+response.status);
    const expected=Math.min(1048576,descriptor.size-index*1048576);
    const reader=response.body?.getReader();if(!reader)throw Error('missing attachment chunk');
    const bytes=new Uint8Array(expected);let offset=0;
    try{for(;;){const {done,value}=await reader.read();if(done)break;if(offset+value.length>expected){await reader.cancel();throw Error('oversized attachment chunk');}bytes.set(value,offset);offset+=value.length;}}
    finally{reader.releaseLock();}
    const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
    if(offset!==expected||digest!==descriptor.chunks[index])throw Error('attachment chunk integrity mismatch');
    return bytes;
  }
