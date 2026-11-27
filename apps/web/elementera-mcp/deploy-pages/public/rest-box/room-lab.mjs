import {newHousehold,restoreHousehold} from './creature-state.mjs';
import {mountCreatureEditor} from './creature-editor.mjs';
import {loadArt,createRoomRenderer} from './room-renderer.mjs';
import {newLayout,editLayout,restoreLayout,roomPreviewSlots,previewOccupants} from './room-state.mjs';
export async function mountRoomStudio(host){
const root=host.shadowRoot??host.attachShadow({mode:'open'});
root.innerHTML=`<style>:host{display:block;color:var(--text,#202123);font:inherit;min-width:0}*{box-sizing:border-box}[hidden]{display:none!important}main{width:100%;max-width:660px;margin:0 auto;padding:0 0 18px}h2{font-size:.9em;margin:14px 0 7px}button,input,select{font:inherit;color:inherit}button,select{background:var(--surface,#fff);border:1px solid var(--line,#ddd);border-radius:12px;padding:8px;min-width:0}button[aria-pressed=true]{background:var(--surface-soft,#eee);border-color:var(--accent,#777)}button:disabled{opacity:.5}button{cursor:pointer}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid var(--accent,#777);outline-offset:2px}.row{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:8px 0}.tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin:8px 0}#scene{background:var(--surface-soft,#eee);width:100%;aspect-ratio:400/380;position:relative;overflow:hidden;margin:0 auto;max-width:660px}#scene img[data-instance]{cursor:grab}#scene.editing img[data-instance]{touch-action:none}.list button{width:100%;text-align:left;margin-bottom:4px}.catalog{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.catalog button{font-size:11px;padding:4px;overflow-wrap:anywhere}.catalog img{width:100%;height:72px;object-fit:contain;display:block}.muted{font-size:11px;color:var(--text-soft,#777);line-height:1.65}.palette{display:flex;align-items:center;gap:6px}.palette input{width:32px;height:30px;padding:0;border:0}.error{color:var(--danger,#b44)}#status{min-height:1.4em}input[type=range]{max-width:120px}.creature-preview{height:220px;width:100%;object-fit:contain;display:block}.creature-panes{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.creature-slots{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.creature-editor-box,#editor,#fileMenu{background:var(--surface,#fff);border:1px solid var(--line,#ddd);border-radius:16px;padding:12px;margin:10px 0}#fileMenu[hidden]{display:none!important}</style><main><div class="tabs" id="rooms"></div><div id="scene"></div><div class="row"><button id="edit">布置房间</button><button id="pets">坐卧演示</button><button id="motion">暂停动画</button><button id="appearance">动物形象</button><button id="more" aria-expanded="false">更多</button></div><div class="row" id="poseSlots" hidden></div><p id="status" aria-live="polite" class="muted"></p>
<section id="creatureEditor" hidden></section><section id="editor" hidden><div class="row"><strong id="selected">未选中家具</strong></div><div class="row"><label>大小 <input type="range" id="scale" min=".1" max="4" step=".05"></label><button data-op="mirror">镜像</button><button data-op="copy">复制</button><button data-op="visible">隐藏/显示</button><button data-op="delete">移除</button></div><div class="row"><button data-layer="top">置顶</button><button data-layer="up">上移</button><button data-layer="down">下移</button><button data-layer="bottom">置底</button></div><div class="row" id="colors"></div><h2>图层 · 前景在上</h2><div id="layers" class="list"></div><h2>家具库</h2><div id="families" class="row"></div><div id="catalog" class="catalog"></div></section>
<div class="row" id="fileMenu" hidden><button id="export">导出房间与形象</button><button id="importButton">导入房间与形象</button><input hidden id="import" type="file" accept=".json,application/json"><button id="reset">恢复本房默认</button></div><p class="muted">独立美术空间。房间与动物形象自动保存在当前设备的浏览器空间，可导出 JSON 备份。所有试穿、动作与坐卧只用于美术预览，不产生真实模型活动或互动记录。家具采用内置原稿。</p></main>`;
const $=id=>root.getElementById(id);
let disposed=false;
const dispose=()=>{disposed=true;renderer?.dispose();root.replaceChildren()};
host.studioDispose=dispose;
const labels={living:'客厅',study:'书房',bedroom:'卧室',extras:'新家具'};
const btn=(label,fn,pressed)=>{const b=document.createElement('button');b.type='button';b.textContent=label;if(pressed!==undefined)b.setAttribute('aria-pressed',String(pressed));b.addEventListener('click',fn);return b};
let art,cat,state,renderer,household,creatureEditor,room='living',family='living',editing=false,selected=null,pets=true,drag=null,reducedMotion=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches??false,poseChoices={};
function message(s,error=false){$('status').textContent=s;$('status').classList.toggle('error',error)}
const studioKey='rest-box.studio.v1';
let storageWarning='',restoreFailed=false;
function saveStudio(){
 if(restoreFailed)return;
 try{localStorage.setItem(studioKey,JSON.stringify({version:1,layout:state,household,room,pets,reducedMotion,poseChoices}));storageWarning='';}
 catch(_){storageWarning=' · 本机保存失败，请导出备份';}
}
function restoreStudio(){
 try{const raw=JSON.parse(localStorage.getItem(studioKey)??'null');if(!raw)return;
  if(raw.version!==1)throw Error('不支持的造物间存档版本');
  const layout=restoreLayout(raw.layout,cat),appearance=restoreHousehold(raw.household,art.appearance);
  state=layout;household=appearance;
  if(Object.hasOwn(cat.rooms,raw.room))room=raw.room;
  if(typeof raw.pets==='boolean')pets=raw.pets;
  if(typeof raw.reducedMotion==='boolean')reducedMotion=raw.reducedMotion;
  if(raw.poseChoices&&typeof raw.poseChoices==='object'){
   for(const id of Object.keys(cat.rooms)){
    const src=raw.poseChoices[id];if(!src||typeof src!=='object')continue;
    const allowed=new Set(['','none',...roomPreviewSlots(state,cat,id).map(s=>s.key)]);
    poseChoices[id]=Object.fromEntries(['model','human'].filter(role=>allowed.has(src[role])).map(role=>[role,src[role]]));
   }
  }
 }catch(_){restoreFailed=true;storageWarning=' · 旧存档读取失败，已停止覆盖，请先导出备份或导入有效存档';}
}
function savedStatus(){message(labels[room]+' · '+state.rooms[room].length+' 件家具'+storageWarning,Boolean(storageWarning))}
function chosen(){return state.rooms[room].find(i=>i.id===selected)}
function uid(){return 'i-'+crypto.randomUUID()}
function edit(op){try{state=editLayout(state,cat,room,op);if(op.type==='delete'||op.type==='reset')selected=null;if(op.type==='copy')selected=op.newId;if(op.type==='add')selected=op.id;saveStudio();refresh()}catch(e){message(e.message,true)}}
function occupancy(){return pets?previewOccupants(state,cat,room,household,poseChoices[room]??{}):[]}
function slotPicker(){
  const root=$('poseSlots');root.hidden=!pets;root.replaceChildren();if(!pets)return;
  const slots=roomPreviewSlots(state,cat,room),used=occupancy();
  for(const role of ['model','human']){
    if(role==='human'&&!household.humanEnabled)continue;
    const label=document.createElement('label');label.textContent=role==='model'?'模型动物 ':'我的动物 ';
    const select=document.createElement('select');const opts=[['','自动选择'],['none','不展示'],...slots.map(s=>[s.key,s.name+' · '+(s.action==='sleep'?'睡觉':'坐坐')+' · '+s.anchorId])];
    for(const [value,name] of opts){const option=document.createElement('option');option.value=value;option.textContent=name;select.append(option)}
    select.value=(poseChoices[room]??{})[role]??'';select.onchange=()=>{poseChoices[room]={...poseChoices[room],[role]:select.value};saveStudio();savedStatus();slotPicker();draw()};label.append(select);root.append(label);
  }
}
async function draw(){if(disposed)return;try{await renderer.render(state,room,{occupants:occupancy(),selected,editing,household,reducedMotion})}catch(e){if(!disposed)message(e.message,true)}}
function refresh(){
  if(disposed)return;
  $('scene').style.aspectRatio=cat.rooms[room].width+'/'+cat.rooms[room].height;
  $('rooms').replaceChildren(...Object.keys(cat.rooms).map(id=>btn(labels[id],()=>{room=id;selected=null;saveStudio();refresh()},room===id)));
  $('editor').hidden=!editing;$('edit').textContent=editing?'完成':'布置房间';$('scene').classList.toggle('editing',editing);
  $('pets').setAttribute('aria-pressed',String(pets));$('motion').setAttribute('aria-pressed',String(reducedMotion));slotPicker();
  const item=chosen(),a=item&&cat.assets[item.assetId];$('selected').textContent=a?.name??(item?'素材缺失':'未选中家具');
  for(const e of root.querySelectorAll('[data-op],[data-layer],#scale'))e.disabled=!item;
  if(item)$('scale').value=item.scale;
  $('layers').replaceChildren(...[...state.rooms[room]].reverse().map(i=>btn((i.visible?'':'[隐藏] ')+(cat.assets[i.assetId]?.name??'素材缺失'),()=>{selected=i.id;refresh()},i.id===selected)));
  const colors=$('colors');colors.replaceChildren();
  if(a) {
    const names={upper:'鞋面',sole:'鞋底',primary:'主体',secondary:'次要'};
    for(const [k,v] of Object.entries(a.slots)){const label=document.createElement('label');label.className='palette';label.textContent=v.label??names[k]??k;const input=document.createElement('input');input.type='color';input.value=item.colors[k]??v.base;input.addEventListener('change',()=>edit({type:'color',id:item.id,values:{[k]:input.value}}));label.append(input);colors.append(label)}
    for(const p of a.presets)colors.append(btn(p.name,()=>edit({type:'color',id:item.id,values:p.values})));
    if(Object.keys(a.slots).length)colors.append(btn('恢复原色',()=>edit({type:'original',id:item.id})));
  }
  $('families').replaceChildren(...Object.keys(labels).map(id=>btn(labels[id],()=>{family=id;refresh()},family===id)));
  $('catalog').replaceChildren(...Object.values(cat.assets).filter(a=>a.family===family).map(a=>{const b=btn(a.name+(a.provisional?'（待核原稿）':''),()=>edit({type:'add',assetId:a.id,id:uid()}));const img=document.createElement('img');img.src=new URL('art/v1/'+a.file,import.meta.url).href;img.alt='';img.loading='lazy';b.prepend(img);return b}));
  savedStatus();draw();
}
try{
 art=await loadArt();if(disposed)return dispose;cat=art.catalogue;state=newLayout(cat);household=newHousehold(art.appearance);restoreStudio();renderer=createRoomRenderer($('scene'),art);
 creatureEditor=mountCreatureEditor($('creatureEditor'),art,()=>household,next=>{household=next;saveStudio();savedStatus();slotPicker();draw()});
 $('appearance').onclick=()=>{const show=$('creatureEditor').hidden;$('creatureEditor').hidden=!show;if(show)creatureEditor.refresh();};
 $('edit').onclick=()=>{editing=!editing;selected=null;refresh()};
 $('pets').onclick=()=>{pets=!pets;saveStudio();refresh()};$('motion').onclick=()=>{reducedMotion=!reducedMotion;saveStudio();refresh()};
 $('more').onclick=()=>{const open=$('fileMenu').hidden;$('fileMenu').hidden=!open;$('more').setAttribute('aria-expanded',String(open))};
 $('importButton').onclick=()=>$('import').click();
 $('reset').onclick=()=>{if(confirm('恢复当前房间默认布局？'))edit({type:'reset'})};
 $('scale').onchange=e=>{if(chosen())edit({type:'scale',id:selected,scale:Number(e.target.value)})};
 for(const b of root.querySelectorAll('[data-op]'))b.onclick=()=>{if(chosen()&&(b.dataset.op!=='delete'||confirm('移除这件家具？')))edit({type:b.dataset.op,id:selected,newId:uid()})};
 for(const b of root.querySelectorAll('[data-layer]'))b.onclick=()=>{if(chosen())edit({type:'layer',id:selected,direction:b.dataset.layer})};
 const point=e=>{const r=$('scene').getBoundingClientRect(),d=cat.rooms[room];return{x:(e.clientX-r.left)*d.width/r.width,y:(e.clientY-r.top)*d.height/r.height}};
 $('scene').addEventListener('pointerdown',e=>{if(!editing)return;const id=e.target.closest('[data-instance]')?.dataset.instance;if(!id)return;selected=id;const i=chosen(),p=point(e);drag={id,room,pointer:e.pointerId,dx:p.x-i.x,dy:p.y-i.y,x:i.x,y:i.y};$('scene').setPointerCapture(e.pointerId);e.preventDefault()});
 $('scene').addEventListener('pointermove',e=>{if(!drag||drag.pointer!==e.pointerId)return;const p=point(e),r=cat.rooms[room],i=chosen();drag.x=p.x-drag.dx;drag.y=p.y-drag.dy;for(const el of $('scene').querySelectorAll('[data-instance]'))if(el.dataset.instance===drag.id){el.style.left=drag.x*100/r.width+'%';el.style.top=drag.y*100/r.height+'%'}});
 $('scene').addEventListener('pointerup',e=>{if(drag?.pointer!==e.pointerId)return;const d=drag;drag=null;if(d.room===room)edit({type:'move',id:d.id,x:d.x,y:d.y})});
 $('scene').addEventListener('pointercancel',()=>{drag=null;refresh()});
 $('export').onclick=()=>{const json=JSON.stringify({version:1,layout:state,household},null,2);const url=URL.createObjectURL(new Blob([json],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='rest-box-layout.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
 $('import').onchange=async e=>{try{const f=e.target.files[0];if(!f)return;if(f.size>1000000)throw Error('布局文件过大');const raw=JSON.parse(await f.text());const next=restoreLayout(raw.layout??raw,cat),nextHouse=raw.household?restoreHousehold(raw.household,art.appearance):household;state=next;household=nextHouse;selected=null;poseChoices={};if(restoreFailed&&confirm('是否用导入的有效存档替换无法读取的旧存档？'))restoreFailed=false;saveStudio();creatureEditor.refresh();refresh()}catch(e){message(e.message,true)}finally{e.target.value=''}};
 refresh();
}catch(e){if(!disposed)message('资源加载失败：'+e.message,true)}
return dispose;
}

export function registerRoomStudio(){
 if(!globalThis.customElements||!globalThis.HTMLElement||customElements.get('coast-room-studio'))return;
 customElements.define('coast-room-studio',class extends HTMLElement{
   connectedCallback(){if(!this.studioDispose)void mountRoomStudio(this)}
   disconnectedCallback(){this.studioDispose?.();this.studioDispose=null}
 });
}
registerRoomStudio();
