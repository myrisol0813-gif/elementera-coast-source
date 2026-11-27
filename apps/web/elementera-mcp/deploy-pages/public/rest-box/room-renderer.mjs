import {createCreatureRenderer} from './creature-renderer.mjs';
import {newAppearance} from './creature-state.mjs';
import {assetSize,buildCatalogue,sceneLayers} from './room-state.mjs';

const safePath=p=>typeof p==='string' && /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:json|svg)$/.test(p);
const hex=s=>typeof s==='string' && /^#[0-9a-f]{6}$/i.test(s);
const dataUri=s=>'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(s);
function mix(a,b,t){return '#'+[1,3,5].map(i=>Math.round(parseInt(a.slice(i,i+2),16)*(1-t)+parseInt(b.slice(i,i+2),16)*t).toString(16).padStart(2,'0')).join('')}

export async function loadArt({base=new URL('./art/v1/',import.meta.url),fetcher=globalThis.fetch}={}){
  const cache=new Map();
  const read=p=>{
    if(!safePath(p))throw Error('invalid bundled art path');
    if(!cache.has(p)){
      const task=Promise.resolve().then(()=>fetcher(new URL(p,base))).then(r=>{if(!r.ok)throw Error('art unavailable: '+p);return r.text()});
      cache.set(p,task);task.catch(()=>{if(cache.get(p)===task)cache.delete(p)});
    }
    return cache.get(p);
  };
  const json=async p=>JSON.parse(await read(p));
  const idx=await json('index.json');
  const [rooms,extras,presets,creatures,appearance,accessories,props,badges]=await Promise.all([Promise.all(idx.rooms.map(r=>json(r.manifest))),Promise.all(idx.extras.map(json)),json(idx.colorPresets),json(idx.creatures),json(idx.appearance),json(idx.accessories),json(idx.propMounts),json(idx.badges)]);
  return {catalogue:buildCatalogue(rooms,extras,presets),creatures:Object.fromEntries(creatures.bodies.map(b=>[b.id,b])),appearance:appearance.bodies,accessories,props,badges,read};
}

// Only bundled assets, never arbitrary imported SVG. Images isolate internal IDs and CSS.
export function shiftInk(original,base,target){if(base.toLowerCase()===target.toLowerCase())return original;return '#'+[1,3,5].map(i=>Math.max(0,Math.min(255,parseInt(original.slice(i,i+2),16)+parseInt(target.slice(i,i+2),16)-parseInt(base.slice(i,i+2),16))).toString(16).padStart(2,'0')).join('')}

export function prepareSvg(source,asset={},colors={},part='whole'){
  if(!['whole','back','front'].includes(part))throw Error('unknown paint layer');
  const doc=new DOMParser().parseFromString(source,'image/svg+xml'),svg=doc.documentElement;
  if(svg.localName!=='svg'||doc.querySelector('parsererror,script,foreignObject'))throw Error('invalid SVG');
  for(const e of svg.querySelectorAll('*'))for(const a of [...e.attributes]){
    if(/^on/i.test(a.name)||((a.localName==='href'||a.localName==='src')&&!a.value.startsWith('#')))throw Error('external SVG action');
  }
  const changes=new Map();const coordinated=new Map();const patternChanges=new Map();
  for(const [key,val] of Object.entries(colors)){
    const slot=asset.slots?.[key];if(!slot||!hex(val))throw Error('unknown palette slot');
    if(slot.members){for(const c of slot.members)coordinated.set(c.toLowerCase(),shiftInk(c,slot.base,val));for(const [id,cs] of Object.entries(slot.patterns??{})){if(!patternChanges.has(id))patternChanges.set(id,new Map());for(const c of cs)patternChanges.get(id).set(c.toLowerCase(),shiftInk(c,slot.base,val));}continue;}
    if(slot.selector){
      const root=doc.getElementById(slot.selector.groupId);
      if(!root||!['fill','stroke'].includes(slot.selector.attribute))throw Error('palette group missing');
      for(const node of [root,...root.querySelectorAll('*')]){
        if(node.getAttribute(slot.selector.attribute)?.toLowerCase()===slot.selector.original.toLowerCase())node.setAttribute(slot.selector.attribute,val);
      }
    }else{
      const afternoon=['extra-rocker','extra-telescope','extra-lace-table','extra-teapot','extra-letter-shelf','extra-moon-cushion'].includes(asset.id);
      const secondary=key==='secondary';
      const l=secondary?mix(val,'#f3d8ad',.38):mix(val,afternoon?'#fff3d5':'#fff1d2',afternoon ? .45 : .44);
      const d=secondary?mix(val,'#503d31',.28):mix(val,afternoon?'#67503e':'#514a3d',afternoon ? .25 : .32);
      for(const [from,to] of [[slot.base,val],[slot.light,l],[slot.dark,d]]){
        if(!hex(from))continue;const k=from.toLowerCase();if(changes.has(k)&&changes.get(k)!==to)throw Error('overlapping palette slots');changes.set(k,to);
      }
    }
  }
  const apply=(node,map)=>{for(const attr of ['fill','stroke','stop-color']){const old=node.getAttribute(attr)?.toLowerCase();if(map.has(old))node.setAttribute(attr,map.get(old))}};
  if(coordinated.size)for(const node of svg.querySelectorAll('[data-part], [data-part] *'))apply(node,coordinated);
  for(const [id,map] of patternChanges){const p=doc.getElementById(id);if(!p||p.localName!=='pattern')throw Error('missing palette pattern');for(const node of [p,...p.querySelectorAll('*')])apply(node,map)}
  if(changes.size)for(const node of [svg,...svg.querySelectorAll('*')])for(const attr of ['fill','stroke','stop-color']){
    const old=node.getAttribute(attr)?.toLowerCase();if(changes.has(old))node.setAttribute(attr,changes.get(old));
  }
  if(part!=='whole'){
    const layers=[...svg.querySelectorAll('[data-part]')];
    if(!layers.some(n=>n.getAttribute('data-part')===part))throw Error('missing furniture layer');
    for(const n of layers)if(n.getAttribute('data-part')!==part)n.remove();
  }
  return new XMLSerializer().serializeToString(svg);
}

