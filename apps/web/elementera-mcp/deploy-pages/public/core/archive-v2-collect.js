// Collector uses the authenticated V2 transport. It never claims snapshot
// completeness across concurrent edits; unimplemented modules stay unavailable.
import { archiveV2Transport } from './archive-v2-transport.js';
import { ArchiveV2ZipWriter } from './archive-v2-zip.js';
import {captureDeviceBasic,DEVICE_SETTINGS_ID} from './archive-v2-device-settings.js';
const utf8=new TextEncoder(),CHUNK=1048576;
const sha=async b=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(x=>x.toString(16).padStart(2,'0')).join('');
const check=(ok,msg)=>{if(!ok)throw Error(msg);};
const fingerprint=(size,chunks)=>sha(utf8.encode('coast-object-v2\n'+size+'\n'+chunks.join('\n')));
async function* slices(bytes){for(let i=0;i<bytes.length;i+=CHUNK)yield bytes.subarray(i,i+CHUNK);}
async function describe(bytes){const chunks=[];for await(const b of slices(bytes))chunks.push(await sha(b));return {size:bytes.length,chunks,object_sha256:await fingerprint(bytes.length,chunks)};}
async function* pages(read){
  let cursor='',seen=new Set();
  do{const p=await read(cursor);check(Array.isArray(p.items),'archive page missing');yield* p.items;
    cursor=p.next_cursor??null;if(cursor!==null){check(typeof cursor==='string'&&!seen.has(cursor),'archive cursor repeated');seen.add(cursor);}
  }while(cursor!==null);
}
const detailKeys={
  thinking_soil:['conversation_id'],thinking_soil_history:['conversation_id','assistant_message_id'],
  daily_likes:['moment_id','actor'],library_chapters:['book_id','chapter_index'],library_progress:['book_id','author'],
  library_reading_logs:['book_id','author','day'],library_covers:['book_id'],vault_media_labels:['source_key']
};
const detailId=async(kind,row)=>kind+':'+await sha(utf8.encode(JSON.stringify((detailKeys[kind]||['id']).map(k=>{check(row[k]!=null,'missing detail identity: '+kind);return row[k];}))));
const linkChat=r=>r.conversation_id?['chat/'+r.conversation_id]:[];
export async function collectArchiveV2({sink,applicationId,transport=archiveV2Transport,onProgress=()=>{},deviceBasic=null}){
  const zip=new ArchiveV2ZipWriter(sink);
  try{
    const caps=await transport.capabilities();
    check(Array.isArray(caps.manifest_modules)&&Array.isArray(caps.record_modules)&&caps.detail_modules,'invalid archive capabilities');
    const manifest={format:'elementera-coast-archive',version:2,workspace:'backend',application_id:applicationId,exported_at:new Date().toISOString(),modules:caps.manifest_modules.map(module=>({module,coverage:'unavailable',count:0})),records:[],objects:[]};
    const coverage=new Map(manifest.modules.map(m=>[m.module,m])),objects=new Map(),records=new Set();
    const limit=Math.min(caps.limits?.sessionBytes??3*1024**3,3*1024**3),maxObjects=Math.min(caps.limits?.objects??8192,8192);
    let bytes=0;
    function available(module){check(coverage.has(module),'unknown archive module');coverage.get(module).coverage='partial';}
    async function saveObject(d,read){
      check(Number.isSafeInteger(d.size)&&d.size>=0&&d.size<=limit&&Array.isArray(d.chunks)&&d.chunks.length===Math.ceil(d.size/CHUNK)&&d.chunks.every(h=>/^[0-9a-f]{64}$/.test(h))&&await fingerprint(d.size,d.chunks)===d.object_sha256,'invalid object descriptor');
      if(objects.has(d.object_sha256))return d.object_sha256;
      check(bytes+d.size<=limit&&objects.size<maxObjects,'archive exceeds configured capacity');
      async function* checked(){let i=0;for await(const b of read()){check(i<d.chunks.length&&b.length===Math.min(CHUNK,d.size-i*CHUNK)&&await sha(b)===d.chunks[i],'archive original changed or corrupt');i++;yield b;}check(i===d.chunks.length,'archive original incomplete');}
      await zip.entry('objects/'+d.object_sha256,d.size,checked());
      objects.set(d.object_sha256,d);manifest.objects.push(d);bytes+=d.size;return d.object_sha256;
    }
    async function record(module,id,kind,data,dependencies=[],media=null){
      const key=module+'/'+id;check(typeof id==='string'&&/^[A-Za-z0-9_.:-]{1,200}$/.test(id)&&!records.has(key),'duplicate or invalid archive record');
      available(module);const media_objects=[];
      if(media)media_objects.push(await saveObject(media.descriptor,media.read));
      const raw=utf8.encode(JSON.stringify({kind,data}));const d=await describe(raw);
      const record_object=await saveObject(d,()=>slices(raw));
      manifest.records.push({module,id,record_object,media_objects,dependencies:[...new Set(dependencies)]});records.add(key);coverage.get(module).count++;
      onProgress({module,records:manifest.records.length,bytes});
    }
    const mediaReader=(d,read)=>({descriptor:d,read:async function*(){for(let i=0;i<d.chunks.length;i++)yield await read(i);}});
    for(const module of caps.record_modules){
      available(module);
      for await(const row of pages(c=>transport.recordPage(module,c))){
        if(module==='chat'){const {conversation,history_json,history_updated_at}=await transport.chat(row.id);await record(module,row.id,'chat',{conversation,history_json,history_updated_at});}
        else if(module==='voice'){const {metadata,descriptor}=await transport.voice(row.id);await record(module,row.id,'voice',metadata,linkChat(metadata),mediaReader(descriptor,i=>transport.voiceChunk(row.id,descriptor,i)));}
        else await record(module,row.id,module,row,linkChat(row));
      }
    }
    available('attachments');
    for await(const row of pages(c=>transport.attachmentPage(c))){const {metadata,descriptor}=await transport.attachment(row.conversation_id,row.id);await record('attachments',row.id,'attachment',metadata,linkChat(metadata),mediaReader(descriptor,i=>transport.attachmentChunk(row.conversation_id,row.id,descriptor,i)));}
    for(const kind of ['records','snapshots']){
      const module='dogtalk_'+kind;available(module);
      for await(const row of pages(c=>transport.dogtalkPage(kind,c)))await record(module,row.id,module,row,[...linkChat(row),...(kind==='snapshots'?['dogtalk_records/'+row.dogtalk_id]:[])]);
    }
    for(const [kind,module] of Object.entries(caps.detail_modules)){
      available(module);
      for await(const row of pages(c=>transport.detailPage(kind,c))){
        const deps=linkChat(row);
        if(kind==='vault_stickers')deps.push('attachments/'+row.attachment_id);
        if(kind.startsWith('library_')&&kind!=='library_books')deps.push('library/'+await detailId('library_books',{id:row.book_id}));
        if(kind==='daily_comments'||kind==='daily_likes')deps.push('daily/'+await detailId('daily_moments',{id:row.moment_id}));
        const key=await detailId(kind,row);
        if(kind==='library_covers'){const {metadata,descriptor}=await transport.libraryCover(row.book_id);await record(module,key,kind,metadata,deps,mediaReader(descriptor,i=>transport.libraryCoverChunk(row.book_id,descriptor,i)));}
        else await record(module,key,kind,row,deps);
      }
    }
    if(deviceBasic!==null)await record('appearance',DEVICE_SETTINGS_ID,'device_basic_settings',{basic_settings:captureDeviceBasic(deviceBasic)});
    // Fail closed rather than silently dropping dependencies that were not collected.
    check(manifest.records.every(r=>r.dependencies.every(d=>records.has(d))),'archive contains an uncollected dependency');
    await transport.validateManifest(manifest);
    const raw=utf8.encode(JSON.stringify(manifest));await zip.entry('manifest.json',raw.length,slices(raw));await zip.finish();
    return manifest;
  }catch(e){await zip.abort().catch(()=>{});throw e;}
}
