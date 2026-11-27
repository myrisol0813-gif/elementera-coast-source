import {loadArt} from './room-renderer.mjs';
import {restoreLayout,roomPreviewSlots} from './room-state.mjs';
import {restoreHousehold} from './creature-state.mjs';
export const STUDIO_KEY='rest-box.studio.v1';
const MAX=1000000;
export async function verifyStudio(raw,art=null){
  const v=typeof raw==='string'?JSON.parse(raw):raw;
  if(!v||v.version!==1||!v.layout||!v.household||!Object.hasOwn(v,'room')||typeof v.pets!=='boolean'||typeof v.reducedMotion!=='boolean'||!v.poseChoices||typeof v.poseChoices!=='object'||Array.isArray(v.poseChoices))throw Error('造物间归档格式不完整');
  if(Object.keys(v).some(k=>!['version','layout','household','room','pets','reducedMotion','poseChoices'].includes(k))||new TextEncoder().encode(JSON.stringify(v)).length>MAX)throw Error('造物间归档无效或过大');
  art??=await loadArt();
  const cat=art.catalogue,layout=restoreLayout(v.layout,cat),household=restoreHousehold(v.household,art.appearance),poseChoices={};
  if(!Object.hasOwn(cat.rooms,v.room))throw Error('未知房间');
  for(const id of Object.keys(cat.rooms)){
    const src=v.poseChoices[id];
    if(!src)continue;
    if(typeof src!=='object'||Array.isArray(src))throw Error('无效的坐卧设置');
    const allowed=new Set(['','none',...roomPreviewSlots(layout,cat,id).map(s=>s.key)]);
    const chosen=Object.fromEntries(['model','human'].filter(role=>allowed.has(src[role])).map(role=>[role,src[role]]));
    if(Object.keys(chosen).length)poseChoices[id]=chosen;
  }
  return {version:1,layout,household,room:v.room,pets:v.pets,reducedMotion:v.reducedMotion,poseChoices};
}
export async function captureStudio(storage=globalThis.localStorage,art=null){
  const raw=storage.getItem(STUDIO_KEY);
  if(raw===null)return null;
  return verifyStudio(raw,art);
}
export async function restoreStudioArchive(value,confirm,storage=globalThis.localStorage,art=null){
  const next=await verifyStudio(value,art),old=storage.getItem(STUDIO_KEY);
  let same=false;
  if(old!==null)try{same=JSON.stringify(await verifyStudio(old,art))===JSON.stringify(next)}catch{}
  if(confirm&&!same){
    // Preserve the previous raw bytes, including malformed legacy saves.
    if(old!==null)storage.setItem(STUDIO_KEY+'.archive-previous',old);
    storage.setItem(STUDIO_KEY,JSON.stringify(next));
    if(storage.getItem(STUDIO_KEY)!==JSON.stringify(next))throw Error('造物间保存未确认');
  }
  return {scope:'device_studio',ready:same?0:1,existing:same?1:0,conflicts:!same&&old!==null?1:0};
}
export function studioFromEnvelope(record,envelope){
  if(record.module!=='appearance'||record.dependencies.length)return null;
  const data=envelope?.data;
  if(!data||!Object.hasOwn(data,'rest_studio'))return null;
  if(record.id==='device-basic-settings'&&envelope.kind==='device_basic_settings'&&!record.media_objects.length&&Object.hasOwn(data,'basic_settings')&&Object.keys(data).every(k=>['basic_settings','rest_studio'].includes(k)))return data.rest_studio;
  if(record.id==='native-appearance'&&envelope.kind==='appearance'&&Object.hasOwn(data,'settings')&&Object.hasOwn(data,'files')&&Object.keys(data).every(k=>['settings','files','basic_settings','rest_studio'].includes(k)))return data.rest_studio;
  throw Error('无效的造物间设备记录');
}
