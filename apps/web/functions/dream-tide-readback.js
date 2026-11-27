import {readConversationState} from './chat-store.js';
import {readDreamSettings} from './dream-tide-ledger.js';
import {readDreamNotes,readDreamActivity} from './dream-tide-records.js';

export async function readDreamChatHistory(db,cid,input){
  const denied=()=>Object.assign(Error('当前窗口未授权回读自主活动。'),{type:'tool_forbidden',status:403});
  const allowed=async()=>!!cid&&!!await readDreamSettings(db,cid)&&(await readConversationState(db,cid))?.context_settings?.dream_readback_enabled===true;
  if(!await allowed())throw denied();
  if(!input||Object.keys(input).some(k=>!['kind','offset','limit'].includes(k)))throw Error('无效阅读参数。');
  const {kind,offset=0,limit=1}=input;
  if(!['notes','activity'].includes(kind)||!Number.isInteger(offset)||offset<0||offset>100000||!Number.isInteger(limit)||limit<1||limit>5)throw Error('无效阅读范围。');
  const rows=kind==='notes'?await readDreamNotes(db,cid,limit+1,offset):await readDreamActivity(db,cid,limit+1,offset);
  const items=rows.slice(0,limit).map(r=>kind==='notes'?{
    claim_id:r.claim_id,model_id:r.model_id,body:r.body,created_at:r.created_at,replies:r.replies.map(x=>({body:x.body,created_at:x.created_at}))
  }:{
    claim_id:r.claim_id,kind:r.kind,model_id:r.model_id,status:r.status,started_at:r.started_at,updated_at:r.updated_at,
    result:r.result?{total_tokens:r.result.total_tokens??null,reported_cost:r.result.reported_cost??null,extra_scheduled:r.result.extra_scheduled===true}:null,
    tools:r.tools.map(t=>({tool_name:t.tool_name,status:t.status}))
  });
  const result={ok:true,kind,reference_only:true,items,nextOffset:rows.length>limit?offset+limit:null};
  if(JSON.stringify(result).length>10000)throw Error('资料超出单次阅读容量，请减少条数。');
  if(!await allowed())throw denied();
  return result;
}
