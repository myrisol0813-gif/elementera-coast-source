import { plainReplyText } from '../core/dom.js';
// Read-only projection of a verified V2 archive. Originals stay binary.
import { collectArchiveV2 } from '../core/archive-v2-collect.js';
import { openArchiveV2 } from '../core/archive-v2-read.js';
import { ArchiveV2ZipWriter } from '../core/archive-v2-zip.js';
import { archiveV2Transport } from '../core/archive-v2-transport.js';
const utf8=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const esc=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const labels={chat:'聊天',attachments:'附件',voice:'语音',vault:'拾潮',library:'书房',calendar:'日历',daily:'日常',thinking_soil:'思维壤',thinking_soil_history:'思维壤历史',user_portrait:'用户画像',self_portrait:'自我画像',tools:'工具历史'};
const ext=m=>({'image/png':'png','image/jpeg':'jpg','image/gif':'gif','image/webp':'webp','audio/mpeg':'mp3','audio/wav':'wav','audio/ogg':'ogg','audio/mp4':'m4a','video/mp4':'mp4','text/plain':'txt','application/pdf':'pdf'})[m]||'bin';
const time=t=>typeof t==='number'?new Date(t).toISOString():String(t??'');
const style='body{font:15px/1.75 system-ui,sans-serif;background:#f6f4ef;color:#3d454b;margin:0}main{max-width:780px;margin:auto;padding:22px 16px}article,section{background:#fffdf9;padding:16px;margin:13px 0;border-radius:7px;box-shadow:0 2px 8px #3331}article.user{background:#eef3f5}p,pre{white-space:pre-wrap;overflow-wrap:anywhere}pre{font:12px/1.6 monospace}small{color:#737a80}a{color:#496c82}img,audio,video{display:block;max-width:100%;margin:10px 0}img{max-height:65vh;object-fit:contain}.cover{width:110px;aspect-ratio:2/3;object-fit:cover;box-shadow:3px 3px 0 #ded7c7}.book{display:flex;gap:16px;align-items:start}blockquote{margin:8px 0;padding-left:12px;border-left:2px solid #b7a784}summary{cursor:pointer}li{margin:6px 0}';
const page=(title,body)=>'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src \'self\' file:; media-src \'self\' file:"><title>'+esc(title)+'</title><style>'+style+'</style></head><body><main>'+body+'</main></body></html>';
const mediaHtml=(m,prefix='../')=>{const url=esc(prefix+m.path),name=esc(m.name);return '<a href="'+url+'" download>'+name+'</a>'+(/^image\/(png|jpeg|gif|webp)$/.test(m.mime)?'<img loading="lazy" src="'+url+'" alt="'+name+'">':/^audio\/(mpeg|wav|ogg|mp4)$/.test(m.mime)?'<audio controls preload="none" src="'+url+'"></audio>':m.mime==='video/mp4'?'<video controls preload="none" src="'+url+'"></video>':'');};
async function* chunks(bytes){for(let i=0;i<bytes.length;i+=1048576)yield bytes.subarray(i,i+1048576);}
export async function writeOfflineV2(source,sink,{ownerLabel='屋主',device=null}={}){
  const {manifest,objectChunks}=source,objects=new Map(manifest.objects.map(d=>[d.object_sha256,d]));
  const zip=new ArchiveV2ZipWriter(sink,{readingCopy:true});
  const warnings=[],byHash=new Map(),byRecord=new Map(),attachments=new Map(),voices=new Map(),items=[];
  const key=x=>x.row.module+'/'+x.row.id;
  const load=async row=>{const d=objects.get(row.record_object);if(!d)throw Error('归档记录缺失');const raw=new Uint8Array(d.size);let at=0;for await(const b of objectChunks(d)){raw.set(b,at);at+=b.length;}if(at!==d.size)throw Error('归档记录不完整');return JSON.parse(decoder.decode(raw));};
  const text=async(path,value)=>{const raw=utf8.encode(value);await zip.entry(path,raw.length,chunks(raw));};
  const title=x=>x.kind==='chat'||x.kind==='local_chat'?x.data.conversation?.title||x.row.id:x.kind==='vault_stickers'?'表情包 · '+String(x.data.description||'').slice(0,45):x.kind==='library_notes'?({highlight:'划线',annotation:'批注',reflection:'读后感'})[x.data.kind]||'笔迹':x.data.title||x.data.name||(x.kind==='vault_treasures'?x.data.kind+' · '+x.data.source_id:x.kind+' · '+x.row.id);
  const link=(x,hash='')=>x.index+'.html'+hash;
  try{
    for(const [i,row] of manifest.records.entries()){
      const {kind,data}=await load(row);
      // Full history and long document bodies are loaded one record at a time.
      const {history,history_json,body,...meta}=data;
      items.push({row,kind,data:meta,index:i+1,path:'records/'+(i+1)+'.html',json:'records/'+(i+1)+'.json'});
    }
    const indexed=new Map(items.map(x=>[key(x),x])),byKind=k=>items.filter(x=>x.kind===k);
    const group=(rows,k)=>{const map=new Map();for(const x of rows){const id=x.data[k];if(!map.has(id))map.set(id,[]);map.get(id).push(x);}return map;};
    const books=new Map(byKind('library_books').map(x=>[x.data.id,x])),chapters=group(byKind('library_chapters'),'book_id'),notes=group(byKind('library_notes'),'book_id'),covers=new Map(byKind('library_covers').map(x=>[x.data.book_id,x])),progress=group(byKind('library_progress'),'book_id'),chatLinks=new Map(items.filter(x=>x.row.module==='chat').map(x=>[x.row.id,x])),voiceLinks=group(byKind('voice'),'conversation_id');
    for(const x of items){
      const list=[];
      for(const hash of x.row.media_objects){
        const d=objects.get(hash);if(!d)throw Error('归档原件缺失');
        const mime=x.data.mime||(x.kind==='voice'?'audio/mpeg':'application/octet-stream');
        let path=byHash.get(hash);
        if(!path){path='media/'+(byHash.size+1)+'.'+ext(mime);await zip.entry(path,d.size,objectChunks(d));byHash.set(hash,path);}
        list.push({id:x.data.id||x.row.id,path,mime,name:x.data.name||title(x)});
      }
      byRecord.set(key(x),list);
      if(list.length&&x.kind==='attachment')attachments.set(x.data.conversation_id+':'+x.data.id,list[0]);
      if(list.length&&x.kind==='voice')voices.set(x.data.conversation_id+':'+x.data.id,list[0]);
    }
    for(const x of items){
      const {data}=await load(x.row);let body='';
      if(x.row.module==='chat'){
        const conv=data.conversation||{},history=data.history||(typeof data.history_json==='string'?JSON.parse(data.history_json):data.history_json)||{};
        const article=(v,role,label)=>'<article class="'+role+'"><small>'+esc(v.display_author||(role==='user'?ownerLabel:'模型伙伴'))+' · '+esc(label)+' · '+esc(v.id||'')+' · '+esc(time(v.created_at))+'</small><p>'+esc(role==='assistant'?plainReplyText(v.content):v.content)+'</p>'+(v.attachments||[]).map(a=>{const m=attachments.get(conv.id+':'+a.id);if(m)return mediaHtml(m);warnings.push('聊天附件未匹配：'+a.id);return '<p>原件未归档：'+esc(a.name||a.id)+'</p>';}).join('')+(v.desk_slip?'<details><summary>历史桌面</summary><pre>'+esc(JSON.stringify(v.desk_slip))+'</pre></details>':'')+(v.usage||v.model_echo?'<details><summary>模型回波与用量</summary><pre>'+esc(JSON.stringify({usage:v.usage,model_echo:v.model_echo}))+'</pre></details>':'')+'</article>';
        body=(history.turns||[]).map((t,j)=>'<section><h2>第 '+(j+1)+' 轮</h2>'+(t.user?.variants||[]).map((v,i)=>article(v,'user','用户变体 '+(i+1))).join('')+Object.entries(t.assistant?.variantsByUserVariant||{}).map(([k,vs])=>(()=>{const groups=new Map();return vs.map((v,i)=>{const seq=v.reply_sequence;const key=seq?.id?'group:'+seq.id:'single:'+i;if(!groups.has(key))groups.set(key,groups.size+1);const label='分支 '+k+' · 版本 '+groups.get(key)+(seq?.id?' · 连续回复 '+(Number(seq.index)+1)+' · 组 '+seq.id:'');return article(v,'assistant',label);}).join('');})()).join('')+'</section>').join('');
        const voice=(voiceLinks.get(conv.id)||[]).flatMap(v=>byRecord.get(key(v))||[]);if(voice.length)body+='<section><h2>本窗口语音</h2>'+voice.map(m=>mediaHtml(m)).join('')+'</section>';
      }else if(x.kind==='library_books'){
        const cover=covers.get(data.id),m=cover&&byRecord.get(key(cover))?.[0],chs=chapters.get(data.id)||[],ns=notes.get(data.id)||[];
        body='<section class="book">'+(m?'<img class="cover" src="../'+esc(m.path)+'" alt="封面">':'')+'<div><h2>'+esc(data.title)+'</h2><small>'+esc(data.format)+'</small></div></section><section><h2>阅读位置</h2>'+((progress.get(data.id)||[]).map(p=>'<p>'+esc(p.data.author)+' · 第 '+(Number(p.data.chapter_index)+1)+' 分段</p>').join('')||'<p>暂无记录</p>')+'</section><section><h2>目录</h2><ul>'+chs.slice().sort((a,b)=>a.data.chapter_index-b.data.chapter_index).map(c=>'<li><a href="'+link(c)+'">'+esc(title(c))+'</a></li>').join('')+'</ul></section><section><h2>书页间的笔迹</h2>';
        for(const n of ns.slice().sort((a,b)=>Number(b.data.created_at)-Number(a.data.created_at))){
          const v=(await load(n.row)).data,c=chs.find(c=>c.data.chapter_index===v.chapter_index);
          body+='<article><small>'+esc(v.author)+' · '+esc(title(n))+' · '+esc(time(v.created_at))+'</small>'+(v.updated_at&&v.updated_at!==v.created_at?'<small> · 编辑于 '+esc(time(v.updated_at))+'</small>':'')+(v.quote?'<blockquote>'+esc(v.quote)+'</blockquote>':'')+'<p>'+esc(v.body)+'</p>'+(c&&Number.isInteger(v.paragraph_index)?'<a href="'+link(c,'#p-'+v.paragraph_index)+'">回到原文</a>':v.kind==='reflection'?'<small>整本书的读后感</small>':'')+'</article>';
        }
        body+='</section>';
      }else if(x.kind==='library_chapters'){
        const book=books.get(data.book_id);
        body=(book?'<a href="'+link(book)+'">返回阅读档案</a>':'')+String(data.body||'').split(/\n\s*\n/).map(s=>s.trim()).filter(Boolean).map((s,i)=>'<p id="p-'+i+'">'+esc(s)+'</p>').join('');
      }else if(x.kind==='vault_stickers'){
        const m=attachments.get(data.conversation_id+':'+data.attachment_id);
        if(!m)warnings.push('表情包原件未匹配：'+data.id);
        body='<article><small>'+esc(data.author==='assistant'?'模型添加':'屋主添加')+' · '+(Number(data.enabled)===1?'已启用':'已停用')+' · '+esc(time(data.created_at))+'</small><p>'+esc(data.description)+'</p>'+(m?mediaHtml(m):'<p>原件未归档。</p>')+'</article>';
      }else if(x.kind==='vault_treasures'){
        const lookup=data.conversation_id+':'+data.source_id,m=data.kind==='audio'?voices.get(lookup):attachments.get(lookup),chat=chatLinks.get(data.conversation_id);
        body='<article><small>'+esc(data.kind)+' · '+esc(time(data.created_at))+'</small><p>'+esc(data.excerpt)+'</p><p>'+esc(data.notes)+'</p>'+(m?mediaHtml(m):'')+(chat?'<a href="'+link(chat)+'">回到来源窗口</a>':'')+'</article>';
      }else body='<section><pre>'+esc(JSON.stringify(data,null,2))+'</pre>'+(byRecord.get(key(x))||[]).map(m=>mediaHtml(m)).join('')+'</section>';
      const deps=x.row.dependencies.map(k=>indexed.get(k)).filter(Boolean);
      await text(x.path,page(title(x),'<a href="../index.html">返回归档</a><h1>'+esc(title(x))+'</h1>'+body+(deps.length?'<details><summary>关联资料</summary><ul>'+deps.map(d=>'<li><a href="'+link(d)+'">'+esc(title(d))+'</a></li>').join('')+'</ul></details>':'')+'<p><a href="'+x.index+'.json">结构化记录</a></p>'));
      await text(x.json,JSON.stringify({kind:x.kind,data}));
    }
    if(device)await text('device.json',JSON.stringify(device));
    const meta={format:'elementera-coast-offline-html',version:2,restore_supported:false,workspace:manifest.workspace,exported_at:manifest.exported_at,source_coverage:manifest.modules,excluded_modules:manifest.modules.filter(m=>m.coverage==='unavailable').map(m=>m.module),warnings:[...new Set(warnings)],media:[...byHash].map(([object_sha256,path])=>({object_sha256,path})),records:items.map(x=>({module:x.row.module,id:x.row.id,kind:x.kind,path:x.path,json:x.json,media:(byRecord.get(key(x))||[]).map(m=>m.path)}))};
    const nav=manifest.modules.map(m=>'<section><h2>'+esc(labels[m.module]||m.module)+'</h2><small>'+m.count+' 项 · '+esc(m.coverage)+'</small><ul>'+items.filter(x=>x.row.module===m.module&&(m.module!=='library'||x.kind==='library_books')).map(x=>'<li><a href="'+x.path+'">'+esc(title(x))+'</a></li>').join('')+'</ul></section>').join('');
    await text('data.json',JSON.stringify(meta));await text('manifest.json',JSON.stringify(meta));
    await text('index.html',page('离线归档','<h1>离线海岸</h1><p>由已校验的 V2 记录生成 · 只读，不是恢复包。</p><p>'+esc(manifest.exported_at)+'</p><p>partial 表示源采集范围尚未声明完整；空记录与未采集不同。</p><p><a href="manifest.json">归档清单</a>'+(device?' · <a href="device.json">显示设置</a>':'')+'</p>'+meta.warnings.map(w=>'<p>'+esc(w)+'</p>').join('')+nav));
    await zip.finish();return {warnings:meta.warnings,mediaCount:byHash.size};
  }catch(e){await zip.abort().catch(()=>{});throw e;}
}
let active=false;
export async function saveOfflineV2({applicationId,filename,ownerLabel,device,onProgress}){
  if(active)throw Error('已有 HTML 导出正在进行。');active=true;
  let root,inputName,outputName,inputWriter,outputWriter,outputClosed=false;
  try{
    const target=typeof globalThis.showSaveFilePicker==='function'?await globalThis.showSaveFilePicker({suggestedName:filename,types:[{description:'离线阅读 ZIP',accept:{'application/zip':['.zip']}}]}):null;
    if(!navigator.storage?.getDirectory)throw Error('当前浏览器不支持大文件临时存储，请使用 Native 导出。');
    root=await navigator.storage.getDirectory();inputName='coast-reading-source-'+crypto.randomUUID()+'.zip';
    const input=await root.getFileHandle(inputName,{create:true});inputWriter=await input.createWritable();
    await collectArchiveV2({applicationId,onProgress,sink:{write:b=>inputWriter.write(b),close:()=>inputWriter.close(),abort:()=>inputWriter.abort()}});
    inputWriter=null;
    const source=await openArchiveV2(await input.getFile(),m=>archiveV2Transport.validateManifest(m));
    let output=target;
    if(!output){outputName='coast-reading-output-'+crypto.randomUUID()+'.zip';output=await root.getFileHandle(outputName,{create:true});}
    outputWriter=await output.createWritable();
    const result=await writeOfflineV2(source,{write:b=>outputWriter.write(b),close:async()=>{await outputWriter.close();outputClosed=true;},abort:()=>outputWriter.abort()},{ownerLabel,device});
    if(outputName){
      const url=URL.createObjectURL(await output.getFile()),a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();
      const name=outputName;setTimeout(()=>{URL.revokeObjectURL(url);root.removeEntry(name).catch(()=>{});},120000);outputName=null;
    }
    return result;
  }finally{
    if(inputWriter)await inputWriter.abort().catch(()=>{});
    if(outputWriter&&!outputClosed)await outputWriter.abort().catch(()=>{});
    if(root&&inputName)await root.removeEntry(inputName).catch(()=>{});
    if(root&&outputName)await root.removeEntry(outputName).catch(()=>{});
    active=false;
  }
}
