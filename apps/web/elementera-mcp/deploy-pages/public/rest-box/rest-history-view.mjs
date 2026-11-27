import {readNotes} from './note-cycle-state.mjs';
import {readCycleHistory,noteSourceLink} from './rest-history.mjs';
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n};
const format=t=>new Date(t).toLocaleString();
function button(text,fn){const b=el('button',null,text);b.type='button';b.onclick=fn;return b}
function noteCard(n,onSource,resolveSource){
  const card=el('article','rest-note-card');
  card.append(el('div','rest-note-meta',[n.action==='enter'?'入箱便签':n.action==='exit'?'离箱便签':'普通便签',n.source.windowName,n.source.modelId,format(n.source.at)].join(' · ')),el('div','rest-note-body',n.body));
  const target=noteSourceLink(n,resolveSource);
  if(target&&onSource)card.append(button('回到原文',()=>onSource(target)));
  return card;
}
export function mountRestHistory(root,{getState,getConfig,getVisibleWindowIds,resolveSource,onSource}){
  let type='all',mode='notes',cursor=null,rows=[];
  const top=el('div','rest-history-tabs'),filters=el('div','rest-history-tabs'),search=el('input','rest-history-search'),list=el('div','rest-history-list'),status=el('div','rest-note-meta'),more=button('更多',()=>refresh(true));
  search.type='search';search.placeholder='搜索便签';search.setAttribute('aria-label','搜索便签');
  root.replaceChildren(top,search,filters,list,status,more);
  function refresh(append=false){
    try{
      const state=getState(),visible=getVisibleWindowIds();if(!append){cursor=null;rows=[];}
      const page=mode==='notes'?readNotes(state,getConfig(),{type,keyword:search.value,before:cursor,limit:20},visible):readCycleHistory(state,visible,{before:cursor,limit:20});
      rows.push(...page.items);cursor=page.next;more.hidden=!cursor;list.replaceChildren();
      if(mode==='notes')for(const n of rows)list.append(noteCard(n,onSource,resolveSource));
      else for(const c of rows){
        const card=el('article','rest-note-card');card.append(el('strong',null,c.active?'当前休憩周期':'历史休憩周期'));
        for(const [label,b] of [['入箱',c.entry],['离箱',c.exit]]){
          if(!b)continue;
          if(b.restricted){card.append(el('p','rest-note-meta',label+' · 来源不可访问'));continue}
          card.append(el('p','rest-note-meta',label+' · '+format(b.source.at)+' · '+b.tags.emotion+' / '+b.tags.energy));
          if(b.reason)card.append(el('p','rest-note-body',b.reason));
          if(b.note)card.append(noteCard(b.note,onSource,resolveSource));
          if(Number.isFinite(b.elapsedMs))card.append(el('p','rest-note-meta','经过 '+Math.round(b.elapsedMs/60000)+' 分钟'));
        }
        for(const e of c.events)card.append(el('p','rest-note-meta',format(e.at)+' · '+({interaction:'相处事件',dialogue:'对话记录',action:'动作',state:'状态更新'}[e.kind]??'记录')+' · '+e.refId));
        list.append(card);
      }
      status.textContent=rows.length?'':'暂无记录';
    }catch(e){list.replaceChildren();status.textContent=e.message;more.hidden=true;}
  }
  function tabs(){
    top.replaceChildren(...[['notes','便签'],['cycles','休憩历史']].map(([id,label])=>{const b=button(label,()=>{mode=id;tabs();refresh()});b.setAttribute('aria-pressed',String(mode===id));return b}));
    filters.replaceChildren(...[['all','全部'],['ordinary','普通'],['rest','出入箱']].map(([id,label])=>{const b=button(label,()=>{type=id;tabs();refresh()});b.setAttribute('aria-pressed',String(type===id));return b}));
    search.hidden=filters.hidden=mode!=='notes';
  }
  search.oninput=()=>refresh();tabs();refresh();
  return {refresh:()=>refresh(),dispose(){root.replaceChildren()}};
}
