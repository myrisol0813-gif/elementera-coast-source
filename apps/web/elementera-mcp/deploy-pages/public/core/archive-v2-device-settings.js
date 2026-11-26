// Portable allowlisted device controls; never model credentials or identity.
const defaults={recentTurns:8,contextBudget:6000,outputLength:'auto',maxOutputTokens:8000,creativity:'balanced',streamingEnabled:false,soilBudget:1800,seedCooldownTurns:2,worldbookEnabled:true,worldbookLimit:6,memoryLimit:8,toolCallLimit:24,replySequenceMaxMessages:3,replySequenceToolBudget:24,replySequenceTokenBudget:48000};
const ranges={recentTurns:[1,2147483647],maxOutputTokens:[64,65536],soilBudget:[300,4000],seedCooldownTurns:[0,8],worldbookLimit:[0,6],memoryLimit:[0,12],toolCallLimit:[1,128],replySequenceMaxMessages:[1,20],replySequenceToolBudget:[0,128],replySequenceTokenBudget:[1,1000000]};
const valid=(k,v)=>k==='contextBudget'?Number.isSafeInteger(v)&&(v===0||v>=1800&&v<=2147483647):k==='outputLength'?['auto','short','long'].includes(v):k==='creativity'?['stable','balanced','expansive'].includes(v):typeof defaults[k]==='boolean'?typeof v==='boolean':Number.isSafeInteger(v)&&v>=ranges[k][0]&&v<=ranges[k][1];
export const DEVICE_SETTINGS_ID='device-basic-settings';
export function captureDeviceBasic(value){
 return Object.fromEntries(Object.entries(defaults).map(([k,d])=>[k,String(valid(k,value?.[k])?value[k]:d)]));
}
export function parseDeviceBasic(value){
 if(!value||Object.keys(value).length!==Object.keys(defaults).length)throw Error('基本设置字段不完整。');
 return Object.fromEntries(Object.keys(defaults).map(k=>{
   const s=value[k],d=defaults[k];
   if(typeof s!=='string')throw Error('基本设置字段无效。');
   const v=typeof d==='number'?(/^(0|[1-9][0-9]*)$/.test(s)?Number(s):NaN):typeof d==='boolean'?(s==='true'?true:s==='false'?false:null):s;
   if(!valid(k,v))throw Error('基本设置值超出允许范围：'+k);
   return [k,v];
 }));
}
export function decodeDeviceBasic(record,envelope){
 if(record.module!=='appearance'||record.dependencies.length)return null;
 if(record.id===DEVICE_SETTINGS_ID&&envelope.kind==='device_basic_settings'&&!record.media_objects.length&&Object.keys(envelope.data||{}).join()==='basic_settings')return parseDeviceBasic(envelope.data.basic_settings);
 if(record.id==='native-appearance'&&envelope.kind==='appearance'&&envelope.data?.basic_settings)return parseDeviceBasic(envelope.data.basic_settings);
 return null;
}
export function restoreDeviceBasic(storage,values){
 const verified=parseDeviceBasic(captureDeviceBasic(values));
 // Revalidate exact values, not a clamped or partial input.
 if(Object.keys(values).length!==Object.keys(verified).length||Object.keys(verified).some(k=>values[k]!==verified[k]))throw Error('基本设置无效。');
 storage.update(state=>{state.runControl={...state.runControl,...verified};});
 if(Object.keys(verified).some(k=>storage.read().runControl[k]!==verified[k]))throw Error('基本设置保存未确认。');
}
