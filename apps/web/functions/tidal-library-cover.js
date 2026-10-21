import { ensureLibrarySchema, getLibraryBook, LibraryError } from './tidal-library.js';

export const COVER_LIMIT_BYTES = 600 * 1024;
const MIME = Object.freeze({'image/jpeg':[0xff,0xd8,0xff], 'image/png':[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]});
const first=(db,sql,args=[])=>db.prepare(sql).bind(...args).first();
const run=(db,sql,args=[])=>db.prepare(sql).bind(...args).run();
export async function putLibraryCover(db,id,bytes,mime) {
  await ensureLibrarySchema(db);
  await getLibraryBook(db,id);
  if(!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > COVER_LIMIT_BYTES)
    throw new LibraryError('cover_limit','封面最大 600 KB；请裁剪或压缩后再上传。');
  const signature=MIME[mime];
  if(!signature || !signature.every((v,i)=>bytes[i]===v))
    throw new LibraryError('cover_format','仅接受真正的 JPEG 或 PNG 图片，不接受 SVG 和伪装的文件。');
  await run(db,`INSERT INTO coast_library_covers (book_id,mime,data,size,updated_at)
    VALUES (?,?,?,?,?) ON CONFLICT(book_id) DO UPDATE SET mime=excluded.mime,
      data=excluded.data,size=excluded.size,updated_at=excluded.updated_at`,
    [id,mime,bytes,bytes.length,Date.now()]);
  return {book_id:id,has_cover:true,size:bytes.length,mime};
}
export async function getLibraryCover(db,id) {
  await ensureLibrarySchema(db);
  await getLibraryBook(db,id);
  const row=await first(db,'SELECT mime,data,size FROM coast_library_covers WHERE book_id=?',[id]);
  if(!row)throw new LibraryError('cover_not_found','尚未上传书籍封面。',404);
  return {mime:row.mime,bytes:Array.isArray(row.data)?Uint8Array.from(row.data):new Uint8Array(row.data)};
}
export async function deleteLibraryCover(db,id) {
  await ensureLibrarySchema(db);
  await getLibraryBook(db,id);
  await run(db,'DELETE FROM coast_library_covers WHERE book_id=?',[id]);
  return {book_id:id,has_cover:false};
}
