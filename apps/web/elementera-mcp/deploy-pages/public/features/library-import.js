// Text-only EPUB/TXT import for 潮中书房. Images, DRM and complex layout are intentionally not supported.
const MAX_CHARS=12000000, MAX_CHAPTERS=2048, MAX_CHAPTER_CHARS=32000, MAX_PARAGRAPH=4000;
const decoder=new TextDecoder();
const u16=(view,at)=>view.getUint16(at,true);
const u32=(view,at)=>view.getUint32(at,true);
function splitParagraphs(value) {
  const text=String(value||'').replace(/\r\n?/g,'\n').trim();
  const basic=text.split(/\n\s*\n/).map(s=>s.replace(/\s*\n\s*/g,' ').trim()).filter(Boolean);
  const output=[];
  for(const p of basic)for(let i=0;i<p.length;i+=MAX_PARAGRAPH)output.push(p.slice(i,i+MAX_PARAGRAPH));
  return output;
}
function chapterize(sections) {
  const result=[];
  let sum=0;
  for(const section of sections) {
    let part=[],length=0,number=1;
    const append=()=>{
      if(!part.length)return;
      result.push({title:number===1?section.title:`${section.title} · ${number}`,body:part.join('\n\n')});
      number++;part=[];length=0;
    };
    for(const p of splitParagraphs(section.body)){
      sum+=p.length;
      if(sum>MAX_CHARS)throw Error(`本版每本书最多 ${MAX_CHARS} 字。没有截掉后面的书页，请换较小的文件。`);
      if(length && length+p.length+2>MAX_CHAPTER_CHARS)append();
      part.push(p);length+=p.length+2;
    }
    append();
    if(result.length>MAX_CHAPTERS)throw Error(`本版最多支持 ${MAX_CHAPTERS} 章，当前文件超出限制。`);
  }
  if(!result.length)throw Error('没有从文件中提取到可阅读的正文。');
  return result;
}
function normalPath(path) {
  const pieces=[];
  for(const part of String(path||'').split('/')) {
    if(part==='..')pieces.pop();
    else if(part&&part!=='.')pieces.push(part);
  }
  return pieces.join('/');
}
function relativePath(base,href) {
  return normalPath(base.split('/').slice(0,-1).concat(String(href||'').split('#')[0]).join('/'));
}
function zipIndex(bytes) {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let end=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--) {
    if(u32(view,i)===0x06054b50){end=i;break;}
  }
  if(end<0)throw Error('EPUB ZIP 目录损坏，无法导入。');
  const total=u16(view,end+10);
  let pos=u32(view,end+16);
  const records=new Map();
  let totalRaw=0;
  for(let n=0;n<total;n++){
    if(pos+46>bytes.length||u32(view,pos)!==0x02014b50)throw Error('EPUB 目录格式不完整。');
    const compression=u16(view,pos+10),size=u32(view,pos+20),rawSize=u32(view,pos+24);
    const nameLen=u16(view,pos+28),extraLen=u16(view,pos+30),commentLen=u16(view,pos+32),offset=u32(view,pos+42);
    const name=normalPath(decoder.decode(bytes.subarray(pos+46,pos+46+nameLen)));
    if(name) {
      if(rawSize>4*1024*1024)throw Error('EPUB 单个内部文件超过 4 MB。');
      totalRaw+=rawSize;
      if(totalRaw>80*1024*1024)throw Error('EPUB 解压后总体积超过 80 MB。');
      records.set(name,{compression,size,rawSize,offset});
    }
    pos+=46+nameLen+extraLen+commentLen;
  }
  return records;
}
async function extract(bytes,records,path) {
  const item=records.get(normalPath(path));
  if(!item)throw Error(`EPUB 缺少文件：${path}`);
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),p=item.offset;
  if(p+30>bytes.length||u32(v,p)!==0x04034b50)throw Error('EPUB 内部文件格式损坏。');
  const start=p+30+u16(v,p+26)+u16(v,p+28);
  const compressed=bytes.subarray(start,start+item.size);
  if(start+item.size>bytes.length)throw Error('EPUB 内部文件不完整。');
  if(item.compression===0)return decoder.decode(compressed);
  if(item.compression!==8||typeof DecompressionStream!=='function')throw Error('当前浏览器不支持这本 EPUB 的解压格式。');
  let stream;
  try{stream=new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));}
  catch{throw Error('此设备暂不支持 EPUB 解压，可改用 TXT 阅读。');}
  const reader=stream.getReader();let count=0;const blocks=[];
  while(true){
    const {done,value}=await reader.read();if(done)break;
    count+=value.length;
    if(count>4*1024*1024){await reader.cancel();throw Error('EPUB 单个章节压缩文件解包超过 4 MB。');}
    blocks.push(value);
  }
  const all=new Uint8Array(count);let pos=0;
  for(const part of blocks){all.set(part,pos);pos+=part.length;}
  return decoder.decode(all);
}
function xml(content) {
  const doc=new DOMParser().parseFromString(content,'application/xml');
  if(doc.querySelector('parsererror'))throw Error('EPUB 目录 XML 无法解析。');
  return doc;
}
function localTag(node) { return node?.localName || String(node?.tagName||'').split(':').pop(); }
function named(doc,tag) { return [...doc.getElementsByTagName('*')].filter(node=>localTag(node)===tag); }
function chapterText(html) {
  const doc=new DOMParser().parseFromString(html,'application/xhtml+xml');
  const body=named(doc,'body')[0]||doc.documentElement;
  for(const el of [...body.querySelectorAll('script,style,nav,svg')])el.remove();
  const blocks=[...body.querySelectorAll('h1,h2,h3,h4,h5,h6,p,blockquote,li')];
  return (blocks.length?blocks.map(x=>x.textContent):[body.textContent])
    .map(x=>String(x||'').replace(/\s+/g,' ').trim()).filter(Boolean).join('\n\n');
}
async function epubSections(bytes) {
  const records=zipIndex(bytes);
  const container=xml(await extract(bytes,records,'META-INF/container.xml'));
  const opfPath=named(container,'rootfile')[0]?.getAttribute('full-path');
  if(!opfPath)throw Error('EPUB 缺少 OPF 书籍目录。');
  const opf=xml(await extract(bytes,records,opfPath));
  const entries=new Map(named(opf,'item').map(node=>[node.getAttribute('id'),{
    href:node.getAttribute('href'),media:node.getAttribute('media-type'),
  }]));
  const ids=named(opf,'itemref').map(node=>node.getAttribute('idref')).filter(Boolean);
  if(!ids.length)throw Error('EPUB 没有可阅读的章节。');
  const parts=[];
  for(const id of ids) {
    const entry=entries.get(id);
    if(!entry||!/(xhtml|html)/i.test(entry.media||''))continue;
    const path=relativePath(opfPath,decodeURIComponent(entry.href||''));
    const doc=await extract(bytes,records,path);
    const body=chapterText(doc);
    if(body.trim())parts.push({title:`第 ${parts.length+1} 节`,body});
  }
  return parts;
}
export function decodeTaggedTxt(text) {
  const input=String(text||'');
  const tags=input.match(/<\s*\/?\s*(?:p|br|div|blockquote)\b[^>]*>/gi) || [];
  if(tags.length<2) return input;
  const safe=input.replace(/<\s*br\s*\/?>/gi,'\n\n');
  const doc=new DOMParser().parseFromString(safe,'text/html');
  doc.querySelectorAll('script,style,iframe,object,embed').forEach(node=>node.remove());
  const paragraphs=[...doc.body.querySelectorAll('p')];
  return (paragraphs.length ? paragraphs.map(node=>node.textContent) : [doc.body.textContent])
    .map(s=>String(s||'').trim()).filter(Boolean).join('\n\n');
}
export async function importBookFile(file) {
  const name=String(file?.name||'');
  const ext=name.split('.').pop().toLowerCase();
  if(!['txt','epub'].includes(ext))throw Error('潮中书房目前只支持 TXT 和 EPUB 文件。');
  if(file.size>40*1024*1024)throw Error('书籍源文件不能超过 40 MB，不会截断。');
  const sections=ext==='txt'
    ?[{title:'正文',body:decodeTaggedTxt(await file.text())}]
    :await epubSections(new Uint8Array(await file.arrayBuffer()));
  return { title:name.slice(0,-ext.length-1)||'未命名书',format:ext,chapters:chapterize(sections) };
}
