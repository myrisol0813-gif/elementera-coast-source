import { ensureLibrarySchema, LIBRARY_LIMITS, LibraryError, getLibraryBook } from './tidal-library.js';

const first = (db,sql,args=[]) => db.prepare(sql).bind(...args).first();
const all = async (db,sql,args=[]) => (await db.prepare(sql).bind(...args).all())?.results || [];
const run = (db,sql,args=[]) => db.prepare(sql).bind(...args).run();
function validTitle(value) {
  const name=String(value||'').trim();
  if(!name || name.length>LIBRARY_LIMITS.title_chars)throw new LibraryError('invalid_title','书名不能为空，最多 160 字。');
  return name;
}
function validateChapters(chapters) {
  if(!Array.isArray(chapters)||!chapters.length||chapters.length>LIBRARY_LIMITS.import_batch_chapters) {
    throw new LibraryError('import_batch_limit',`每批需传 1—${LIBRARY_LIMITS.import_batch_chapters} 章。`);
  }
  let chars=0;
  const prepared=chapters.map(item=>{
    const title=validTitle(item?.title);
    const body=String(item?.body||'').trim();
    if(!body||body.length>LIBRARY_LIMITS.chapter_chars)throw new LibraryError('chapter_too_large',`每章正文最多 ${LIBRARY_LIMITS.chapter_chars} 字。`);
    if(body.split(/\n\s*\n/).some(p=>p.trim().length>LIBRARY_LIMITS.paragraph_chars)){
      throw new LibraryError('paragraph_too_large',`每段最多 ${LIBRARY_LIMITS.paragraph_chars} 字。`);
    }
    chars+=body.length;
    return {title,body};
  });
  if(chars>LIBRARY_LIMITS.import_batch_chars)throw new LibraryError('import_batch_limit',`每批正文最多 ${LIBRARY_LIMITS.import_batch_chars} 字。`);
  return {prepared,chars};
}
async function draft(db,id) {
  await ensureLibrarySchema(db);
  const row=await first(db,'SELECT * FROM coast_library_books WHERE id=?',[id]);
  if(!row||row.import_state!=='importing')throw new LibraryError('import_not_found','没有这本待导入的书，请重新选择文件。',404);
  return row;
}
export async function beginLibraryImport(db,input) {
  await ensureLibrarySchema(db);
  const title=validTitle(input?.title),format=String(input?.format||'').toLowerCase();
  if(!['txt','epub'].includes(format))throw new LibraryError('unsupported_format','只支持 TXT 与 EPUB。');
  const expected=Number(input?.chapters_count),total=Number(input?.total_chars);
  if(!Number.isInteger(expected)||expected<1||expected>LIBRARY_LIMITS.max_chapters) {
    throw new LibraryError('chapter_limit',`最多支持 ${LIBRARY_LIMITS.max_chapters} 章。`);
  }
  if(!Number.isInteger(total)||total<1||total>LIBRARY_LIMITS.max_chars) {
    throw new LibraryError('book_too_large',`单本正文最多 ${LIBRARY_LIMITS.max_chars} 字。`);
  }
  // Abandoned uploads are invisible, but should not occupy book slots forever.
  // Only stale drafts older than one day are reclaimed; finished books are untouched.
  const staleBefore=Date.now()-24*60*60*1000;
  const abandoned=await all(db,"SELECT id FROM coast_library_books WHERE import_state='importing' AND updated_at<?",[staleBefore]);
  if(abandoned.length){
    const tasks=[];
    for(const item of abandoned){
      tasks.push(db.prepare('DELETE FROM coast_library_chapters WHERE book_id=?').bind(item.id));
      tasks.push(db.prepare("DELETE FROM coast_library_books WHERE id=? AND import_state='importing' AND updated_at<?").bind(item.id,staleBefore));
    }
    await db.batch(tasks);
  }
  const count=await first(db,'SELECT COUNT(*) AS count FROM coast_library_books');
  if(count.count>=LIBRARY_LIMITS.max_books)throw new LibraryError('book_limit',`书架最多 ${LIBRARY_LIMITS.max_books} 本。`);
  const id=`book_${crypto.randomUUID()}`,now=Date.now();
  await run(db,`INSERT INTO coast_library_books
    (id,title,format,created_at,updated_at,import_state,import_expected_chapters,import_expected_chars,import_next_index,imported_chars)
    VALUES (?,?,?,?,?,'importing',?,?,0,0)`,[id,title,format,now,now,expected,total]);
  return {id,title,format,chapters_count:expected,total_chars:total,next_index:0,limits:LIBRARY_LIMITS};
}
export async function appendLibraryImport(db,id,input) {
  const current=await draft(db,id);
  const start=Number(input?.start_index);
  if(!Number.isInteger(start)||start<0)throw new LibraryError('invalid_index','批次起始序号无效。');
  const {prepared,chars}=validateChapters(input?.chapters);
  if(start<current.import_next_index) {
    // Network retries must not duplicate any chapter.
    if(start+prepared.length>current.import_next_index)throw new LibraryError('import_conflict','上传重试与已有进度不一致。',409);
    const stored=await all(db,`SELECT chapter_index,title,body FROM coast_library_chapters
      WHERE book_id=? AND chapter_index>=? AND chapter_index<? ORDER BY chapter_index`,
      [id,start,start+prepared.length]);
    if(stored.length!==prepared.length||stored.some((row,i)=>row.chapter_index!==start+i||
      row.title!==prepared[i].title||row.body!==prepared[i].body)){
      throw new LibraryError('import_conflict','已保存章节内容与本次重试不同。',409);
    }
    return {book_id:id,next_index:current.import_next_index,imported_chars:current.imported_chars,replayed:true};
  }
  if(start!==current.import_next_index||start+prepared.length>current.import_expected_chapters) {
    throw new LibraryError('import_order','请按照书籍原始章节顺序上传，不会跳过正文。',409);
  }
  const nextTotal=current.imported_chars+chars;
  if(nextTotal>LIBRARY_LIMITS.max_chars)throw new LibraryError('book_too_large',`单本最多 ${LIBRARY_LIMITS.max_chars} 字。`);
  const statements=prepared.map((item,i)=>db.prepare(`INSERT INTO coast_library_chapters
    (book_id,chapter_index,title,body) VALUES (?,?,?,?)`).bind(id,start+i,item.title,item.body));
  statements.push(db.prepare(`UPDATE coast_library_books SET import_next_index=?,
    imported_chars=?,updated_at=? WHERE id=? AND import_state='importing' AND import_next_index=?`)
    .bind(start+prepared.length,nextTotal,Date.now(),id,start));
  // D1 batch executes transactionally; never expose a partially written batch.
  await db.batch(statements);
  return {book_id:id,next_index:start+prepared.length,imported_chars:nextTotal,replayed:false};
}
export async function finishLibraryImport(db,id) {
  const current=await draft(db,id);
  const chapters=await first(db,'SELECT COUNT(*) AS n FROM coast_library_chapters WHERE book_id=?',[id]);
  if(current.import_next_index!==current.import_expected_chapters||chapters.n!==current.import_expected_chapters) {
    throw new LibraryError('import_incomplete',`仍有章节未上传：已收 ${chapters.n} / ${current.import_expected_chapters} 章。`,409);
  }
  if(current.imported_chars!==current.import_expected_chars)throw new LibraryError('import_incomplete',`正文长度校验未通过：${current.imported_chars} / ${current.import_expected_chars} 字。`,409);
  await run(db,`UPDATE coast_library_books SET import_state='ready',updated_at=? WHERE id=? AND import_state='importing'`,[Date.now(),id]);
  return getLibraryBook(db,id);
}
export async function cancelLibraryImport(db,id) {
  await draft(db,id);
  const statements=[
    db.prepare('DELETE FROM coast_library_chapters WHERE book_id=?').bind(id),
    db.prepare("DELETE FROM coast_library_books WHERE id=? AND import_state='importing'").bind(id),
  ];
  await db.batch(statements);
  return {deleted:true,id};
}
