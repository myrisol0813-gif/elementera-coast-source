import assert from 'node:assert/strict';
import { D1Database } from './d1-helper.mjs';
import { routeApi } from '../functions/api-router.js';
import { listLibraryBooks, getLibraryBook, exportLibrary, LIBRARY_LIMITS } from '../functions/tidal-library.js';
import { beginLibraryImport, appendLibraryImport, finishLibraryImport, cancelLibraryImport } from '../functions/tidal-library-import.js';
import { uploadTidalBook } from '../elementera-mcp/deploy-pages/public/features/library-upload.js';

assert.equal(LIBRARY_LIMITS.max_chars,12000000);
assert.equal(LIBRARY_LIMITS.max_chapters,2048);
const db=new D1Database();
const chapters=Array.from({length:72},(_,i)=>({title:`第 ${i+1} 章`,body:['长河'.repeat(1500),'长河'.repeat(1500),'长河'.repeat(1500)].join('\n\n')}));
const total_chars=chapters.reduce((n,c)=>n+c.body.length,0);
const draft=await beginLibraryImport(db,{title:'示例长篇',format:'epub',chapters_count:chapters.length,total_chars});
assert.equal((await listLibraryBooks(db)).length,0,'half-imported book must stay hidden');
await assert.rejects(()=>getLibraryBook(db,draft.id),e=>e.type==='book_not_found');
await appendLibraryImport(db,draft.id,{start_index:0,chapters:chapters.slice(0,8)});
const retry=await appendLibraryImport(db,draft.id,{start_index:0,chapters:chapters.slice(0,8)});
assert.equal(retry.replayed,true,'identical batch is idempotent');
await assert.rejects(()=>appendLibraryImport(db,draft.id,{start_index:0,chapters:[{title:'changed',body:chapters[0].body}]}),
  e=>e.type==='import_conflict');
await assert.rejects(()=>finishLibraryImport(db,draft.id),e=>e.type==='import_incomplete');
for(let cursor=8;cursor<chapters.length;cursor+=8){
  await appendLibraryImport(db,draft.id,{start_index:cursor,chapters:chapters.slice(cursor,cursor+8)});
}
const book=await finishLibraryImport(db,draft.id);
assert.equal(book.chapters.length,72);
assert.equal((await listLibraryBooks(db)).length,1);
assert.equal((await exportLibrary(db)).books[0].chapters[71].body,chapters[71].body);

const cancelled=await beginLibraryImport(db,{title:'未完成',format:'txt',chapters_count:1,total_chars:100});
await cancelLibraryImport(db,cancelled.id);
assert.equal((await listLibraryBooks(db)).length,1);

await assert.rejects(()=>beginLibraryImport(db,{title:'太长',format:'txt',chapters_count:1,total_chars:LIBRARY_LIMITS.max_chars+1}),e=>e.type==='book_too_large');
const request = async (url,options={}) => {
  const response=await routeApi(new Request(`https://coast.test${url}`,{
    ...options,headers:{Origin:'https://coast.test','Content-Type':'application/json'},
  }),{COAST_CHAT_DB:db},{verified:true});
  const value=await response.json();
  if(!response.ok)throw new Error(value.error?.message||'request failed');
  return value;
};
const direct=await uploadTidalBook({
  base:'/api/library',requestJson:request,book:{
    title:'示例分卷',format:'epub',chapters:chapters.slice(0,11),
  },
});
assert.equal(direct.chapters.length,11);
assert.equal((await listLibraryBooks(db)).length,2);
const denied=await routeApi(new Request('https://coast.test/api/library/imports',{
 method:'POST',headers:{Origin:'https://coast.test','Content-Type':'application/json'},
 body:JSON.stringify({title:'unauthorized',format:'txt',chapters_count:1,total_chars:1}),
}),{COAST_CHAT_DB:db},null);
assert.equal(denied.status,401);
console.log('large-book import: ok (72 chapters, idempotency, incomplete rejection, cleanup, full export, UI upload, auth)');
