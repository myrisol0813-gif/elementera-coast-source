// Shared presentation state, separate from actual model actions or events.
export const ACTIONS=Object.freeze(['idle','cling','cheer','sad','sit','sleep']);
export const GLASSES=Object.freeze(['none','round','square','sun','mono']);
export const NECK=Object.freeze(['none','tie','bow','scarf']);
const hex=v=>typeof v==='string'&&/^#[0-9a-f]{6}$/i.test(v);
const own=(o,k)=>!!o&&Object.hasOwn(o,k);
function check(ok,why){if(!ok)throw Error(why)}
export function newAppearance(defs,bodyId){
  check(own(defs,bodyId),'unknown creature');
  return {bodyId,palette:defs[bodyId].defaultPalette,colors:{},glasses:'none',neck:'none',glassesColor:'#b69b65',neckColor:'#768ba6',horn:true,hat:true,tongue:true,badge:'none',badgeMode:'original',badgePlace:'chest',badgeColor:'#caa05f',badgeX:0,badgeY:0,badgeSize:100};
}
export function normalizeAppearance(defs,input){
  const base=newAppearance(defs,input?.bodyId),def=defs[base.bodyId];
  const palette=input.palette??base.palette;
  check(own(def.palettes,palette),'unknown palette');
  const colors={};for(const [k,v] of Object.entries(input.colors??{})){check(own(def.slots,k)&&hex(v),'invalid creature color slot');colors[k]=v.toLowerCase()}
  const glasses=input.glasses??base.glasses,neck=input.neck??base.neck;
  check(GLASSES.includes(glasses)&&NECK.includes(neck),'invalid accessory');
  check(def.neck||neck==='none','body does not support neckwear');
  const glassesColor=input.glassesColor??base.glassesColor,neckColor=input.neckColor??base.neckColor;
  check(hex(glassesColor)&&hex(neckColor),'invalid accessory color');
  for(const k of ['horn','hat','tongue'])check(input[k]===undefined||typeof input[k]==='boolean','invalid accessory flag');
  const badge=input.badge??'none',badgeMode=input.badgeMode??'original',badgePlace=input.badgePlace??'chest',badgeColor=input.badgeColor??'#caa05f',badgeX=input.badgeX??0,badgeY=input.badgeY??0,badgeSize=input.badgeSize??100;
  check(['none','gpt','claude','deepseek','gemini','grok'].includes(badge)&&['original','custom'].includes(badgeMode)&&['head','chest'].includes(badgePlace)&&hex(badgeColor),'invalid badge');
  check([badgeX,badgeY].every(v=>Number.isFinite(v)&&Math.abs(v)<=100)&&Number.isFinite(badgeSize)&&badgeSize>=30&&badgeSize<=200,'invalid badge adjustment');
  return {...base,palette,colors,glasses,neck,glassesColor,neckColor,horn:input.horn??true,hat:input.hat??true,tongue:input.tongue??true,badge,badgeMode,badgePlace,badgeColor,badgeX,badgeY,badgeSize};
}
export function newHousehold(defs){return {version:1,model:newAppearance(defs,'wolf'),human:newAppearance(defs,'cat'),humanEnabled:false}}
export function editAppearance(state,defs,role,patch){
  check(['model','human'].includes(role),'invalid role');
  const old=state[role],body=patch.bodyId??old.bodyId;
  let next=body!==old.bodyId?newAppearance(defs,body):{...old,colors:{...old.colors}};
  if(patch.palette!==undefined&&patch.palette!==next.palette)next.colors={};
  if(patch.colors)next.colors={...next.colors,...patch.colors};
  const {colors,...rest}=patch;
  return {...state,[role]:normalizeAppearance(defs,{...next,...rest})};
}
export function restoreHousehold(raw,defs){check(raw?.version===1&&typeof raw.humanEnabled==='boolean','invalid household');return {version:1,model:normalizeAppearance(defs,raw.model),human:normalizeAppearance(defs,raw.human),humanEnabled:raw.humanEnabled}}
export function poseColors(def,appearance){return {...def.palettes[appearance.palette],...appearance.colors}}
