import { ensureLibrarySchema,LIBRARY_LIMITS } from './tidal-library.js';
import { COVER_LIMIT_BYTES } from './tidal-library-cover.js';
import { stageVerifiedObject,digestBytes } from './coast-archive-v2-chunks.js';
import { validateArchiveManifest } from './coast-archive-v2-manifest.js';
import { readStagedArchiveChunks } from './coast-archive-v2-stage.js';
import { ensureChatSchema } from './chat-store.js';
const check=(ok,msg)=>{if(!ok)throw Object.assign(Error(msg),{status:409});};
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(v);
const integer=v=>Number.isSafeInteger(v)&&v>=0;
const text=(v,n)=>typeof v==='string'&&v.length<=n;
const nonempty=(v,n)=>text(v,n)&&v.trim().length>0;
const specs={
 library_books:['coast_library_books','id,title,format,created_at,updated_at',['id']],
 library_chapters:['coast_library_chapters','book_id,chapter_index,title,body',['book_id','chapter_index']],
 library_notes:['coast_library_notes','id,book_id,chapter_index,paragraph_index,quote,kind,body,author,source,conversation_id,source_turn_id,created_at,updated_at,start_offset,end_offset',['id']],
 library_progress:['coast_library_progress','book_id,author,chapter_index,paragraph_index,updated_at',['book_id','author']],
 library_reading_logs:['coast_library_reading_logs','book_id,author,day,chapter_index,paragraph_index,updated_at',['book_id','author','day']],
 library_covers:['coast_library_covers','book_id,mime,size,updated_at',['book_id']]
};
async function identity(kind,values){return kind+':'+await digestBytes(new TextEncoder().encode(JSON.stringify(values)));}
function author(value){
 check(['owner','assistant'].includes(value),'invalid portable library author');return value;
}
export async function restoreArchiveBook(db,sessionId,manifest,bookId,confirm=false){
 await validateArchiveManifest(manifest);
 check(['backend','local'].includes(manifest.workspace)&&id(bookId),'invalid library archive source');
 const rootKey='library/'+await identity('library_books',[bookId]);
 const group=manifest.records.filter(r=>r.module==='library'&&('library/'+r.id===rootKey||r.dependencies.includes(rootKey)));
 check(group.length>0&&group.length<=89,'book exceeds current 89-record transaction limit');
 const objects=new Map(manifest.objects.map(o=>[o.object_sha256,o]));
 const used=new Set(group.flatMap(r=>[r.record_object,...r.media_objects]));
 check([...used].reduce((n,h)=>n+objects.get(h).size,0)<=16*1024*1024,'book exceeds current 16 MiB transaction limit');
 const read=async(d,max)=>{
   check(d&&d.size<=max,'library archive object too large');
   const bytes=new Uint8Array(d.size);let at=0;
   await stageVerifiedObject(d,readStagedArchiveChunks(db,sessionId,d.object_sha256),async b=>{bytes.set(b,at);at+=b.length;},{maxBytes:max});return bytes;
 };
 const rows=[];
 for(const r of group){
   const raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await read(objects.get(r.record_object),1800000)));
   check(raw&&Object.keys(raw).length===2&&Object.hasOwn(specs,raw.kind)&&raw.data&&typeof raw.data==='object'&&!Array.isArray(raw.data),'invalid library record');
   const spec=specs[raw.kind],fields=spec[1].split(','),v=raw.data;
   check(Object.keys(v).length===fields.length&&fields.every(k=>Object.hasOwn(v,k))&&Object.values(v).every(x=>x===null||typeof x==='string'||Number.isSafeInteger(x)),'library schema mismatch');
   check(r.id===await identity(raw.kind,spec[2].map(k=>v[k]))&&(raw.kind==='library_books'?v.id===bookId:v.book_id===bookId),'library identity mismatch');
   check(raw.kind==='library_books'?r.dependencies.length===0:r.dependencies.includes(rootKey)&&r.dependencies.every(k=>k===rootKey||k==='chat/'+v.conversation_id),'invalid library dependency');
   check(raw.kind==='library_covers'?r.media_objects.length===1:r.media_objects.length===0,'invalid library media link');
   rows.push({r,kind:raw.kind,v,fields,table:spec[0]});
 }
 const roots=rows.filter(x=>x.kind==='library_books');check(roots.length===1,'book root missing');
 const root=roots[0].v;
 check(nonempty(root.title,LIBRARY_LIMITS.title_chars)&&['epub','txt'].includes(root.format)&&integer(root.created_at)&&integer(root.updated_at),'invalid book metadata');
 const chapters=rows.filter(x=>x.kind==='library_chapters').sort((a,b)=>a.v.chapter_index-b.v.chapter_index);
 check(chapters.length>0&&chapters.length<=LIBRARY_LIMITS.max_chapters&&chapters.every((x,i)=>x.v.chapter_index===i&&nonempty(x.v.title,LIBRARY_LIMITS.title_chars)&&nonempty(x.v.body,LIBRARY_LIMITS.chapter_chars)),'book chapters missing or invalid');
 const paras=chapters.map(x=>x.v.body.split(/\n\s*\n/).map(p=>p.trim()).filter(Boolean));
 check(chapters.reduce((n,x)=>n+x.v.body.length,0)<=LIBRARY_LIMITS.max_chars&&paras.every(ps=>ps.every(p=>p.length<=LIBRARY_LIMITS.paragraph_chars)),'book text exceeds limits');
 await ensureLibrarySchema(db);await ensureChatSchema(db);
 check(!await db.prepare('SELECT id FROM coast_library_books WHERE id=?').bind(bookId).first(),'book already exists; never overwrite');
 for(const table of ['coast_library_chapters','coast_library_notes','coast_library_progress','coast_library_reading_logs','coast_library_covers'])
   check(!await db.prepare('SELECT book_id FROM '+table+' WHERE book_id=? LIMIT 1').bind(bookId).first(),'orphan book records already exist');
 const count=await db.prepare('SELECT COUNT(*) AS n FROM coast_library_books').first();check(count.n<LIBRARY_LIMITS.max_books,'library capacity reached');
 const pos=v=>integer(v.chapter_index)&&integer(v.paragraph_index)&&typeof paras[v.chapter_index]?.[v.paragraph_index]==='string';
 const insert=(table,fields,v)=>db.prepare('INSERT INTO '+table+' ('+fields.join(',')+') VALUES ('+fields.map(()=>'?').join(',')+')').bind(...fields.map(k=>v[k]));
 const statements=[insert(roots[0].table,roots[0].fields,root)];
 for(const x of [...chapters,...rows.filter(x=>!['library_books','library_chapters'].includes(x.kind))]){
   const {kind,v,fields,table,r}=x;
   if(kind==='library_notes'){
     check(id(v.id)&&['annotation','reflection','highlight'].includes(v.kind)&&text(v.body,LIBRARY_LIMITS.note_chars)&&integer(v.created_at)&&integer(v.updated_at)&&typeof v.source==='string','invalid library note');
     if(v.kind==='reflection')check(v.chapter_index===null&&v.paragraph_index===null&&v.quote===null&&v.start_offset===null&&v.end_offset===null,'invalid reflection anchor');
     else{
       check(pos(v),'note paragraph missing');const paragraph=paras[v.chapter_index][v.paragraph_index];
       if(v.start_offset===null&&v.end_offset===null)check(v.kind!=='highlight'&&v.quote===paragraph,'note quote changed');
       else check(integer(v.start_offset)&&integer(v.end_offset)&&v.end_offset>v.start_offset&&v.end_offset<=paragraph.length&&v.quote===paragraph.slice(v.start_offset,v.end_offset),'note range changed');
     }
     check(v.kind==='highlight'?v.body==='':v.body.trim().length>0,'invalid note body');
     if(v.conversation_id!==null){
       check(id(v.conversation_id)&&r.dependencies.includes('chat/'+v.conversation_id),'note chat dependency missing');
       const chat=await db.prepare("SELECT s.state_json FROM conversations c JOIN conversation_states s ON s.conversation_id=c.id WHERE c.id=? AND c.user_id='owner' AND c.deleted_at IS NULL AND c.conversation_kind='chat'").bind(v.conversation_id).first();
       check(chat&&(!v.source_turn_id||JSON.parse(chat.state_json).turns.some(t=>t.id===v.source_turn_id)),'restore linked chat before book');
     }else check(v.source_turn_id===null,'note turn has no conversation');
     v.author=author(v.author);
   }else if(kind==='library_progress'||kind==='library_reading_logs'){
     check(pos(v)&&integer(v.updated_at),'invalid reading position');
     if(kind==='library_reading_logs')check(typeof v.day==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v.day)&&Number.isFinite(Date.parse(v.day))&&new Date(v.day).toISOString().slice(0,10)===v.day,'invalid reading date');
     v.author=author(v.author);
   }else if(kind==='library_covers'){
     const d=objects.get(r.media_objects[0]);check(v.size===d.size&&v.size>0&&v.size<=COVER_LIMIT_BYTES&&integer(v.updated_at),'invalid cover size');
     const data=await read(d,COVER_LIMIT_BYTES),sig={'image/png':[137,80,78,71,13,10,26,10],'image/jpeg':[255,216,255]}[v.mime];
     check(sig&&sig.every((b,i)=>data[i]===b),'invalid cover signature');
     statements.push(insert(table,[...fields,'data'],{...v,data}));continue;
   }
   statements.push(insert(table,fields,v));
 }
 check(statements.length<=90,'book exceeds atomic transaction budget');
 if(confirm===true)await db.batch(statements);
 return {book_id:bookId,chapters:chapters.length,notes:rows.filter(x=>x.kind==='library_notes').length,statement_count:statements.length,can_commit:true,committed:confirm===true,scope:'book_only'};
}
