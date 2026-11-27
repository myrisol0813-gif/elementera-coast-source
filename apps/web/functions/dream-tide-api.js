import {ChatStoreError} from './chat-store.js';
import {json,readJson,sameOrigin,methodNotAllowed} from './http.js';
import {readDreamSettings,configureDreamTide,disarmDreamTide} from './dream-tide-ledger.js';
import {readDreamNotes,readDreamActivity,replyDreamNote} from './dream-tide-records.js';

const base='/api/chat/dream-tide';
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(v);
const invalid=()=>new ChatStoreError('dream_tide_invalid','自主唤醒设置或请求无效。',400);
const conflict=()=>new ChatStoreError('dream_tide_conflict','设置已改变，或活动尚未结束；请刷新。',409);
export const isDreamTidePath=path=>[base,base+'/notes',base+'/activity',base+'/reply'].includes(path);
export async function routeDreamTide(request,env){
  const u=new URL(request.url),db=env.COAST_CHAT_DB;
  const path=u.pathname,method=request.method;
  if(!isDreamTidePath(path))return json({ok:false},404);
  const readable=path!==base+'/reply';
  if(method==='GET'&&readable){
    const cid=u.searchParams.get('conversation_id');
    if(!id(cid))throw invalid();
    const settings=await readDreamSettings(db,cid);
    if(!settings)throw new ChatStoreError('dream_window_unavailable','此窗口不支持自主唤醒。',404);
    if(path===base)return json({ok:true,settings,executionAvailable:env.COAST_DREAM_TIDE_ENABLED==='true',schedulerConfigured:env.COAST_DREAM_TIDE_SCHEDULER==='true'});
    const limit=Number(u.searchParams.get('limit')||20),offset=Number(u.searchParams.get('offset')||0);
    if(!Number.isSafeInteger(limit)||limit<1||limit>100||!Number.isSafeInteger(offset)||offset<0)throw invalid();
    const rows=path===base+'/notes'?await readDreamNotes(db,cid,limit,offset):await readDreamActivity(db,cid,limit,offset);
    return json({ok:true,items:rows,nextOffset:rows.length===limit?offset+rows.length:null});
  }
  if(method!=='POST'||![base,base+'/reply'].includes(path))return methodNotAllowed(path===base?'GET, POST':readable?'GET':'POST');
  if(!sameOrigin(request))throw new ChatStoreError('forbidden','Forbidden.',403);
  let value;
  try{value=await readJson(request,64*1024);}catch{throw invalid();}
  if(!value||typeof value!=='object'||Array.isArray(value)||!id(value.conversation_id))throw invalid();
  const cid=value.conversation_id,settings=await readDreamSettings(db,cid);
  if(!settings)throw new ChatStoreError('dream_window_unavailable','此窗口不支持自主唤醒。',404);
  if(path===base+'/reply'){
    if(!id(value.claim_id)||!id(value.reply_id)||typeof value.body!=='string'||!value.body.trim()||value.body.length>16000)throw invalid();
    if(await replyDreamNote(db,cid,value.claim_id,value.reply_id,value.body))return json({ok:true});
    const same=await db.prepare("SELECT 1 FROM dream_tide_replies WHERE id=? AND conversation_id=? AND claim_id=? AND body=?").bind(value.reply_id,cid,value.claim_id,value.body).first();
    if(!same)throw new ChatStoreError('dream_reply_conflict','自主手记不存在或回复身份冲突。',409);
    return json({ok:true,duplicate:true});
  }
  if(!Object.hasOwn(value,'revision')||value.revision!==settings.revision)throw conflict();
  if(value.action==='disarm'){
    if(settings.enabled&&!await disarmDreamTide(db,cid,value.revision))throw conflict();
    return json({ok:true,settings:await readDreamSettings(db,cid)});
  }
  if(!['save','arm'].includes(value.action)||typeof value.modelId!=='string'||!/^[-\w.]+\/[\w.:-]+$/.test(value.modelId))throw invalid();
  const enable=value.action==='arm';
  if(enable&&(value.confirmExecution!==true||env.COAST_DREAM_TIDE_ENABLED!=='true'||env.COAST_DREAM_TIDE_SCHEDULER!=='true'))
    throw new ChatStoreError('dream_tide_not_available','尚未开通实际调度，或没有明确执行授权；设置可以先保存。',409);
  let saved;
  try{saved=await configureDreamTide(db,cid,value.config,value.modelId,{expectedRevision:value.revision,enable});}
  catch(e){if(e instanceof TypeError||e instanceof RangeError)throw invalid();throw e;}
  if(!saved)throw conflict();
  return json({ok:true,settings:saved});
}
