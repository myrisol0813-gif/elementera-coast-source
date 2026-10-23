import { LibraryError, LIBRARY_LIMITS, listLibraryBooks, createLibraryBook, getLibraryBook,
  readLibraryChapter, readFullLibraryChapter, updateLibraryProgress, listLibraryNotes, writeLibraryNote, editLibraryNote, deleteLibraryNote,
  deleteLibraryBook } from './tidal-library.js';
import { beginLibraryImport, appendLibraryImport, finishLibraryImport, cancelLibraryImport } from './tidal-library-import.js';
import { COVER_LIMIT_BYTES, putLibraryCover, getLibraryCover, deleteLibraryCover } from './tidal-library-cover.js';
import { OwnerAccessError, requireOwnerSession } from './owner-access.js';
import { apiError, json, methodNotAllowed, readJson, requestBodyError, unexpectedApiError } from './http.js';

const BASE='/api/library';
export function isLibraryApiPath(path) { return path===BASE || path.startsWith(`${BASE}/`); }
async function route(request,env,session) {
  requireOwnerSession(session);
  const url=new URL(request.url), segments=url.pathname.slice(BASE.length).split('/').filter(Boolean);
  const db=env.COAST_CHAT_DB;
  if(segments.length===0 && request.method==='GET')return json({ok:true,limits:LIBRARY_LIMITS});
  if(segments[0]==='imports' && segments.length===1) {
    if(request.method!=='POST')return methodNotAllowed('POST');
    return json({ok:true,import:await beginLibraryImport(db,await readJson(request,16*1024)),limits:LIBRARY_LIMITS},201);
  }
  if(segments[0]==='imports' && segments.length===2 && request.method==='DELETE') {
    return json({ok:true,...await cancelLibraryImport(db,segments[1])});
  }
  if(segments[0]==='imports' && segments.length===3 && segments[2]==='chapters') {
    if(request.method!=='POST')return methodNotAllowed('POST');
    return json({ok:true,progress:await appendLibraryImport(db,segments[1],
      await readJson(request,LIBRARY_LIMITS.import_batch_bytes))});
  }
  if(segments[0]==='imports' && segments.length===3 && segments[2]==='finish') {
    if(request.method!=='POST')return methodNotAllowed('POST');
    return json({ok:true,book:await finishLibraryImport(db,segments[1])});
  }
  if(segments[0]==='books' && segments.length===1) {
    if(request.method==='GET')return json({ok:true,books:await listLibraryBooks(db),limits:LIBRARY_LIMITS});
    if(request.method==='POST')return json({ok:true,book:await createLibraryBook(db,await readJson(request,2*1024*1024)),limits:LIBRARY_LIMITS},201);
    return methodNotAllowed('GET, POST');
  }
  if(segments[0]==='books' && segments.length===3 && segments[2]==='cover') {
    const id=segments[1];
    if(request.method==='GET'){
      const {mime,bytes}=await getLibraryCover(db,id);
      return new Response(bytes,{headers:{
        'Content-Type':mime,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',
      }});
    }
    if(request.method==='PUT'){
      const mime=(request.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
      const length=Number(request.headers.get('content-length')||0);
      if(length>COVER_LIMIT_BYTES)throw new LibraryError('cover_limit','封面最大 600 KB，请压缩后再上传。');
      const bytes=new Uint8Array(await request.arrayBuffer());
      return json({ok:true,cover:await putLibraryCover(db,id,bytes,mime)});
    }
    if(request.method==='DELETE')return json({ok:true,cover:await deleteLibraryCover(db,id)});
    return methodNotAllowed('GET, PUT, DELETE');
  }
  if(segments[0]==='books' && segments.length===2) {
    const id=segments[1];
    if(request.method==='GET')return json({ok:true,book:await getLibraryBook(db,id)});
    if(request.method==='DELETE')return json({ok:true,...await deleteLibraryBook(db,id)});
    return methodNotAllowed('GET, DELETE');
  }
  if(segments[0]==='books' && segments.length===5 && segments[2]==='chapters' && segments[4]==='text') {
    if(request.method!=='GET')return methodNotAllowed('GET');
    return json({ok:true,chapter:await readFullLibraryChapter(db,{book_id:segments[1],chapter_index:Number(segments[3])})});
  }
  if(segments[0]==='books' && segments.length===4 && segments[2]==='chapters') {
    if(request.method!=='GET')return methodNotAllowed('GET');
    return json({ok:true,chapter:await readLibraryChapter(db,{
      book_id:segments[1],chapter_index:Number(segments[3]),
      start_paragraph:Number(url.searchParams.get('start')||0),
      limit:Number(url.searchParams.get('limit')||LIBRARY_LIMITS.page_paragraphs),
    })});
  }
  if(segments[0]==='books' && segments.length===3 && segments[2]==='progress') {
    if(request.method!=='POST')return methodNotAllowed('POST');
    const value=await readJson(request,4*1024);
    return json({ok:true,progress:await updateLibraryProgress(db,{book_id:segments[1],chapter_index:value.chapter_index,paragraph_index:value.paragraph_index},{author:'owner'})});
  }
  if(segments[0]==='books' && segments.length===3 && segments[2]==='notes') {
    if(request.method==='GET')return json({ok:true,notes:await listLibraryNotes(db,{book_id:segments[1]})});
    if(request.method==='POST')return json({ok:true,note:await writeLibraryNote(db,{...(await readJson(request,24*1024)),book_id:segments[1]},{author:'owner'})},201);
    return methodNotAllowed('GET, POST');
  }
  if(segments[0]==='notes' && segments.length===2) {
    if(request.method==='PATCH')return json({ok:true,note:await editLibraryNote(db,segments[1],await readJson(request,24*1024),{author:'owner'})});
    if(request.method==='DELETE')return json({ok:true,...await deleteLibraryNote(db,segments[1],{author:'owner'})});
    return methodNotAllowed('PATCH, DELETE');
  }
  return apiError('not_found','Not found.',404);
}
export async function routeLibraryApi(request,env,session) {
  try { return await route(request,env,session); }
  catch(error) {
    if(error instanceof LibraryError || error instanceof OwnerAccessError) return apiError(error.type,error.message,error.status);
    if(['invalid_json','body_too_large'].includes(error?.message)){
      const mapped=requestBodyError(error,{invalidMessage:'书房请求不是有效 JSON。',tooLargeMessage:`书房单次上传不得超过 ${LIBRARY_LIMITS.import_batch_bytes} 字节；请缩小批次。`});
      return apiError(mapped.type,mapped.message,mapped.status);
    }
    return unexpectedApiError('tidal-library',error,'library_failed','书房暂时无法完成操作');
  }
}
