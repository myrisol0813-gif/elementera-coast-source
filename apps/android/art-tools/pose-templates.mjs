// Build-only conversion of the existing wardrobe renderer into editable static SVG templates.
// Original files are never rewritten. The installed app uses Kotlin + native rasterization.
const NS='http://www.w3.org/2000/svg';
const marker=(i)=>'#'+(0x010a21+i*0x010307).toString(16).padStart(6,'0');
const accessoryMarker={glasses:'#f103b7',neck:'#13b9e7',badge:'#e30791'};
const xml=new XMLSerializer();
function rgb(v){
  const m=v.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
  return m?'#'+m.slice(1).map(x=>Number(x).toString(16).padStart(2,'0')).join(''):v;
}
function localPaint(v){
  return rgb(v).replace(/url\(["']?[^)"']*#([^)"']+)["']?\)/g,'url(#$1)');
}
function freezeElement(e) {
  const style=getComputedStyle(e);
  const tag=e.localName;
  const attrs=['fill','stroke','stroke-width','stroke-linecap','stroke-linejoin','fill-rule','fill-opacity','stroke-opacity','opacity','visibility','display','color','stop-color','stop-opacity','filter','clip-path','mask'];
  if(tag==='text'||tag==='tspan')attrs.push('font-family','font-size','font-weight','text-anchor');
  const changes=attrs.map(k=>[k,localPaint(style.getPropertyValue(k).trim())]).filter(([k,v])=>v&&v!=='normal');
  const transform=style.transform, origin=style.transformOrigin;
  const existing=e.getAttribute('transform');
  let transformValue=null;
  if(transform&&transform!=='none'&&!existing&&transform.startsWith('matrix(')){
    const nums=origin.split(/\s+/).map(parseFloat);
    const m=new DOMMatrix(transform);
    if(nums.length>=2&&nums.every(Number.isFinite)){
      const [x,y]=nums;
      transformValue='matrix('+[m.a,m.b,m.c,m.d,m.e+x-m.a*x-m.c*y,m.f+y-m.b*x-m.d*y].join(' ')+')';
    }
  }
  return {e,changes,transformValue};
}
function applyFrozen(records) {
  for(const {e,changes,transformValue} of records){
    if(e.localName==='style')continue;
    for(const [k,v] of changes)e.setAttribute(k,v);
    if(transformValue)e.setAttribute('transform',transformValue);
    e.removeAttribute('style');
  }
}
function inSvg(source,body,fn){
  const outer=document.createElement('div');
  outer.style.cssText='position:fixed;left:-10000px;top:0;pointer-events:none';
  const shadow=outer.attachShadow({mode:'open'});
  document.body.append(outer);
  try {
    const doc=new DOMParser().parseFromString(source,'image/svg+xml');
    if(doc.querySelector('parsererror'))throw Error('invalid pose template');
    const svg=document.importNode(doc.documentElement,true);
    const [, ,w,h]=body.viewBox.split(/\s+/).map(Number);
    svg.setAttribute('width',String(w));svg.setAttribute('height',String(h));
    shadow.append(svg);
    return fn(svg);
  } finally {outer.remove()}
}
function authoredMatrix(e){
  const style=getComputedStyle(e), value=style.transform;
  if(!value||value==='none')return 'matrix(1 0 0 1 0 0)';
  if(!value.startsWith('matrix('))throw Error('unsupported authored 3D transform');
  const origin=style.transformOrigin.split(/\s+/).map(parseFloat),m=new DOMMatrix(value);
  let [x=0,y=0]=origin;
  if(style.transformBox==='fill-box'||style.transformBox==='stroke-box'){const box=e.getBBox();x+=box.x;y+=box.y;}
  return 'matrix('+[m.a,m.b,m.c,m.d,m.e+x-m.a*x-m.c*y,m.f+y-m.b*x-m.d*y].join(' ')+')';
}
// Capture the actual authored animation rather than re-inventing wag/blink/breath paths.
// CSS tracks keep their own periods; native time sampling combines them.
function captureMotion(svg,{indexed=false}={}){
  const tracks=[],animated=svg.getAnimations({subtree:true}),elements=[svg,...svg.querySelectorAll('*')];
  const idFor=e=>e?.getAttribute('id')||(anonymous&&e?'@'+elements.indexOf(e):null);
  for(const a of animated){a.pause();a.currentTime=0}
  const seen=new Set(),elements=[svg,...svg.querySelectorAll('*')];
  for(const a of animated){
    const target=a.effect?.target, id=indexed&&target?'@'+elements.indexOf(target):target?.getAttribute('id'), timing=a.effect?.getTiming();
    if(!id||!timing||typeof timing.duration!=='number'||timing.duration<=0)continue;
    const frames=a.effect.getKeyframes();
    a.effect.updateTiming({delay:0});
    const props=['transform','opacity'].filter(p=>frames.some(f=>Object.hasOwn(f,p)));
    for(const prop of props){
      const key=id+'|'+prop;if(seen.has(key))continue;seen.add(key);
      const values=[], steps=24;
      for(let i=0;i<steps;i++){
        a.currentTime=timing.duration*i/steps;
        values.push(prop==='transform'?authoredMatrix(target):getComputedStyle(target).opacity);
      }
      a.currentTime=0;
      tracks.push({targetId:id,attribute:prop,durationMs:timing.duration,delayMs:timing.delay,
        alternate:timing.direction==='alternate'||timing.direction==='alternate-reverse',frames:values});
    }
  }
  for(const anim of svg.querySelectorAll('animate,animateTransform')){
    const id=idFor(anim.parentElement), attr=anim.getAttribute('attributeName'),dur=anim.getAttribute('dur')??'';
    const values=(anim.getAttribute('values')??'').split(';').filter(Boolean);
    const match=dur.match(/^([0-9.]+)(ms|s)$/);
    if(!id||!match||!values.length||!['d','transform'].includes(attr))continue;
    const type=anim.localName==='animateTransform'?anim.getAttribute('type'):null;
    if(type&&!['translate','rotate','scale'].includes(type))continue;
    tracks.push({targetId:id,attribute:attr,durationMs:Number(match[1])*(match[2]==='s'?1000:1),delayMs:0,alternate:false,
      frames:type?values.map(v=>type+'('+v+')'):values});
  }
  return tracks;
}

export function compileFurnitureMotion(source,width,height){
  return inSvg(source,{viewBox:'0 0 '+width+' '+height},svg=>captureMotion(svg,{indexed:true}));
}
export async function compilePoseTemplate(art,creature,state,job) {
  const body=art.creatures[job.id], def=art.appearance[job.id];
  const source=await art.read(body.file);
  const slots=Object.fromEntries(Object.keys(def.slots).map((key,i)=>[key,marker(i)]));
  for(const color of [...Object.values(slots),...Object.values(accessoryMarker)])if(source.toLowerCase().includes(color))throw Error('pose marker collides with original '+body.id);
  const appearance={...state.newAppearance(art.appearance,body.id),palette:job.palette,colors:slots};
  const make=(patch={},opts={})=>creature.creatureSvg(source,body,art.appearance,art.accessories,{...appearance,...patch},job.action,{reducedMotion:true,badges:art.badges,...opts});
  const base=inSvg(make(),body,svg=>{
    const records=[svg,...svg.querySelectorAll('*')].filter(e=>!['style','animate','animateTransform'].includes(e.localName)).map(freezeElement);
    applyFrozen(records);
    svg.querySelectorAll('style,animate,animateTransform').forEach(e=>e.remove());
    const horn=body.config.kind==='snake'?svg.querySelector('#face')?.firstElementChild:null;
    if(horn)horn.setAttribute('data-coast-toggle','horn');
    return xml.serializeToString(svg);
  });
  const motion=inSvg(make({}, {reducedMotion:false}),body,captureMotion);
  const mounts={};
  function add(key,patch,kind,opts={}){
    const variant=make(patch,opts);
    inSvg(variant,body,svg=>{
      const group=svg.querySelector('[data-coast-mount="'+kind+'"]');
      if(!group)return;
      const parent=group.parentElement, parentId=parent?.getAttribute('id');
      if(!parentId)throw Error('unidentified original accessory mount '+body.id+' '+kind);
      // Count original element children, not text/comment nodes. All recipes are captured singly.
      const index=Array.from(parent.children).indexOf(group);
      const records=[group,...group.querySelectorAll('*')].map(freezeElement);
      applyFrozen(records);
      mounts[key]={parentId,index,svg:xml.serializeToString(group)};
    });
  }
  // Accessory geometry is independent of palette, but compiling with the same
  // class keeps conditional sleep/pose mounts faithful.
  for(const glasses of state.GLASSES.filter(x=>x!=='none'))add('glasses:'+glasses,{glasses,glassesColor:accessoryMarker.glasses},'glasses');
  if(def.neck)for(const neck of state.NECK.filter(x=>x!=='none'))add('neck:'+neck,{neck,neckColor:accessoryMarker.neck},'neck');
  for(const item of art.badges.items)for(const badgePlace of ['head','chest'])for(const badgeMode of ['original','custom'])
    add('badge:'+item.id+':'+badgePlace+':'+badgeMode,{badge:item.id,badgePlace,badgeMode,badgeColor:accessoryMarker.badge},'badge');
  const mount=art.props?.mounts[body.id];
  if(mount&&job.action!=='sleep')for(const prop of art.props.props){
    add('prop:'+prop.id,{},'prop',{prop,mount,propSource:await art.read(prop.file)});
  }
  return {version:1,bodyId:body.id,palette:job.palette,action:job.action,viewBox:body.viewBox,slots,accessoryMarker,svg:base,mounts,motion};
}
