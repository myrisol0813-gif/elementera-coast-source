import {mountRestHistory} from './rest-history-view.mjs';
const make=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n};
const button=(text,fn)=>{const b=make('button',null,text);b.type='button';b.addEventListener('click',fn);return b};
export const SCENE_RATIOS=Object.freeze([.28,2/3,.83]);
export function snapSceneRatio(v){if(!Number.isFinite(v))return SCENE_RATIOS[1];return SCENE_RATIOS.reduce((a,b)=>Math.abs(a-v)<=Math.abs(b-v)?a:b)}
// An adapter supplies actual committed state and authenticated send/navigation methods.
// No demo response, model decision, auto note, or timer is generated here.
export function mountRestBoxShell(root,adapter){
  const top=make('header','rb-top'),rooms=make('nav','rb-rooms'),scene=make('div','rb-scene'),divider=make('div','rb-divider'),lower=make('section','rb-lower'),status=make('div','rb-status'),tabbar=make('nav','rb-tabs'),content=make('div','rb-content'),composer=make('form','rb-composer'),input=make('textarea'),error=make('p','rb-error'),menu=make('details','rb-menu'),summary=make('summary',null,'设置');
  let ratio=snapSceneRatio(adapter.getRatio?.()),tab='interact',drag=null,disposed=false,history=null,renderSeq=0,sending=false,keyboard=false;
  root.classList.add('rb-shell');menu.append(summary,button('动物形象',()=>{menu.open=false;adapter.openAppearance?.()}),button('布置房间',()=>{menu.open=false;adapter.openFurniture?.()}));
  top.append(make('strong',null,adapter.title??'休憩箱'),menu);
  divider.tabIndex=0;divider.setAttribute('role','separator');divider.setAttribute('aria-orientation','horizontal');divider.setAttribute('aria-label','调整房间高度');
  input.rows=2;input.placeholder='说点什么……';input.setAttribute('aria-label','箱内相处消息');
  const send=make('button',null,'发送');send.type='submit';composer.append(input,send);
  lower.append(status,tabbar,content,error,composer);root.replaceChildren(top,rooms,scene,divider,lower);
  function applyRatio(v){root.style.setProperty('--rb-scene-ratio',String(v));divider.setAttribute('aria-valuenow',String(Math.round(v*100)))}
  function setRatio(v,save){ratio=snapSceneRatio(v);applyRatio(keyboard?SCENE_RATIOS[0]:ratio);if(save)adapter.saveRatio?.(ratio)}
  function handleResize(){const vv=globalThis.visualViewport;keyboard=!!vv&&globalThis.innerHeight-vv.height>140&&document.activeElement===input;applyRatio(keyboard?SCENE_RATIOS[0]:ratio)}
  divider.addEventListener('pointerdown',e=>{if(keyboard)return;drag={id:e.pointerId};divider.setPointerCapture(e.pointerId);e.preventDefault()});
  divider.addEventListener('pointermove',e=>{if(drag?.id!==e.pointerId)return;const b=root.getBoundingClientRect(),topY=scene.getBoundingClientRect().top;applyRatio(Math.max(.2,Math.min(.85,(e.clientY-topY)/Math.max(1,b.bottom-topY))))});
  divider.addEventListener('pointerup',e=>{if(drag?.id!==e.pointerId)return;drag=null;const b=root.getBoundingClientRect(),topY=scene.getBoundingClientRect().top;setRatio((e.clientY-topY)/Math.max(1,b.bottom-topY),true)});
  divider.addEventListener('pointercancel',()=>{drag=null;applyRatio(ratio)});
  divider.addEventListener('keydown',e=>{if(!['ArrowUp','ArrowDown','Home','End'].includes(e.key))return;e.preventDefault();const i=SCENE_RATIOS.indexOf(ratio);setRatio(SCENE_RATIOS[e.key==='Home'?0:e.key==='End'?2:Math.max(0,Math.min(2,i+(e.key==='ArrowUp'?-1:1)))],true)});
  input.addEventListener('focus',handleResize);input.addEventListener('blur',()=>{keyboard=false;applyRatio(ratio)});
  globalThis.visualViewport?.addEventListener('resize',handleResize);
  function setTab(id){if(history){history.dispose();history=null}tab=id;refresh()}
  async function refresh(){
    if(disposed)return;const ticket=++renderSeq;let s;
    try{s=adapter.getView();}catch(e){error.textContent=e.message;return}
    rooms.replaceChildren(...s.rooms.map(r=>{const b=button(r.name,()=>{adapter.selectRoom(r.id);refresh()});b.setAttribute('aria-pressed',String(r.id===s.roomId));return b}));
    status.textContent=s.status??'尚未回箱';tabbar.replaceChildren(...[['interact','相处'],['history','便签与历史']].map(([id,name])=>{const b=button(name,()=>setTab(id));b.setAttribute('aria-pressed',String(id===tab));return b}));
    composer.hidden=tab!=='interact';send.disabled=sending||!s.canSend||typeof adapter.send!=='function';input.disabled=!s.canSend;
    if(tab==='history'){if(history)history.refresh();else history=mountRestHistory(content,adapter.history)}
    else {content.replaceChildren();for(const line of s.lines??[]){const row=make('article','rb-line');row.append(make('small',null,line.label),make('div',null,line.body));content.append(row)}}
    try{await adapter.renderScene(scene,s);if(ticket!==renderSeq||disposed)return;}catch(e){if(ticket===renderSeq&&!disposed)error.textContent=e.message}
  }
  composer.addEventListener('submit',async e=>{e.preventDefault();const text=input.value.trim();if(!text||sending||send.disabled)return;sending=true;send.disabled=true;error.textContent='';
    try{await adapter.send(text);if(input.value.trim()===text)input.value=''}catch(e){error.textContent=e.message}finally{sending=false;refresh()}});
  setRatio(ratio,false);refresh();
  return {refresh,dispose(){disposed=true;renderSeq++;history?.dispose();globalThis.visualViewport?.removeEventListener('resize',handleResize);adapter.disposeScene?.();root.replaceChildren()}};
}
