import {newHousehold,restoreHousehold} from './creature-state.mjs';
import {mountCreatureEditor} from './creature-editor.mjs';
import {loadArt,createRoomRenderer} from './room-renderer.mjs';
import {newLayout,editLayout,restoreLayout,roomPreviewSlots,previewOccupants} from './room-state.mjs';
const $=id=>document.getElementById(id);
const labels={living:'客厅',study:'书房',bedroom:'卧室',extras:'新家具'};
const btn=(label,fn,pressed)=>{const b=document.createElement('button');b.type='button';b.textContent=label;if(pressed!==undefined)b.setAttribute('aria-pressed',String(pressed));b.addEventListener('click',fn);return b};
let art,cat,state,renderer,household,creatureEditor,room='living',family='living',editing=false,selected=null,pets=false,drag=null,reducedMotion=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches??false,poseChoices={};
function message(s,error=false){$('status').textContent=s;$('status').classList.toggle('error',error)}
function chosen(){return state.rooms[room].find(i=>i.id===selected)}
function uid(){return 'i-'+crypto.randomUUID()}
function edit(op){try{state=editLayout(state,cat,room,op);if(op.type==='delete'||op.type==='reset')selected=null;if(op.type==='copy')selected=op.newId;if(op.type==='add')selected=op.id;refresh()}catch(e){message(e.message,true)}}
function occupancy(){return pets?previewOccupants(state,cat,room,household,poseChoices[room]??{}):[]}
function slotPicker(){
  const root=$('poseSlots');root.hidden=!pets;root.replaceChildren();if(!pets)return;
  const slots=roomPreviewSlots(state,cat,room),used=occupancy();
  for(const role of ['model','human']){
    if(role==='human'&&!household.humanEnabled)continue;
    const label=document.createElement('label');label.textContent=role==='model'?'模型动物 ':'我的动物 ';
    const select=document.createElement('select');const opts=[['','自动选择'],['none','不展示'],...slots.map(s=>[s.key,s.name+' · '+(s.action==='sleep'?'睡觉':'坐坐')+' · '+s.anchorId])];
    for(const [value,name] of opts){const option=document.createElement('option');option.value=value;option.textContent=name;select.append(option)}
    select.value=(poseChoices[room]??{})[role]??'';select.onchange=()=>{poseChoices[room]={...poseChoices[room],[role]:select.value};slotPicker();draw()};label.append(select);root.append(label);
  }
}
async function draw(){try{await renderer.render(state,room,{occupants:occupancy(),selected,editing,household,reducedMotion})}catch(e){message(e.message,true)}}
function refresh(){
  $('rooms').replaceChildren(...Object.keys(cat.rooms).map(id=>btn(labels[id],()=>{room=id;selected=null;refresh()},room===id)));
  $('editor').hidden=!editing;$('edit').textContent=editing?'完成':'布置房间';$('scene').classList.toggle('editing',editing);
  $('pets').setAttribute('aria-pressed',String(pets));$('motion').setAttribute('aria-pressed',String(reducedMotion));slotPicker();
  const item=chosen(),a=item&&cat.assets[item.assetId];$('selected').textContent=a?.name??(item?'素材缺失':'未选中家具');
  for(const e of document.querySelectorAll('[data-op],[data-layer],#scale'))e.disabled=!item;
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
  message(labels[room]+' · '+state.rooms[room].length+' 件家具');draw();
}
try{
 art=await loadArt();cat=art.catalogue;state=newLayout(cat);household=newHousehold(art.appearance);renderer=createRoomRenderer($('scene'),art);
 creatureEditor=mountCreatureEditor($('creatureEditor'),art,()=>household,next=>{household=next;slotPicker();draw()});
 $('appearance').onclick=()=>{const show=$('creatureEditor').hidden;$('creatureEditor').hidden=!show;if(show)creatureEditor.refresh();};
 $('edit').onclick=()=>{editing=!editing;selected=null;refresh()};
 $('pets').onclick=()=>{pets=!pets;refresh()};$('motion').onclick=()=>{reducedMotion=!reducedMotion;refresh()};
 $('reset').onclick=()=>{if(confirm('恢复当前房间默认布局？'))edit({type:'reset'})};
 $('scale').onchange=e=>{if(chosen())edit({type:'scale',id:selected,scale:Number(e.target.value)})};
 for(const b of document.querySelectorAll('[data-op]'))b.onclick=()=>{if(chosen()&&(b.dataset.op!=='delete'||confirm('移除这件家具？')))edit({type:b.dataset.op,id:selected,newId:uid()})};
 for(const b of document.querySelectorAll('[data-layer]'))b.onclick=()=>{if(chosen())edit({type:'layer',id:selected,direction:b.dataset.layer})};
 const point=e=>{const r=$('scene').getBoundingClientRect(),d=cat.rooms[room];return{x:(e.clientX-r.left)*d.width/r.width,y:(e.clientY-r.top)*d.height/r.height}};
 $('scene').addEventListener('pointerdown',e=>{if(!editing)return;const id=e.target.closest('[data-instance]')?.dataset.instance;if(!id)return;selected=id;const i=chosen(),p=point(e);drag={id,room,pointer:e.pointerId,dx:p.x-i.x,dy:p.y-i.y,x:i.x,y:i.y};$('scene').setPointerCapture(e.pointerId);e.preventDefault()});
 $('scene').addEventListener('pointermove',e=>{if(!drag||drag.pointer!==e.pointerId)return;const p=point(e),r=cat.rooms[room],i=chosen();drag.x=p.x-drag.dx;drag.y=p.y-drag.dy;for(const el of $('scene').querySelectorAll('[data-instance]'))if(el.dataset.instance===drag.id){el.style.left=drag.x*100/r.width+'%';el.style.top=drag.y*100/r.height+'%'}});
 $('scene').addEventListener('pointerup',e=>{if(drag?.pointer!==e.pointerId)return;const d=drag;drag=null;if(d.room===room)edit({type:'move',id:d.id,x:d.x,y:d.y})});
 $('scene').addEventListener('pointercancel',()=>{drag=null;refresh()});
 $('export').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify({version:1,layout:state,household},null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='rest-box-layout.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
 $('import').onchange=async e=>{try{const f=e.target.files[0];if(!f)return;if(f.size>1000000)throw Error('布局文件过大');const raw=JSON.parse(await f.text());const next=restoreLayout(raw.layout??raw,cat),nextHouse=raw.household?restoreHousehold(raw.household,art.appearance):household;state=next;household=nextHouse;selected=null;creatureEditor.refresh();refresh()}catch(e){message(e.message,true)}finally{e.target.value=''}};
 refresh();
}catch(e){message('资源加载失败：'+e.message,true)}
