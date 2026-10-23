import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { paginateReaderParagraphs, readerPageForParagraph, renderReaderFragment } from '../elementera-mcp/deploy-pages/public/features/library-pages.js';
import { renderTidalReader } from '../elementera-mcp/deploy-pages/public/features/library-reader.js';
import { decodeTaggedTxt } from '../elementera-mcp/deploy-pages/public/features/library-import.js';
import { escapeHtml, escapeAttribute } from '../elementera-mcp/deploy-pages/public/core/dom.js';

const paragraphs=[{index:0,text:'abcd。efgh。ij klmnop'},{index:1,text:'后面的书页也还在。'}];
const pages=paginateReaderParagraphs(paragraphs,180);
assert.equal(pages.flat().map(f=>f.text).join(''),paragraphs.map(x=>x.text).join(''));
assert.equal(readerPageForParagraph(pages,0),0);
assert.throws(()=>paginateReaderParagraphs(paragraphs,10),RangeError);
const note={id:'note_1',author:'owner',kind:'highlight',chapter_index:0,paragraph_index:0,start_offset:2,end_offset:8,quote:'cd。efg'};
const marked=renderReaderFragment({paragraph:0,start:0,end:10,text:paragraphs[0].text.slice(0,10)},[note],escapeHtml,escapeAttribute);
assert.match(marked,/data-action="library:mark"/);
assert.match(marked,/>cd。efg<\/mark>/);
assert.ok(marked.includes('ab'));
const html=renderTidalReader({
  book:{id:'book_1',title:'书房测试',chapters:[{title:'第一章',chapter_index:0}]},
  chapterTitle:'第一章',chapterIndex:0,pages,pageIndex:0,notes:[note],theme:'paper',fontSize:15,
});
assert.match(html,/tidal-reader-paper/);
assert.match(html,/tidal-reader-toc/);
assert.match(html,/tidal-reader-color/);
assert.match(html,/上一页/);
const old=globalThis.DOMParser;
globalThis.DOMParser=new Window().DOMParser;
try {
  const text=decodeTaggedTxt('<p>第一段。</p><p>第二段。<br />第三段。</p>');
  assert.match(text,/第一段。/);
  assert.match(text,/第二段。/);
  assert.doesNotMatch(text,/<\/?p>|<br/);
  assert.equal(decodeTaggedTxt('让 <p> 标签留在技术文档中。'),'让 <p> 标签留在技术文档中。');
} finally { globalThis.DOMParser=old; }
console.log('tidal reader: ok (lossless pages, exact highlights, settings, tagged TXT)');
