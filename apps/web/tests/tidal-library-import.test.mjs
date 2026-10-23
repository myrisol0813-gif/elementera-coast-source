import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { importBookFile } from '../elementera-mcp/deploy-pages/public/features/library-import.js';

const oldParser=globalThis.DOMParser;
globalThis.DOMParser=new Window().DOMParser;

function zipStored(files) {
  const local=[],central=[];let offset=0;
  for(const [name,text] of Object.entries(files)) {
    const filename=Buffer.from(name),body=Buffer.from(text);
    const entry=Buffer.alloc(30+filename.length+body.length);
    entry.writeUInt32LE(0x04034b50,0);entry.writeUInt16LE(20,4);
    entry.writeUInt32LE(body.length,18);entry.writeUInt32LE(body.length,22);
    entry.writeUInt16LE(filename.length,26);
    filename.copy(entry,30);body.copy(entry,30+filename.length);
    local.push(entry);
    const index=Buffer.alloc(46+filename.length);
    index.writeUInt32LE(0x02014b50,0);
    index.writeUInt16LE(20,4);index.writeUInt16LE(20,6);
    index.writeUInt32LE(body.length,20);index.writeUInt32LE(body.length,24);
    index.writeUInt16LE(filename.length,28);index.writeUInt32LE(offset,42);
    filename.copy(index,46);
    central.push(index);offset+=entry.length;
  }
  const centralSize=central.reduce((n,b)=>n+b.length,0);
  const footer=Buffer.alloc(22);footer.writeUInt32LE(0x06054b50,0);
  footer.writeUInt16LE(central.length,8);footer.writeUInt16LE(central.length,10);
  footer.writeUInt32LE(centralSize,12);footer.writeUInt32LE(offset,16);
  return Buffer.concat([...local,...central,footer]);
}

try {
  const txt=await importBookFile({name:'小书.txt',size:120,text:async()=> '第一段。\n\n第二段。'});
  assert.equal(txt.format,'txt');
  assert.equal(txt.chapters[0].body,'第一段。\n\n第二段。');
  await assert.rejects(()=>importBookFile({name:'image.pdf',size:20}),/TXT 和 EPUB/);

  const bytes=zipStored({
    'META-INF/container.xml':'<?xml version="1.0"?><container><rootfiles><rootfile full-path="OPS/content.opf"/></rootfiles></container>',
    'OPS/content.opf':'<?xml version="1.0"?><package><manifest><item id="chap" href="one.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chap"/></spine></package>',
    'OPS/one.xhtml':'<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><h1>第一章</h1><p>潮水从窗边经过。</p><p>我们一起读书。</p></body></html>',
  });
  const epub=await importBookFile({name:'书房.epub',size:bytes.length,arrayBuffer:async()=>bytes});
  assert.equal(epub.format,'epub');
  assert.equal(epub.chapters.length,1);
  assert.match(epub.chapters[0].body,/潮水从窗边经过。/);
  assert.match(epub.chapters[0].body,/我们一起读书。/);
} finally { globalThis.DOMParser=oldParser; }
console.log('tidal-library-import: ok (TXT, text-only EPUB, unsupported formats)');
