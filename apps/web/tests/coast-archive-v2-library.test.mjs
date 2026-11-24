import test from 'node:test';
import assert from 'node:assert/strict';
import { D1Database } from './d1-helper.mjs';
import { createLibraryBook,writeLibraryNote,updateLibraryProgress } from '../functions/tidal-library.js';
import { putLibraryCover,getLibraryCover } from '../functions/tidal-library-cover.js';
import { archiveDetailPage,readArchiveLibraryCover } from '../functions/coast-archive-v2-details.js';
import { MODULES,encodeRecordObject } from '../functions/coast-archive-v2-manifest.js';
import { digestBytes } from '../functions/coast-archive-v2-chunks.js';
import { createArchiveSession,registerArchiveObject,putArchiveChunk } from '../functions/coast-archive-v2-stage.js';
import { restoreArchiveBook } from '../functions/coast-archive-v2-restore-library.js';
test('book restore retains original annotation offsets, reading history and cover, including edition mapping',async()=>{
 const src=new D1Database(),dst=new D1Database();
 const book=await createLibraryBook(src,{title:'书',format:'txt',chapters:[{title:'章',body:'原始文字一二三'}]});
 await writeLibraryNote(src,{book_id:book.id,kind:'highlight',chapter_index:0,paragraph_index:0,start_offset:1,end_offset:3},{author:'owner'});
 await updateLibraryProgress(src,{book_id:book.id,chapter_index:0,paragraph_index:0},{author:'owner'});
 const cover=new Uint8Array([137,80,78,71,13,10,26,10,1,2,3]);await putLibraryCover(src,book.id,cover,'image/png');
 const kinds={library_books:['id'],library_chapters:['book_id','chapter_index'],library_notes:['id'],library_progress:['book_id','author'],library_reading_logs:['book_id','author','day'],library_covers:['book_id']};
 const key=async(kind,values)=>kind+':'+await digestBytes(new TextEncoder().encode(JSON.stringify(values)));
 const root='library/'+await key('library_books',[book.id]);const objects=[],records=[];
 for(const [kind,keys] of Object.entries(kinds))for(const row of (await archiveDetailPage(src,kind)).items){
   const id=await key(kind,keys.map(k=>row[k]));const media=[];
   if(kind==='library_covers'){const c=await readArchiveLibraryCover(src,book.id);objects.push(c);media.push(c.descriptor.object_sha256);}
   const obj=await encodeRecordObject({kind,data:row});objects.push(obj);
   records.push({module:'library',id,record_object:obj.descriptor.object_sha256,media_objects:media,dependencies:kind==='library_books'?[]:[root]});
 }
 const manifest={format:'elementera-coast-archive',version:2,workspace:'backend',application_id:'com.elementeracoast.source',exported_at:'2026-01-01T00:00:00Z',modules:MODULES.map(module=>({module,coverage:module==='library'?'partial':'unavailable',count:module==='library'?records.length:0})),records,objects:objects.map(o=>o.descriptor)};
 const session=await createArchiveSession(dst);
 for(const o of objects){await registerArchiveObject(dst,session.id,o.descriptor);for(let i=0;i<o.chunks.length;i++)await putArchiveChunk(dst,session.id,o.descriptor.object_sha256,i,o.chunks[i]);}
 assert.equal((await restoreArchiveBook(dst,session.id,manifest,book.id)).committed,false);
 assert.equal((await archiveDetailPage(dst,'library_books')).items.length,0);
 assert.equal((await restoreArchiveBook(dst,session.id,manifest,book.id,true)).committed,true);
 for(const kind of Object.keys(kinds))assert.deepEqual((await archiveDetailPage(dst,kind)).items,(await archiveDetailPage(src,kind)).items);
 assert.deepEqual([...(await getLibraryCover(dst,book.id)).bytes],[...cover]);
 await assert.rejects(()=>restoreArchiveBook(dst,session.id,manifest,book.id,true),/already exists/);
 const second=new D1Database(),localSession=await createArchiveSession(second);
 for(const o of objects){await registerArchiveObject(second,localSession.id,o.descriptor);for(let i=0;i<o.chunks.length;i++)await putArchiveChunk(second,localSession.id,o.descriptor.object_sha256,i,o.chunks[i]);}
 const local={...manifest,workspace:'local'};
 assert.equal((await restoreArchiveBook(second,localSession.id,local,book.id,false)).committed,false);
 assert.equal((await archiveDetailPage(second,'library_books')).items.length,0);
 assert.equal((await restoreArchiveBook(second,localSession.id,local,book.id,true)).committed,true);
 for(const kind of Object.keys(kinds))assert.deepEqual((await archiveDetailPage(second,kind)).items,(await archiveDetailPage(src,kind)).items);
 assert.deepEqual([...(await getLibraryCover(second,book.id)).bytes],[...cover]);
});
