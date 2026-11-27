import {normalizeAppearance,poseColors,ACTIONS} from './creature-state.mjs';
const NS='http://www.w3.org/2000/svg';
const uri=s=>'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(s);
const upright=[104,123,82,111,76,69,81,42,85,24,94,30,104,39,121,53,134,70,143,91,146,115,127,132,104,123];
const floppy=[104,123,79,119,63,109,57,100,48,84,62,70,85,73,109,75,128,84,143,91,146,115,127,132,104,123];
const inUp=[96,78,88,61,91,46,95,43,104,45,115,62,123,76,108,73,102,82];
const inDown=[86,101,74,97,65,90,66,85,77,79,100,88,113,92,100,98,92,106];
const blend=(a,b,t)=>a.map((n,i)=>Math.round((n+(b[i]-n)*t)*10)/10);
const outer=p=>'M'+p[0]+' '+p[1]+'C'+p.slice(2,8).join(' ')+'C'+p.slice(8,14).join(' ')+'C'+p.slice(14,20).join(' ')+'C'+p.slice(20,26).join(' ')+'Z';
const inner=p=>'M'+p[0]+' '+p[1]+'C'+p.slice(2,8).join(' ')+'C'+p.slice(8,14).join(' ')+'Q'+p.slice(14,18).join(' ')+'Z';
export function wolfEarPaths(action,droop=65){const t=action==='sad'?Math.max(0,Math.min(100,droop))/100:action==='sleep'?.8:action==='cling'?.35:action==='cheer'?0:.05;return {outer:outer(blend(upright,floppy,t)),inner:inner(blend(inUp,inDown,t))}}
export function snakeTailPaths(a,b){
return {body:`M160 43C106.75 43 89 78 89 113C89 139 103 151 123 154C114 171 115 194 136 210C161 229 207 220 230 196C${245+a} 181 ${251+a} ${161+b} ${244+a} ${157+b}Q${240+a} ${154+b} ${235+a*.65} ${165+b*.7}C${223+a*.45} ${190+b*.18} 188 188 197 154C217 151 231 139 231 113C231 78 213.25 43 160 43Z`,belly:`M126 146Q160 153 188 146C178 177 186 198 213 197C${231+.3*a} ${196+.18*b} ${243.656+.48*a} ${181.576+.65*b} ${246.416+.6768*a} ${168.136+.896*b}C${244.76+.64*a} ${176.2+.64*b} ${239+.4*a} 187 230 196C207 220 161 229 136 210C115 194 114 171 123 154Z`,anchor:[244+a,157+b]};
}
function tailFrames(action){
  const amplitude={idle:[2,3,0,0,1],cling:[5,7,0,0,2],cheer:[4,5,0,-6,5],sad:[0,2,4,17,1],sit:[0,0,2,10,1]}[action];
  if(!amplitude)return null;const [ax,ay,x,y,speed]=amplitude;
  return {duration:1.9/speed,frames:[0,1,0,-1,0].map(t=>snakeTailPaths(x+ax*t,y+ay*t))};
}
function appendMarkup(doc,parent,markup){
  const parsed=new DOMParser().parseFromString('<svg xmlns="'+NS+'">'+markup+'</svg>','image/svg+xml');
  if(parsed.querySelector('parsererror,script,foreignObject'))throw Error('invalid bundled accessory');
  for(const n of [...parsed.documentElement.children])parent.append(doc.importNode(n,true));
}
function group(doc,parent,before=null,attrs={}){
  if(!parent)return null;const g=doc.createElementNS(NS,'g');for(const [k,v] of Object.entries(attrs))g.setAttribute(k,String(v));parent.insertBefore(g,before?.parentNode===parent?before:null);return g;
}
function mountNeck(doc,body,def,appearance,action,accessories){
  if(appearance.neck==='none'||!def.neck)return;
  const cfg=body.config,$=id=>doc.getElementById(id),pet=$(cfg.pet),head=$(cfg.head);if(!pet||!head)return;
  let parent=pet,before=head.parentNode===pet?head:head.parentNode,anchor=cfg.neck;
  if(cfg.kind==='bird'){parent=action==='sleep'?$('sleepBody'):$('standingBody');before=action==='sleep'?null:$('wingL');if(action==='sleep')anchor=cfg.sleepN}
  if(cfg.kind==='snake'&&action==='sleep'){parent=head;before=$('eyes');anchor=cfg.sleepN}
  if(!parent||!anchor)return;
  const [x,y,w,sz]=anchor,attrs={fill:appearance.neckColor};
  let markup=accessories.neck[appearance.neck];
  if(appearance.neck==='scarf'&&cfg.kind==='quad'&&def.hasBodyClip){markup=markup.quadClipped}
  else{attrs.transform='translate('+x+' '+y+') scale('+(sz||1)+')';if(appearance.neck==='scarf')markup='<path d="M'+(-w)+' -10Q0 4 '+w+' -10L'+w+' 7Q0 20 '+(-w)+' 7Z"/><path d="M8 7L26 8L22 38L4 35Z"/><path d="M'+(-w)+' -1Q0 13 '+w+' -1M6 29L23 32" fill="none" stroke="#fff8e8" stroke-width="3" opacity=".6"/>'}
  appendMarkup(doc,group(doc,parent,before,attrs),markup);
}
function animate(doc,node,attr,values,duration){
  if(!node)return;const el=doc.createElementNS(NS,'animate');for(const [k,v] of Object.entries({attributeName:attr,values:values.join(';'),dur:duration+'s',repeatCount:'indefinite',keyTimes:'0;0.25;0.5;0.75;1'}))el.setAttribute(k,v);node.append(el);
}
function mountProp(doc,body,action,prop,mount,source){
  if(!prop||!mount||action==='sleep')return;
  const $=id=>doc.getElementById(id);
  let parent,x=0,y=0;
  if(mount.kind==='tail'){parent=$('giftAnchor')}
  else if(action==='cheer'){parent=$('pawR');[x,y]=mount.raised}
  else{parent=$('hands');[x,y]=mount.normal}
  if(!parent)return;
  const [gx,gy]=prop.grip,sz=mount.scale;
  const g=group(doc,parent,null,{transform:'translate('+x+' '+y+') scale('+sz+') translate('+(-gx)+' '+(-gy)+')'});
  const parsed=new DOMParser().parseFromString(source,'image/svg+xml');
  if(parsed.documentElement.localName!=='svg'||parsed.querySelector('parsererror,script,foreignObject'))throw Error('invalid bundled prop');
  for(const n of [...parsed.documentElement.querySelectorAll('*')])for(const a of [...n.attributes])if(/^on/i.test(a.name)||((a.localName==='href'||a.localName==='src')&&!a.value.startsWith('#')))throw Error('invalid prop reference');
  for(const n of [...parsed.documentElement.children])g.append(doc.importNode(n,true));
}
export function creatureSvg(source,body,defs,accessories,input,action='idle',{reducedMotion=false,prop=null,mount=null,propSource=null}={}){
  if(!ACTIONS.includes(action))throw Error('unsupported action');
  const appearance=normalizeAppearance(defs,input),def=defs[appearance.bodyId];
  if(body.id!==appearance.bodyId)throw Error('body mismatch');
  const doc=new DOMParser().parseFromString(source,'image/svg+xml'),svg=doc.documentElement;
  if(svg.localName!=='svg'||doc.querySelector('parsererror,script,foreignObject'))throw Error('invalid bundled body');
  const $=id=>doc.getElementById(id),cfg=body.config,scene=$(cfg.kind==='fish'?'fish':'scene');
  if(!scene)throw Error('missing pose root');
  for(const node of svg.querySelectorAll('*'))for(const attr of [...node.attributes])if(/^on/i.test(attr.name)||((attr.localName==='href'||attr.localName==='src')&&!attr.value.startsWith('#')))throw Error('unexpected external action');
  const colors=poseColors(def,appearance),literal=new Map();
  for(const [k,v] of Object.entries(colors)){const slot=def.slots[k];if(slot?.kind==='variable')scene.style.setProperty('--'+k,v);else if(slot?.kind==='literal')literal.set(slot.base.toLowerCase(),v)}
  if(literal.size)for(const node of svg.querySelectorAll('*'))for(const a of ['fill','stroke','stop-color']){const v=node.getAttribute(a)?.toLowerCase();if(literal.has(v))node.setAttribute(a,literal.get(v))}
  scene.setAttribute('class',action+(cfg.kind==='snake'?(appearance.hat?' withHat':'')+(appearance.tongue?'':' noTongue'):' '+appearance.palette));
  if(cfg.kind==='fish')for(const id of ['bubbles','fishEmote'])$(id)?.setAttribute('class',action);
  if(body.id==='wolf'){const p=wolfEarPaths(action);$('outerEar')?.setAttribute('d',p.outer);$('innerEar')?.setAttribute('d',p.inner)}
  if(cfg.kind==='snake'){
    if(!appearance.horn&&$('face')?.firstElementChild)$('face').firstElementChild.setAttribute('display','none');
    if($('giftAnchor'))$('giftAnchor').setAttribute('display',action==='sleep'?'none':'inline');
    const f=tailFrames(action);if(f){const first=f.frames[0];$('bodyShape')?.setAttribute('d',first.body);$('bellyShape')?.setAttribute('d',first.belly);$('giftAnchor')?.setAttribute('transform','translate('+first.anchor.join(' ')+')');if(!reducedMotion&&action!=='sit'){animate(doc,$('bodyShape'),'d',f.frames.map(x=>x.body),f.duration);animate(doc,$('bellyShape'),'d',f.frames.map(x=>x.belly),f.duration);if($('giftAnchor')){const a=doc.createElementNS(NS,'animateTransform');for(const [k,v] of Object.entries({attributeName:'transform',type:'translate',values:f.frames.map(x=>x.anchor.join(' ')).join(';'),dur:f.duration+'s',repeatCount:'indefinite',keyTimes:'0;0.25;0.5;0.75;1'}))a.setAttribute(k,v);$('giftAnchor').append(a)}}}
  }
  if(!appearance.hat&&$('hat'))$('hat').style.setProperty('display','none','important');
  if(appearance.glasses!=='none'){
    const parent=$(cfg.head);if(parent){const g=group(doc,parent,$('hat'),{transform:'translate('+cfg.x+' '+cfg.y+') scale('+(cfg.gs||1)+')',color:appearance.glassesColor,stroke:appearance.glassesColor,'stroke-width':2.7,'stroke-linecap':'round',fill:'none'});appendMarkup(doc,g,accessories.glasses[appearance.glasses])}
  }
  mountNeck(doc,body,def,appearance,action,accessories);
  if(prop&&mount&&propSource)mountProp(doc,body,action,prop,mount,propSource);
  if(reducedMotion){const style=doc.createElementNS(NS,'style');style.textContent='*{animation:none!important;transition:none!important}';svg.append(style)}
  return new XMLSerializer().serializeToString(svg);
}
export function createCreatureRenderer(art){
  const cache=new Map();
  return async (input,action='idle',opts={})=>{
    const body=art.creatures[input.bodyId];if(!body)throw Error('unknown body');
    const prop=art.props?.props.find(p=>p.id===opts.prop)??null,mount=art.props?.mounts[input.bodyId]??null;
    const key=JSON.stringify([input,action,!!opts.reducedMotion,prop?.id??null]);
    if(!cache.has(key)){const task=Promise.all([art.read(body.file),prop&&mount?art.read(prop.file):null]).then(([s,propSource])=>uri(creatureSvg(s,body,art.appearance,art.accessories,input,action,{...opts,prop,mount,propSource})));cache.set(key,task);task.catch(()=>{if(cache.get(key)===task)cache.delete(key)});if(cache.size>96)cache.delete(cache.keys().next().value)}
    return cache.get(key)
  }
}
