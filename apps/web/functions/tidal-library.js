// 潮中书房：书与批注是永久资料，阅读工具按需把小段原文送回当前聊天。
export const LIBRARY_LIMITS = Object.freeze({
  max_books: 80, max_chapters: 2048, max_chars: 12000000, chapter_chars: 32000,
  paragraph_chars: 4000, note_chars: 4000, title_chars: 160, page_paragraphs: 12,
  max_file_bytes: 40*1024*1024, max_unpacked_bytes: 80*1024*1024,
  import_batch_chars: 120000, import_batch_chapters: 8, import_batch_bytes: 900000,
});
const pending = new WeakMap();
export class LibraryError extends Error {
  constructor(type, message, status = 400) { super(message); this.name = 'LibraryError'; this.type = type; this.status = status; }
}
const first = (db,sql,params=[]) => db.prepare(sql).bind(...params).first();
const all = async (db,sql,params=[]) => (await db.prepare(sql).bind(...params).all())?.results || [];
const run = (db,sql,params=[]) => db.prepare(sql).bind(...params).run();
async function init(db) {
  await run(db, `CREATE TABLE IF NOT EXISTS coast_library_books (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, format TEXT NOT NULL,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  )`);
  // Existing shelves are ready by default. In-progress imports are deliberately hidden.
  const bookColumns = await all(db, 'PRAGMA table_info(coast_library_books)');
  for (const [field,definition] of [
    ['import_state',"TEXT NOT NULL DEFAULT 'ready'"],
    ['import_expected_chapters','INTEGER'],
    ['import_next_index','INTEGER NOT NULL DEFAULT 0'],
    ['import_expected_chars','INTEGER'],
    ['imported_chars','INTEGER NOT NULL DEFAULT 0'],
  ]) {
    if(!bookColumns.some(item=>item.name===field)) {
      await run(db,`ALTER TABLE coast_library_books ADD COLUMN ${field} ${definition}`);
    }
  }
  await run(db, `CREATE TABLE IF NOT EXISTS coast_library_chapters (
    book_id TEXT NOT NULL, chapter_index INTEGER NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
    PRIMARY KEY(book_id,chapter_index)
  )`);
  await run(db, `CREATE TABLE IF NOT EXISTS coast_library_notes (
    id TEXT PRIMARY KEY, book_id TEXT NOT NULL, chapter_index INTEGER,
    paragraph_index INTEGER, quote TEXT, kind TEXT NOT NULL, body TEXT NOT NULL,
    author TEXT NOT NULL, source TEXT NOT NULL, conversation_id TEXT, source_turn_id TEXT,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  )`);
  // Additive range columns; existing annotations stay anchored to full paragraphs.
  const noteColumns = await all(db, 'PRAGMA table_info(coast_library_notes)');
  for (const field of ['start_offset','end_offset']) {
    if (!noteColumns.some((column) => column.name === field)) {
      await run(db, `ALTER TABLE coast_library_notes ADD COLUMN ${field} INTEGER`);
    }
  }
  // Optional owner-only covers belong to books, never to a chat message.
  await run(db, `CREATE TABLE IF NOT EXISTS coast_library_covers (
    book_id TEXT PRIMARY KEY, mime TEXT NOT NULL, data BLOB NOT NULL,
    size INTEGER NOT NULL, updated_at INTEGER NOT NULL
  )`);
  await run(db, 'CREATE INDEX IF NOT EXISTS idx_library_notes_book ON coast_library_notes(book_id, created_at)');
  await run(db, `CREATE TABLE IF NOT EXISTS coast_library_progress (
    book_id TEXT NOT NULL, author TEXT NOT NULL, chapter_index INTEGER NOT NULL,
    paragraph_index INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    PRIMARY KEY(book_id,author)
  )`);
  await run(db, `CREATE TABLE IF NOT EXISTS coast_library_reading_logs (
    book_id TEXT NOT NULL, author TEXT NOT NULL, day TEXT NOT NULL,
    chapter_index INTEGER NOT NULL, paragraph_index INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    PRIMARY KEY(book_id,author,day)
  )`);
}
export async function ensureLibrarySchema(db) {
  if (!db) throw new LibraryError('database_unavailable', '潮中书房暂时无法连接数据库。', 503);
  let task = pending.get(db);
  if (!task) { task = init(db); pending.set(db, task); }
  try { await task; } catch (e) { pending.delete(db); throw e; }
}
function title(value, label = '标题') {
  const text = String(value || '').trim();
  if (!text || text.length > LIBRARY_LIMITS.title_chars) throw new LibraryError('invalid_title', `${label}不能为空，也不能超过 ${LIBRARY_LIMITS.title_chars} 字。`);
  return text;
}
function paragraphs(body) { return String(body || '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean); }
async function book(db, id) {
  const row = await first(db, 'SELECT * FROM coast_library_books WHERE id = ?', [id]);
  if (!row || row.import_state==='importing') throw new LibraryError('book_not_found', '书架上没有这本已经完成导入的书。', 404);
  return row;
}
async function chapter(db, bookId, index) {
  await book(db, bookId);
  const row = await first(db,'SELECT * FROM coast_library_chapters WHERE book_id = ? AND chapter_index = ?',[bookId,index]);
  if (!row) throw new LibraryError('chapter_not_found', '找不到这一章。', 404);
  return row;
}
export async function listLibraryBooks(db) {
  await ensureLibrarySchema(db);
  const rows = await all(db, `SELECT b.*, COUNT(c.chapter_index) AS chapters_count,
    (SELECT p.chapter_index FROM coast_library_progress p WHERE p.book_id=b.id AND p.author='owner') AS reader_chapter_index,
    (SELECT p.paragraph_index FROM coast_library_progress p WHERE p.book_id=b.id AND p.author='owner') AS reader_paragraph_index,
    (SELECT COUNT(*) FROM coast_library_notes n WHERE n.book_id=b.id AND n.author='owner' AND n.kind!='highlight') AS owner_notes,
    (SELECT COUNT(*) FROM coast_library_notes n WHERE n.book_id=b.id AND n.author='assistant' AND n.kind!='highlight') AS assistant_notes,
    (SELECT COUNT(*) FROM coast_library_notes n WHERE n.book_id=b.id AND n.author='owner' AND n.kind='highlight') AS highlights_count,
    EXISTS(SELECT 1 FROM coast_library_covers cover WHERE cover.book_id=b.id) AS has_cover
    FROM coast_library_books b LEFT JOIN coast_library_chapters c ON c.book_id = b.id
    WHERE b.import_state='ready'
    GROUP BY b.id ORDER BY b.updated_at DESC`);
  return rows;
}
export async function createLibraryBook(db, input) {
  await ensureLibrarySchema(db);
  const name = title(input?.title, '书名');
  const format = String(input?.format || '').toLowerCase();
  if (!['epub','txt'].includes(format)) throw new LibraryError('unsupported_format', '第一版只接收 EPUB 和 TXT 文本。');
  const chapters = input?.chapters;
  if (!Array.isArray(chapters) || !chapters.length || chapters.length > LIBRARY_LIMITS.max_chapters) {
    throw new LibraryError('chapter_limit', `每本书需有 1 至 ${LIBRARY_LIMITS.max_chapters} 章。`);
  }
  const prepared = chapters.map((item,i) => {
    const name = title(item.title || `第 ${i+1} 章`, '章节名');
    const body = String(item.body || '').trim();
    if (!body || body.length > LIBRARY_LIMITS.chapter_chars) throw new LibraryError('chapter_too_large', `每章正文最多 ${LIBRARY_LIMITS.chapter_chars} 字且不能为空。`);
    if (paragraphs(body).some(p=>p.length > LIBRARY_LIMITS.paragraph_chars)) throw new LibraryError('paragraph_too_large', `单段最多 ${LIBRARY_LIMITS.paragraph_chars} 字。`);
    return { title: name, body };
  });
  if (prepared.reduce((n,x)=>n+x.body.length,0) > LIBRARY_LIMITS.max_chars) {
    throw new LibraryError('book_too_large', `每本书最多收录 ${LIBRARY_LIMITS.max_chars} 字。不会悄悄截断。`);
  }
  const count = await first(db, 'SELECT COUNT(*) AS count FROM coast_library_books');
  if (count.count >= LIBRARY_LIMITS.max_books) throw new LibraryError('book_limit', `书架最多 ${LIBRARY_LIMITS.max_books} 本。`);
  const id = `book_${crypto.randomUUID()}`, now=Date.now();
  try {
    await run(db,'INSERT INTO coast_library_books (id,title,format,created_at,updated_at) VALUES (?,?,?,?,?)',[id,name,format,now,now]);
    for(let i=0;i<prepared.length;i++){
      await run(db,'INSERT INTO coast_library_chapters (book_id,chapter_index,title,body) VALUES (?,?,?,?)',[id,i,prepared[i].title,prepared[i].body]);
    }
  } catch {
    await run(db,'DELETE FROM coast_library_chapters WHERE book_id = ?',[id]).catch(()=>{});
    await run(db,'DELETE FROM coast_library_books WHERE id = ?',[id]).catch(()=>{});
    throw new LibraryError('save_failed', '书籍没有完整写入，请重试。', 500);
  }
  return getLibraryBook(db,id);
}
export async function getLibraryBook(db,id) {
  await ensureLibrarySchema(db);
  const record = await book(db,id);
  const chapters = await all(db,'SELECT chapter_index,title,LENGTH(body) AS chars FROM coast_library_chapters WHERE book_id = ? ORDER BY chapter_index',[id]);
  // A book has a single reading position, owned by the human reader.
  // Retain historical model records without showing or deleting them.
  const progress=await all(db,"SELECT * FROM coast_library_progress WHERE book_id = ? AND author = 'owner'",[id]);
  const reading_logs=await all(db,"SELECT * FROM coast_library_reading_logs WHERE book_id = ? AND author = 'owner' ORDER BY day DESC LIMIT 60",[id]);
  return { ...record, chapters, progress, reading_logs };
}
// The logged-in reader reflows one bounded chapter; model tool limits stay unchanged.
export async function readFullLibraryChapter(db,{ book_id, chapter_index }) {
  await ensureLibrarySchema(db);
  const index=Number(chapter_index);
  if (!Number.isInteger(index) || index<0) throw new LibraryError('invalid_range','章节编号无效。');
  const item=await chapter(db,book_id,index);
  const list=paragraphs(item.body);
  return { book_id,chapter_index:index,chapter_title:item.title,paragraph_count:list.length,
    paragraphs:list.map((text,i)=>({index:i,text})) };
}

export async function readLibraryChapter(db,{ book_id, chapter_index, start_paragraph=0, limit=LIBRARY_LIMITS.page_paragraphs }) {
  await ensureLibrarySchema(db);
  const index = Number(chapter_index),start=Number(start_paragraph),count=Number(limit);
  if (!Number.isInteger(index) || index<0 || !Number.isInteger(start) || start<0 || !Number.isInteger(count) || count<1 || count>LIBRARY_LIMITS.page_paragraphs) {
    throw new LibraryError('invalid_range', `一次可读取 1—${LIBRARY_LIMITS.page_paragraphs} 段，请明确起始段号。`);
  }
  const c = await chapter(db,book_id,index);
  const paras=paragraphs(c.body);
  return { book_id, chapter_index:index, chapter_title:c.title, paragraph_count:paras.length,
    start_paragraph:start, limit:count, paragraphs:paras.slice(start,start+count).map((text,i)=>({ index:start+i,text })),
    next_paragraph:start+count<paras.length?start+count:null };
}

export async function updateLibraryProgress(db,{book_id,chapter_index,paragraph_index},{author='owner'}={}) {
  await ensureLibrarySchema(db);
  if(!['owner','assistant'].includes(author))throw new LibraryError('invalid_author','阅读记录作者无效。');
  const index=Number(chapter_index),paragraph=Number(paragraph_index);
  const page=await readLibraryChapter(db,{book_id,chapter_index:index,start_paragraph:paragraph,limit:1});
  if(!page.paragraphs.length)throw new LibraryError('invalid_position','阅读进度必须指向存在的段落。');
  const now=Date.now(),day=new Date(now).toISOString().slice(0,10);
  await run(db,`INSERT INTO coast_library_progress (book_id,author,chapter_index,paragraph_index,updated_at)
    VALUES (?,?,?,?,?) ON CONFLICT(book_id,author) DO UPDATE SET chapter_index=excluded.chapter_index,
      paragraph_index=excluded.paragraph_index,updated_at=excluded.updated_at`,[book_id,author,index,paragraph,now]);
  await run(db,`INSERT INTO coast_library_reading_logs (book_id,author,day,chapter_index,paragraph_index,updated_at)
    VALUES (?,?,?,?,?,?) ON CONFLICT(book_id,author,day) DO UPDATE SET chapter_index=excluded.chapter_index,
      paragraph_index=excluded.paragraph_index,updated_at=excluded.updated_at`,[book_id,author,day,index,paragraph,now]);
  return {book_id,author,chapter_index:index,paragraph_index:paragraph,updated_at:now,recorded_day:day};
}

export async function listLibraryNotes(db, { book_id, chapter_index }={}) {
  await ensureLibrarySchema(db);
  await book(db,book_id);
  const filter = chapter_index===undefined? '' : ' AND chapter_index = ?';
  const params = chapter_index===undefined?[book_id]:[book_id,Number(chapter_index)];
  return all(db,`SELECT * FROM coast_library_notes WHERE book_id = ?${filter} ORDER BY created_at ASC`,params);
}
function actor(ctx) { return ctx.author === 'owner' ? 'owner' : 'assistant'; }
export async function writeLibraryNote(db,input,ctx={}) {
  await ensureLibrarySchema(db);
  await book(db,input.book_id);
  const kind = input.kind || 'annotation';
  if (!['annotation','reflection','highlight'].includes(kind)) throw new LibraryError('invalid_kind','请选择划线、批注或读后感。');
  const body=String(input.body||'').trim();
  if ((kind!=='highlight' && !body) || body.length>LIBRARY_LIMITS.note_chars || (kind==='highlight' && body)) {
    throw new LibraryError('note_limit',`批注或读后感为 1—${LIBRARY_LIMITS.note_chars} 字；单纯划线不需要正文。`);
  }
  let chapter_index=null,paragraph_index=null,quote=null,start_offset=null,end_offset=null;
  if (kind==='annotation' || kind==='highlight') {
    chapter_index=Number(input.chapter_index); paragraph_index=Number(input.paragraph_index);
    if (!Number.isInteger(paragraph_index) || paragraph_index<0 || !Number.isInteger(chapter_index) || chapter_index<0) throw new LibraryError('invalid_anchor','划线或批注必须指定有效章节与段落。');
    const c=await chapter(db,input.book_id,chapter_index);
    const paragraph=paragraphs(c.body)[paragraph_index] || null;
    if (!paragraph) throw new LibraryError('invalid_anchor','无法定位原文段落。');
    const hasStart=input.start_offset!==undefined && input.start_offset!==null;
    const hasEnd=input.end_offset!==undefined && input.end_offset!==null;
    if (hasStart!==hasEnd || (kind==='highlight' && !hasStart)) throw new LibraryError('invalid_range','划线必须有准确的起止位置。');
    if (hasStart) {
      start_offset=Number(input.start_offset); end_offset=Number(input.end_offset);
      if (!Number.isInteger(start_offset) || !Number.isInteger(end_offset) || start_offset<0 || end_offset>paragraph.length || end_offset<=start_offset) {
        throw new LibraryError('invalid_range','划线范围超出原文，不会保存错误位置。');
      }
      quote=paragraph.slice(start_offset,end_offset);
    } else quote=paragraph;
  }
  const id=`note_${crypto.randomUUID()}`,now=Date.now();
  await run(db,`INSERT INTO coast_library_notes
    (id,book_id,chapter_index,paragraph_index,quote,kind,body,author,source,conversation_id,source_turn_id,created_at,updated_at,start_offset,end_offset)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
    id,input.book_id,chapter_index,paragraph_index,quote,kind,body,actor(ctx),
    ctx.surface==='official_mcp'?'official_mcp':ctx.author==='owner'?'manual':'coast_chat',
    ctx.conversation_id||null,ctx.source_turn_id||null,now,now,start_offset,end_offset,
  ]);
  return first(db,'SELECT * FROM coast_library_notes WHERE id = ?',[id]);
}
export async function editLibraryNote(db,id,patch,ctx={}) {
  await ensureLibrarySchema(db);
  const row=await first(db,'SELECT * FROM coast_library_notes WHERE id = ?',[id]);
  if(!row) throw new LibraryError('note_not_found','没有找到这条笔记。',404);
  if(row.author!==actor(ctx)) throw new LibraryError('wrong_author','只能修改自己写的批注与读后感。',403);
  const body=String(patch?.body||'').trim();
  if(!body||body.length>LIBRARY_LIMITS.note_chars)throw new LibraryError('note_limit',`正文须为 1—${LIBRARY_LIMITS.note_chars} 字。`);
  await run(db,'UPDATE coast_library_notes SET body=?,kind=?,updated_at=? WHERE id=?',[body,row.kind==='highlight'?'annotation':row.kind,Date.now(),id]);
  return first(db,'SELECT * FROM coast_library_notes WHERE id = ?',[id]);
}
export async function deleteLibraryNote(db,id,ctx={}) {
  await ensureLibrarySchema(db);
  const row=await first(db,'SELECT * FROM coast_library_notes WHERE id = ?',[id]);
  if(!row) throw new LibraryError('note_not_found','笔记不存在。',404);
  if(row.author!==actor(ctx)) throw new LibraryError('wrong_author','只能删去自己写的批注与读后感。',403);
  await run(db,'DELETE FROM coast_library_notes WHERE id=?',[id]);
  return { deleted:true,id };
}
export async function deleteLibraryBook(db,id) {
  await ensureLibrarySchema(db);
  await book(db,id);
  await run(db,'DELETE FROM coast_library_notes WHERE book_id=?',[id]);
  await run(db,'DELETE FROM coast_library_covers WHERE book_id=?',[id]);
  await run(db,'DELETE FROM coast_library_chapters WHERE book_id=?',[id]);
  await run(db,'DELETE FROM coast_library_progress WHERE book_id=?',[id]);
  await run(db,'DELETE FROM coast_library_reading_logs WHERE book_id=?',[id]);
  await run(db,'DELETE FROM coast_library_books WHERE id=?',[id]);
  return { deleted:true,id };
}
export async function exportLibrary(db) {
  const books=await listLibraryBooks(db);
  const full=[];
  for(const b of books) {
    const chapters=await all(db,'SELECT chapter_index,title,body FROM coast_library_chapters WHERE book_id=? ORDER BY chapter_index',[b.id]);
    const state=await getLibraryBook(db,b.id);
    // Preserve historical per-model progress only in exports, not the live UI.
    const archived_model_progress=await all(db,"SELECT * FROM coast_library_progress WHERE book_id=? AND author='assistant'",[b.id]);
    const archived_model_reading_logs=await all(db,"SELECT * FROM coast_library_reading_logs WHERE book_id=? AND author='assistant' ORDER BY day DESC",[b.id]);
    const cover=await first(db,'SELECT mime,data FROM coast_library_covers WHERE book_id=?',[b.id]);
    const coverBytes=cover ? (Array.isArray(cover.data)?Uint8Array.from(cover.data):new Uint8Array(cover.data)) : null;
    const cover_data_url=coverBytes ? `data:${cover.mime};base64,${btoa(Array.from(coverBytes,byte=>String.fromCharCode(byte)).join(''))}` : null;
    full.push({ ...b, cover_data_url, chapters, notes:await listLibraryNotes(db,{book_id:b.id}),
      progress:state.progress,reading_logs:state.reading_logs,
      archived_model_progress,archived_model_reading_logs });
  }
  return { books:full, limits: LIBRARY_LIMITS };
}