export function createRoomRenderer(container,art){
  let generation=0;
  const {catalogue:cat}=art,cache=new Map(),paintCreature=createCreatureRenderer(art);
  const paint=async (asset,colors={},part='whole')=>{
    const key=JSON.stringify([asset.file,Object.entries(colors).sort(),part]);
    if(!cache.has(key)){
      const task=art.read(asset.file).then(s=>dataUri(prepareSvg(s,asset,colors,part)));
      cache.set(key,task);task.catch(()=>{if(cache.get(key)===task)cache.delete(key)});
      if(cache.size>256)cache.delete(cache.keys().next().value);
    }
    return cache.get(key);
  };
  function image(uri,x,y,w,h,opts={}){
    const img=document.createElement('img');img.src=uri;img.alt=opts.label??'';img.draggable=false;
    Object.assign(img.style,{position:'absolute',left:x+'%',top:y+'%',width:w+'%',height:h+'%',pointerEvents:opts.selectable?'auto':'none',transform:opts.mirror?'scaleX(-1)':'none',userSelect:'none',objectFit:'fill'});
    if(opts.id)img.dataset.instance=opts.id;
    if(opts.selected)img.style.outline='1px dashed #78936f';
    return img;
  }
  async function render(layout,roomId,{occupants=[],selected=null,editing=false,household=null,reducedMotion=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches??false}={}){
    const token=++generation,r=cat.rooms[roomId];if(!r)throw Error('unknown room');
    const {layers,unplaced}=sceneLayers(layout,cat,roomId,occupants);
    const pct=(x,y,w,h)=>[x*100/r.width,y*100/r.height,w*100/r.width,h*100/r.height];
    const bg=await paint({file:r.environment});
    const nodes=await Promise.all(layers.map(async l=>{
      if(l.kind==='creature'){
        const appearance=household?.[l.role]??newAppearance(art.appearance,l.creatureId);const body=Object.hasOwn(art.creatures,appearance.bodyId)?art.creatures[appearance.bodyId]:null;if(!body)return null;
        const [, , bw,bh]=body.viewBox.split(/\s+/).map(Number),h=55,w=h*bw/bh;
        return image(await paintCreature(appearance,l.action,{reducedMotion}),...pct(l.x-w/2,l.y-h/2,w,h),{label:l.role});
      }
      const i=l.item,a=cat.assets[i.assetId];
      if(!a){
        const n=document.createElement('button');n.type='button';n.textContent='素材缺失';n.dataset.instance=i.id;
        Object.assign(n.style,{position:'absolute',left:i.x*100/r.width+'%',top:i.y*100/r.height+'%',fontSize:'10px'});return n;
      }
      const {width,height}=assetSize(a),uri=await paint(a,i.colors,l.part);
      return image(uri,...pct(i.x,i.y,width*i.scale,height*i.scale),{id:i.id,mirror:i.mirror,selectable:editing,selected:editing&&selected===i.id&&l.part!=='front',label:a.name});
    }));
    const overlay=r.overlay?await paint({file:r.overlay}):null;
    if(token!==generation)return {stale:true};
    const frag=document.createDocumentFragment();frag.append(image(bg,0,0,100,100));
    for(const n of nodes)if(n)frag.append(n);
    if(overlay)frag.append(image(overlay,0,0,100,100));
    Object.assign(container.style,{position:'relative',aspectRatio:r.width+'/'+r.height,overflow:'hidden'});
    container.replaceChildren(frag);return {unplaced};
  }
  return {render,dispose(){generation++;cache.clear();container.replaceChildren()}};
}
