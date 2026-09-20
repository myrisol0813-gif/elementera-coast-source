export const THEME_PRESETS = Object.freeze([
  ['default','默认'],['navy-gold','深蓝旧金'],['soft-pink','柔和粉色'],['snow-light','雪地冷光'],
  ['warm-cloud','暖云金橙'],['aurora-night','极光夜航'],['retro-pixel','复古像素'],['old-paper','旧纸红棕'],
  ['sea-fog','极简海雾'],['bright-bold','明亮粗线'],['meadow','草地绿洲'],['purple-tide','紫色梦潮'],
].map(([id,label])=>Object.freeze({id,label})));
const IDS=new Set(THEME_PRESETS.map((item)=>item.id));
const LEGACY=Object.freeze({light:'default',dark:'navy-gold',gold:'navy-gold'});
export function normalizeThemeId(value){
  const id=LEGACY[String(value||'')]||String(value||'');
  return IDS.has(id)?id:'default';
}
export function themeLabel(value){
  const id=normalizeThemeId(value);
  return THEME_PRESETS.find((item)=>item.id===id)?.label||'默认';
}
