import { API, requestJson } from '../core/api.js';
import { escapeHtml, escapeAttribute } from '../core/dom.js';
import { importBookFile } from './library-import.js';
import { uploadTidalBook } from './library-upload.js';
import { uploadTidalCover } from './library-cover.js';
import { paginateReaderParagraphs, readerPageForParagraph, READER_SIZES, READER_COLORS } from './library-pages.js';
import { renderTidalReader, attachTidalSelection } from './library-reader.js';

const BASE=API.tidalLibrary;
const dateLabel=t=>new Date(t).toLocaleDateString('zh-CN');
const quote=value=>escapeHtml(String(value||'').slice(0,210));
const authorLabel=a=>a==='owner'?'用户':'助手';
const button=(action,label,attrs='')=>`<button type="button" data-action="library:${action}" ${attrs}>${label}</button>`;
export function createTidalLibrary({router,toast}) {
  const ownsRoute=route=>['library-home','library-chapter','library-notes','library-note'].includes(route?.name);
  const memo={books:[],book:null,notes:[],chapters:new Map(),selection:null,readerPage:0,readerIndex:0,limits:null};
  const reader={ theme:'paper',fontSize:15 };
  try {
    const settings=JSON.parse(localStorage.getItem('coast-tidal-reader')||'{}');
    if(READER_COLORS.includes(settings.theme))reader.theme=settings.theme;
    if([14,15,16,17].includes(settings.fontSize))reader.fontSize=settings.fontSize;
  }catch {}
  async function loadBook(bookId) {
    const [b,n]=await Promise.all([
      requestJson(`${BASE}/books/${encodeURIComponent(bookId)}`),
      requestJson(`${BASE}/books/${encodeURIComponent(bookId)}/notes`),
    ]);
    memo.book=b.book;memo.notes=n.notes||[];
  }
  async function homeView() {
    const response=await requestJson(`${BASE}/books`);
    memo.books=response.books||[];memo.limits=response.limits||null;
    return { title:'书房',subtitle:'电子书与阅读笔记',className:'tidal-library',
      headerAction:button('choose','＋','class="feature-head-action tidal-library-add" aria-label="导入书籍" title="导入 EPUB 或 TXT 电子书"'),
      body:`<section class="tidal-library-home">
        <p class="tidal-library-intro">这里是你的书房，可以保存阅读进度与笔记。</p><details class="tidal-library-limits"><summary>EPUB / TXT · 导入须知</summary>最多 80 本书；源文件最多 40 MB；正文最多 1,200 万字、2,048 个正文分段。批注最多 4,000 字，封面会压缩至 600 KB 内。暂不保留复杂版式和图片。</details>
        <div class="tidal-library-shelf">${memo.books.map(b=>{
          const chapter=Number.isInteger(b.reader_chapter_index)?b.reader_chapter_index:0;
          const percent=b.reader_chapter_index==null?0:Math.round((chapter+1)/(b.chapters_count||1)*100);
          return `<article class="tidal-library-entry"><button type="button" class="tidal-library-cover" data-action="library:cover" data-book="${escapeAttribute(b.id)}" aria-label="上传或更换封面">${b.has_cover?'<img src="'+escapeAttribute(`${BASE}/books/${encodeURIComponent(b.id)}/cover`)+'" loading="lazy" alt="书籍封面" />':'＋'}</button><button type="button" class="tidal-library-book" data-action="library:continue" data-book="${escapeAttribute(b.id)}" data-index="${chapter}" data-paragraph="${b.reader_paragraph_index||0}">
            <span class="tidal-library-book-spine">✦</span><span class="tidal-library-book-meta">
              <strong>${escapeHtml(b.title)}</strong><small>${escapeHtml(b.format.toUpperCase())} · ${b.chapters_count} 个正文分段</small>
              <span class="tidal-library-track"><i style="width:${percent}%"></i></span>
              <small>阅读进度：${b.reader_chapter_index==null?'尚未开始':`第 ${chapter+1} / ${b.chapters_count} 章`} · 按章节显示</small>
              <span class="tidal-library-reader-count">用户 <small>${b.owner_notes||0} 条批注与读后感</small></span>
              <span class="tidal-library-reader-count">助手 <small>${b.assistant_notes||0} 条批注与读后感</small></span>
            </span></button></article>`;
        }).join('')||'<p class="feature-empty">书架还空着。点右上角的 ＋，导入一本喜欢的书吧。</p>'}</div>
      </section>` };
  }
  function noteCard(n) {
    const anchor=n.kind==='annotation' ? button('jump',`<u>${quote(n.quote)}</u>`,`data-book="${escapeAttribute(n.book_id)}" data-index="${n.chapter_index}" data-paragraph="${n.paragraph_index}"`) : '';
    const editable=n.author==='owner' ? `<div class="tidal-library-note-actions">
      ${button('edit','编辑',`data-id="${escapeAttribute(n.id)}" data-book="${escapeAttribute(n.book_id)}"`)}
      ${button('delete-note','删除',`data-id="${escapeAttribute(n.id)}" data-book="${escapeAttribute(n.book_id)}"`)}
    </div>` : '';
    return `<article class="tidal-library-note">
      <small>${authorLabel(n.author)} · ${n.kind==='annotation'?'书页批注':'读后感'} · ${dateLabel(n.created_at)}</small>
      ${anchor}<p>${escapeHtml(n.body)}</p>${editable}
    </article>`;
  }
  function saveReaderSettings(){
    try{localStorage.setItem('coast-tidal-reader',JSON.stringify(reader));}catch{}
  }
  async function readerChapter(bookId,index) {
    const key=`${bookId}:${index}`;
    if(!memo.chapters.has(key)){
      const result=await requestJson(`${BASE}/books/${encodeURIComponent(bookId)}/chapters/${index}/text`);
      memo.chapters.set(key,result.chapter);
    }
    return memo.chapters.get(key);
  }
  async function openReader(bookId,index=0,paragraph=0){
    const chapter=await readerChapter(bookId,index);
    const pages=paginateReaderParagraphs(chapter.paragraphs,reader.fontSize===14?620:reader.fontSize===15?520:reader.fontSize===16?440:380);
    return router.open('library-chapter',{bookId,index,page:readerPageForParagraph(pages,paragraph),focus:paragraph});
  }
  function readerBubble(root,content,rect){
    root.querySelector('.tidal-reader-popover')?.remove();
    const pop=document.createElement('div');
    pop.className='tidal-reader-popover';pop.innerHTML=content;
    const left=Math.max(12,Math.min(window.innerWidth-240,rect?.left??32));
    const top=Math.max(76,(rect?.top??170)-52);
    pop.style.left=`${left}px`;pop.style.top=`${top}px`;
    root.append(pop);
  }
  async function chapterView({bookId,index=0,page=0,focus=-1}) {
    index=Number(index)||0;
    if(!memo.book||memo.book.id!==bookId)await loadBook(bookId);
    else memo.notes=(await requestJson(`${BASE}/books/${encodeURIComponent(bookId)}/notes`)).notes||[];
    const chapter=await readerChapter(bookId,index);
    const budget=reader.fontSize===14?620:reader.fontSize===15?520:reader.fontSize===16?440:380;
    const pages=paginateReaderParagraphs(chapter.paragraphs,budget);
    const selectedPage=Number(focus)>=0?readerPageForParagraph(pages,Number(focus)):Math.min(Math.max(0,Number(page)||0),pages.length-1);
    memo.readerIndex=index;memo.readerPage=selectedPage;
    const visible=pages[selectedPage];
    if(visible.length){
      try{await requestJson(`${BASE}/books/${encodeURIComponent(bookId)}/progress`,{method:'POST',body:JSON.stringify({
        chapter_index:index,paragraph_index:visible.at(-1).paragraph,
      })});}catch(error){toast(`阅读进度暂未保存：${error.message||'连接失败'}`,2800);}
    }
    return {title:memo.book.title,subtitle:'书房 · 翻页阅读',className:'tidal-library tidal-reader-route',
      headerAction:button('notes','阅读笔记',`class="feature-head-action" data-book="${escapeAttribute(bookId)}"`),
      body:renderTidalReader({book:memo.book,chapterTitle:chapter.chapter_title,chapterIndex:index,pages,pageIndex:selectedPage,notes:memo.notes,theme:reader.theme,fontSize:reader.fontSize}),
      afterRender(root){
        for(const [selector,field,allowed] of [['.tidal-reader-color','theme',READER_COLORS],['.tidal-reader-size','fontSize',[14,15,16,17]]]){
          root.querySelector(selector)?.addEventListener('change',event=>{
            const val=field==='fontSize'?Number(event.target.value):event.target.value;
            if(!allowed.includes(val))return;
            reader[field]=val;saveReaderSettings();
            void openReader(bookId,index,visible[0]?.paragraph??0);
          });
        }
        attachTidalSelection(root,info=>{
          if(info.action==='swipe'){
            const desired=selectedPage+info.direction;
            if(desired>=0&&desired<pages.length)void router.open('library-chapter',{bookId,index,page:desired},{replace:true});
            else if(desired<0 && index>0)void router.open('library-chapter',{bookId,index:index-1,page:99999},{replace:true});
            else if(desired>=pages.length && index<memo.book.chapters.length-1)
              void router.open('library-chapter',{bookId,index:index+1,page:0},{replace:true});
            return;
          }
          memo.selection={...info,bookId,index,page:selectedPage};
          readerBubble(root,
            button('copy-selected','复制')+button('highlight-selected','划线'),info.rect);
        });
      }
    };
  }
  async function notesView({bookId}) {
    await loadBook(bookId);
    const both=['owner','assistant'].map(author=>`<section class="tidal-library-notes-group"><h2>${authorLabel(author)}的笔记</h2>
      ${memo.notes.filter(n=>n.author===author && n.kind!=='highlight').map(noteCard).join('')||'<p class="feature-empty">还没有留下笔记。</p>'}</section>`).join('');
    return {title:'批注与读后感',subtitle:memo.book.title,className:'tidal-library',
      body:`<section class="tidal-library-notes">
        ${both}
        ${button('reflect','＋ 写一篇读后感',`class="tidal-library-primary" data-book="${escapeAttribute(bookId)}"`)}
        ${button('delete-book','删除这本书与全部笔记',`class="tidal-library-danger" data-book="${escapeAttribute(bookId)}"`)}
      </section>`};
  }
  async function noteView({bookId,kind='annotation',index=0,paragraph=0,id=''}) {
    if(id && !memo.notes.some(n=>n.id===id)) await loadBook(bookId);
    const existing=memo.notes.find(n=>n.id===id);
    const label=existing?.kind==='reflection'||kind==='reflection'?'读后感':'书页批注';
    return {title:id?'修改'+label:'写'+label,subtitle:'此处保存你的阅读笔记',className:'tidal-library',
      body:`<section class="tidal-library-editor">
        <label>正文 · 最多 4000 字<textarea id="tidalLibraryNoteBody" maxlength="4000" rows="9" placeholder="写下你的理解与感受……">${escapeHtml(existing?.body||'')}</textarea></label>
        ${button('save-note','收好这张纸',`class="tidal-library-primary" data-book="${escapeAttribute(bookId)}" data-kind="${label==='读后感'?'reflection':'annotation'}" data-index="${index}" data-paragraph="${paragraph}" data-id="${escapeAttribute(id)}"`)}
      </section>`};
  }
  async function chooseFile() {
    const input=document.createElement('input');
    input.type='file';input.accept='.txt,.epub,text/plain,application/epub+zip';
    input.addEventListener('change',async()=>{
      const file=input.files?.[0];if(!file)return;
      toast('正在整理电子书正文…',2800);
      try{
        const data=await importBookFile(file);
        const book=await uploadTidalBook({base:BASE,book:data,requestJson,
          onProgress:(current,total)=>{
            if(current===total || current%40<8)toast(`正在收书：${current} / ${total} 个正文分段`,1600);
          },
        });
        toast('整本书已核对完整，放上潮中书架了。');
        await openReader(book.id,0,0);
      }catch(e){toast(`导入失败：${e.message||'文件无法阅读。'}`,6000);}
    },{once:true});
    input.click();
  }
  async function handleEvent(_event,context) {
    const name=context.name,t=context.target,d=t.dataset;
    if(name==='open')return router.open('library-home');
    if(name==='from-furniture')return d.annotation==='true'
      ?openReader(d.book,Number(d.index)||0,Number(d.paragraph)||0)
      :router.open('library-notes',{bookId:d.book});
    if(name==='choose')return chooseFile();
    if(name==='cover'){
      const input=document.createElement('input');input.type='file';input.accept='image/jpeg,image/png';
      input.addEventListener('change',async()=>{
        const file=input.files?.[0];if(!file)return;
        try{await uploadTidalCover(BASE,d.book,file);toast('封面已保存。');await router.refresh({preserveScroll:true});}
        catch(error){toast(`封面上传失败：${error.message}`,4200);}
      },{once:true});
      input.click();return;
    }
    if(name==='continue')return openReader(d.book,Number(d.index)||0,Number(d.paragraph)||0);
    if(name==='chapter')return openReader(d.book,Number(d.index)||0,0);
    if(name==='page')return router.open('library-chapter',{bookId:d.book,index:Number(d.index),page:Number(d.page)},{replace:true});
    if(name==='copy-selected'){
      if(!memo.selection)return toast('先在原文里选中一段文字。');
      try{await navigator.clipboard.writeText(memo.selection.text);toast('原文已复制。');}
      catch{toast('复制失败，请使用系统文字选择菜单。');}
      document.querySelector('.tidal-reader-popover')?.remove();
      return;
    }
    if(name==='highlight-selected'){
      const chosen=memo.selection;
      if(!chosen)return toast('先长按选中一段原文。');
      try{await requestJson(`${BASE}/books/${encodeURIComponent(chosen.bookId)}/notes`,{method:'POST',body:JSON.stringify({
        kind:'highlight',chapter_index:chosen.index,paragraph_index:chosen.paragraph,
        start_offset:chosen.start_offset,end_offset:chosen.end_offset,
      })});
      memo.selection=null;
      window.getSelection()?.removeAllRanges();
      toast('这一段已经划好线。');
      return router.refresh({preserveScroll:false});
      }catch(error){return toast(`划线失败：${error.message}`,4200);}
    }
    if(name==='mark'){
      const note=memo.notes.find(n=>n.id===d.id);if(!note)return;
      const root=document.querySelector('#overlayRoot');
      const rect=t.getBoundingClientRect();
      const by=note.author==='owner'?'用户':'助手';
      const text=note.body?`<p>${escapeHtml(note.body)}</p>`:'<p>这句原文已经划线。</p>';
      const action=note.author==='owner'
        ?button('annotate-mark',note.kind==='highlight'?'写批注':'编辑批注',`data-id="${escapeAttribute(note.id)}" data-book="${escapeAttribute(note.book_id)}"`) : '';
      readerBubble(root,`<small>${by} · ${escapeHtml(note.quote||'')}</small>${text}${action}`,rect);
      return;
    }
    if(name==='annotate-mark')return router.open('library-note',{bookId:d.book,id:d.id,index:memo.readerIndex,page:memo.readerPage});
    if(name==='notes')return router.open('library-notes',{bookId:d.book});
    if(name==='reflect')return router.open('library-note',{bookId:d.book,kind:'reflection'});
    if(name==='annotate')return router.open('library-note',{bookId:d.book,kind:'annotation',index:Number(d.index),paragraph:Number(d.paragraph)});
    if(name==='jump')return openReader(d.book,Number(d.index)||0,Number(d.paragraph)||0);
    if(name==='edit')return router.open('library-note',{bookId:d.book,id:d.id});
    if(name==='save-note'){
      const body=document.querySelector('#tidalLibraryNoteBody')?.value||'';
      if(!body.trim())return toast('写一点正文再保存。');
      try{
        if(d.id)await requestJson(`${BASE}/notes/${encodeURIComponent(d.id)}`,{method:'PATCH',body:JSON.stringify({body})});
        else await requestJson(`${BASE}/books/${encodeURIComponent(d.book)}/notes`,{method:'POST',
          body:JSON.stringify({body,kind:d.kind,chapter_index:Number(d.index),paragraph_index:Number(d.paragraph)})});
        toast('笔记已经留在书页边上。');
        if(d.kind==='annotation'&&d.id)return router.open('library-chapter',{bookId:d.book,index:memo.readerIndex,page:memo.readerPage},{replace:true});
        return router.open('library-notes',{bookId:d.book},{replace:true});
      }catch(e){return toast(`保存失败：${e.message}`,4500);}
    }
    if(name==='delete-note'){
      if(!confirm('确定删去你写的这条笔记吗？'))return;
      try{await requestJson(`${BASE}/notes/${encodeURIComponent(d.id)}`,{method:'DELETE'});
        toast('这条笔记已经删去。');return router.refresh();}
      catch(e){return toast(`删除失败：${e.message}`,4500);}
    }
    if(name==='delete-book'){
      if(!confirm('确定删除整本书及两个人在这里留下的全部批注和读后感吗？此操作无法恢复。'))return;
      try{await requestJson(`${BASE}/books/${encodeURIComponent(d.book)}`,{method:'DELETE'});
        toast('书籍与笔记已删除。');return router.open('library-home',{}, {replace:true});}
      catch(e){return toast(`删除失败：${e.message}`,4500);}
    }
  }
  router.register('library-home',homeView);
  router.register('library-chapter',chapterView);
  router.register('library-notes',notesView);
  router.register('library-note',noteView);
  return Object.freeze({
    id:'library',priority:72,mountOrder:66,ownsRoute,
    ownsEvent(_event,ctx){return ctx.namespace==='library'&&ctx.eventType==='click'?{preventDefault:true}:false;},
    handleEvent, mount(){},refresh(){},destroy(){},
  });
}
