import assert from 'node:assert/strict';
import { D1Database } from './d1-helper.mjs';
import { createLibraryBook, listLibraryBooks, exportLibrary } from '../functions/tidal-library.js';
import { putLibraryCover, getLibraryCover, deleteLibraryCover, COVER_LIMIT_BYTES } from '../functions/tidal-library-cover.js';
import { routeApi } from '../functions/api-router.js';

const db=new D1Database();
const book=await createLibraryBook(db,{title:'示例长篇',format:'epub',chapters:[{title:'卷一',body:'河在流淌。'}]});
assert.equal((await listLibraryBooks(db))[0].has_cover,0);
const jpeg=Uint8Array.from([255,216,255,224,1,2,3,4,255,217]);
const inserted=await putLibraryCover(db,book.id,jpeg,'image/jpeg');
assert.equal(inserted.size,jpeg.length);
assert.equal((await listLibraryBooks(db))[0].has_cover,1);
assert.deepEqual(Array.from((await getLibraryCover(db,book.id)).bytes),Array.from(jpeg));
const archive=await exportLibrary(db);
assert.ok(archive.books[0].cover_data_url.startsWith('data:image/jpeg;base64,'));
assert.deepEqual(Array.from(Buffer.from(archive.books[0].cover_data_url.split(',')[1],'base64')),Array.from(jpeg));
await assert.rejects(()=>putLibraryCover(db,book.id,Uint8Array.from([1,2,3]),'image/png'),e=>e.type==='cover_format');
await assert.rejects(()=>putLibraryCover(db,book.id,new Uint8Array(COVER_LIMIT_BYTES+1),'image/jpeg'),e=>e.type==='cover_limit');
const route='/api/library/books/'+book.id+'/cover';
const request=(method,body,authorized=true)=>routeApi(new Request('https://coast.test'+route,{
  method,headers:{Origin:'https://coast.test','Content-Type':'image/jpeg'},body
}),{COAST_CHAT_DB:db},authorized?{verified:true}:null);
const read=await request('GET');
assert.equal(read.status,200);
assert.deepEqual(Array.from(new Uint8Array(await read.arrayBuffer())),Array.from(jpeg));
assert.equal((await request('GET',undefined,false)).status,401);
const update=Uint8Array.from([255,216,255,225,255,217]);
assert.equal((await request('PUT',update)).status,200);
assert.deepEqual(Array.from((await getLibraryCover(db,book.id)).bytes),Array.from(update));
assert.equal((await request('DELETE')).status,200);
assert.equal((await listLibraryBooks(db))[0].has_cover,0);
console.log('library covers: owner-only save/read/delete, replace, BLOB export, size and format guards');
