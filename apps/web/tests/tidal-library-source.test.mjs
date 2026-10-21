import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { D1Database } from './d1-helper.mjs';
import {
  createLibraryBook, listLibraryBooks, getLibraryBook, updateLibraryProgress,
  writeLibraryNote, editLibraryNote, deleteLibraryNote, exportLibrary, LIBRARY_LIMITS,
} from '../functions/tidal-library.js';
import { routeApi } from '../functions/api-router.js';

const db = new D1Database();
const text = '第一段。' + '\n\n' + '第二段。';
const book = await createLibraryBook(db, { title: '通用测试书', format: 'txt', chapters: [{ title: '第一章', body: text }] });
assert.equal((await listLibraryBooks(db)).length, 1);
await updateLibraryProgress(db, { book_id: book.id, chapter_index: 0, paragraph_index: 0 }, { author: 'owner' });
assert.equal((await getLibraryBook(db, book.id)).progress[0].author, 'owner');
const note = await writeLibraryNote(db, { book_id: book.id, kind: 'reflection', body: '测试批注' }, { author: 'owner' });
assert.equal(note.author, 'owner');
assert.equal((await editLibraryNote(db, note.id, { body: '修改批注' }, { author: 'owner' })).body, '修改批注');
assert.equal((await deleteLibraryNote(db, note.id, { author: 'owner' })).deleted, true);
assert.equal((await exportLibrary(db)).books[0].chapters[0].body, text);
const request = (path, authorized = true) => routeApi(new Request('https://coast.test' + path), { COAST_CHAT_DB: db }, authorized ? { verified: true } : null);
assert.equal((await request('/api/library/books', false)).status, 401);
assert.equal((await request('/api/library/books')).status, 200);
assert.equal((await request('/api/library/books/' + book.id + '/chapters/0/text')).status, 200);
const ui = await readFile(new URL('../elementera-mcp/deploy-pages/public/features/library.js', import.meta.url), 'utf8');
const importer = await readFile(new URL('../elementera-mcp/deploy-pages/public/features/library-import.js', import.meta.url), 'utf8');
assert.equal(LIBRARY_LIMITS.max_books, 80);
assert.equal(LIBRARY_LIMITS.max_file_bytes, 40 * 1024 * 1024);
assert.equal(LIBRARY_LIMITS.max_chars, 12000000);
assert.equal(LIBRARY_LIMITS.max_chapters, 2048);
assert.match(ui, /80 本书/);
assert.match(ui, /40 MB/);
assert.match(ui, /1,200 万字/);
assert.match(ui, /2,048/);
assert.match(ui, /4,000 字/);
assert.match(ui, /600 KB/);
assert.match(importer, /MAX_CHARS=12000000, MAX_CHAPTERS=2048, MAX_CHAPTER_CHARS=32000, MAX_PARAGRAPH=4000/);
console.log('tidal-library-source: ok (authorization, progress, notes, export, displayed limits)');
