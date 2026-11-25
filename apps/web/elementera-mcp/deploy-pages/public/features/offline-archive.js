// Offline archive: no remote resources, scripts, or executable attachment previews.
const utf8 = new TextEncoder();
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ext = mime => ({'image/png':'png','image/jpeg':'jpg','image/gif':'gif','image/webp':'webp','audio/mpeg':'mp3','audio/wav':'wav','audio/ogg':'ogg','audio/mp4':'m4a','video/mp4':'mp4','application/pdf':'pdf','text/plain':'txt'}[mime] || 'bin');
const crcTable = Uint32Array.from({length:256}, (_,i)=>{for(let j=0;j<8;j++)i=(i&1)?0xedb88320^(i>>>1):i>>>1;return i>>>0;});
function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
// ZIP STORE with Blob parts: no archive-sized contiguous byte array. Explicit ZIP32 bounds.
export function zipFiles(files){
  const parts=[],central=[];let offset=0,centralSize=0;
  const header=(size,signature)=>{const b=new Uint8Array(size);const v=new DataView(b.buffer);v.setUint32(0,signature,true);return [b,v];};
  if(files.length>65535)throw Error('离线 ZIP 文件数超过 ZIP32 上限。');
  for(const [name,value] of files){
    const n=utf8.encode(name), data=typeof value==='string'?utf8.encode(value):value;
    if(n.length>65535||data.byteLength>0xffffffff||offset+30+n.length+data.byteLength>0xffffffff)throw Error('离线 ZIP 超过 4 GiB 格式上限。');
    const crc=crc32(data);
    const [h,v]=header(30,0x04034b50);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint16(12,33,true);v.setUint32(14,crc,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,n.length,true);
    const [c,d]=header(46,0x02014b50);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint16(8,0x800,true);d.setUint16(14,33,true);d.setUint32(16,crc,true);d.setUint32(20,data.length,true);d.setUint32(24,data.length,true);d.setUint16(28,n.length,true);d.setUint32(42,offset,true);
    parts.push(h,n,data);central.push(c,n);offset+=h.length+n.length+data.length;centralSize+=c.length+n.length;
  }
  if(offset+centralSize+22>0xffffffff)throw Error('离线 ZIP 超过 4 GiB 格式上限。');
  const [end,v]=header(22,0x06054b50);v.setUint16(8,files.length,true);v.setUint16(10,files.length,true);v.setUint32(12,centralSize,true);v.setUint32(16,offset,true);
  return new Blob([...parts,...central,end],{type:'application/zip'});
}
function decode(item){
  const chunks=Array.isArray(item.chunks)?item.chunks:[item.data_base64??item.data_b64];
  if(!chunks.length||chunks.some(x=>typeof x!=='string'))throw Error('缺少原件');
  const arrays=chunks.map(x=>Uint8Array.from(atob(x),c=>c.charCodeAt(0)));
  const bytes=new Uint8Array(arrays.reduce((n,a)=>n+a.length,0));let pos=0;
  for(const a of arrays){bytes.set(a,pos);pos+=a.length;}
  const expected=item.audio_bytes??item.size;
  if(expected!=null&&Number(expected)!==bytes.length)throw Error('原件长度不一致');
  return bytes;
}
const style='body{font:16px/1.7 system-ui,sans-serif;background:#f5f5f2;color:#344554;margin:0}main{max-width:920px;margin:auto;padding:24px 16px}section,article{background:#fffdf9;padding:16px;border-radius:18px;margin:12px 0}article.user{background:#eaf1f7}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.6 monospace}img,video,audio{display:block;max-width:100%;margin:8px 0}a{color:#365e7d}small{color:#667984}summary{cursor:pointer}';
const page=(title,body)=>'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src \'self\' data: file:; media-src \'self\' file:"><title>'+esc(title)+'</title><style>'+style+'</style></head><body><main>'+body+'</main></body></html>';
export function buildOfflineArchive(archive, initialWarnings=[], ownerLabel='屋主'){
  const files=[],warnings=[...initialWarnings],media=[],attachments=new Map();
  const records=archive.chat?.conversations||[];
  for(const [kind,items] of [['attachment',archive.attachments?.payloads||[]],['voice',archive.voice?.payloads||[]]]){
    for(const item of items){
      try{
        if(item.unavailable)throw Error('原件不可用');
        const clip=kind==='voice'?(archive.voice?.clips||[]).find(x=>x.id===item.id):null;
        const mime=item.mime||clip?.mime|| (kind==='voice'?'audio/mpeg':'application/octet-stream');
        const bytes=decode(item),path='media/'+(media.length+1)+'.'+ext(mime);
        files.push([path,bytes]);const row={kind,id:item.id,conversation_id:item.conversation_id??clip?.conversation_id??null,name:item.name||clip?.name||item.id||kind,mime,path,size:bytes.length};media.push(row);
        if(kind==='attachment')attachments.set(row.conversation_id+':'+row.id,row);
      }catch(e){warnings.push(kind+' '+String(item.id??'未知')+'：'+e.message);}
    }
  }
  const strip=(_k,v)=>v;
  function mediaHtml(m,prefix=''){const url=prefix+m.path;const link='<a href="'+esc(url)+'" download>'+esc(m.name)+'</a>';return link+(/^(image\/(png|jpeg|gif|webp))$/.test(m.mime)?'<img loading="lazy" src="'+esc(url)+'" alt="'+esc(m.name)+'">':/^audio\/(mpeg|wav|ogg|mp4)$/.test(m.mime)?'<audio controls preload="none" src="'+esc(url)+'"></audio>':/^video\/mp4$/.test(m.mime)?'<video controls preload="none" src="'+esc(url)+'"></video>':'');}
  const nav=[];
  records.forEach(({conversation={},history={}},i)=>{
    const path='chats/'+(i+1)+'.html',title=conversation.title||conversation.id||'未命名窗口';nav.push('<li><a href="'+path+'">'+esc(title)+'</a></li>');
    const article=(v,role,label)=>'<article class="'+role+'"><small>'+esc(v.display_author || (role==='user'?ownerLabel:'模型伙伴'))+' · '+esc(label)+' · '+esc(v.created_at||'')+'</small><div style="white-space:pre-wrap;overflow-wrap:anywhere">'+esc(v.content)+'</div>'+ (v.attachments||[]).map(a=>{const m=attachments.get(conversation.id+':'+a.id);return m?mediaHtml(m,'../'):'<p>原件未归档：'+esc(a.name||a.id)+'</p>';}).join('')+(v.desk_slip?'<details><summary>历史回执</summary><pre>'+esc(JSON.stringify(v.desk_slip,strip,2))+'</pre></details>':'')+((v.model_echo||v.usage)?'<details><summary>模型回波与用量</summary><pre>'+esc(JSON.stringify({model_echo:v.model_echo,usage:v.usage},strip,2))+'</pre></details>':'')+'</article>';
    const rows=(history.turns||[]).map((t,j)=>'<section><h2>第 '+(j+1)+' 轮</h2>'+ (t.user?.variants||[]).map((v,k)=>article(v,'user','用户变体 '+(k+1))).join('')+Object.entries(t.assistant?.variantsByUserVariant||{}).map(([k,vs])=>vs.map((v,l)=>article(v,'assistant','分支 '+k+' · 回复 '+(l+1))).join('')).join('')+'</section>').join('');
    files.push([path,page(title,'<a href="../index.html">返回海岸</a><h1>'+esc(title)+'</h1>'+rows)]);
  });
  const metadata={...archive,attachments:{...archive.attachments,payloads:undefined},voice:{...archive.voice,payloads:undefined}};
  const sections=[];
  for(const [key,value] of Object.entries(metadata)){if(key==='chat')continue;const path='sections/'+(sections.length+1)+'.html';sections.push('<li><a href="'+path+'">'+esc(key)+'</a></li>');files.push([path,page(key,'<a href="../index.html">返回海岸</a><h1>'+esc(key)+'</h1><pre>'+esc(JSON.stringify(value,null,2))+'</pre>')]);}
  files.push(['data.json',JSON.stringify(metadata,null,2)]);
  files.push(['manifest.json',JSON.stringify({format:'elementera-coast-offline-html',version:1,media,warnings,excluded_modules:archive.excluded_modules||[],restore_supported:false},null,2)]);
  files.push(['index.html',page('Elementera Coast','<h1>Elementera Coast · 离线海岸</h1><p>只读归档，解压整个 ZIP 后浏览。不是恢复包。</p><p>'+esc(archive.exported_at)+'</p><section><h2>归档范围</h2><pre>'+esc(JSON.stringify({included:archive.included_modules,excluded:archive.excluded_modules,warnings},null,2))+'</pre></section><section><h2>聊天窗口</h2><ul>'+nav.join('')+'</ul></section><section><h2>其他资料</h2><ul>'+sections.join('')+'</ul></section><section><h2>原件</h2>'+media.map(m=>mediaHtml(m)).join('')+'</section><p><a href="manifest.json">归档清单</a> · <a href="data.json">结构化资料</a></p>')]);
  return {blob:zipFiles(files),warnings,mediaCount:media.length};
}
