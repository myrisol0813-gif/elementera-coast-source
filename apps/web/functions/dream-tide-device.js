import {claimDreamTide,dreamTideClaimAuthorized,heartbeatDreamTide,recoverDreamTide,recordDreamPhase} from './dream-tide-ledger.js';
import {dreamExecutionConfig,finishDreamActivity,reserveDreamStep,recordDreamStep,reserveDreamTool,recordDreamTool,readDreamHistory,previousDream,writeDreamNote} from './dream-tide-records.js';
import {buildDreamContext,buildDreamToolContext} from './dream-tide-executor.js';
import {recoverSingleChatRuns} from './chat-single-run.js';
import {recoverStaleReplyRuns} from './chat-reply-run.js';
import {executeModelTool} from './tool-registry-core.js';
import {proposeDreamMemory} from './dream-tide-memory.js';
import {generateDreamImage} from './dream-tide-image.js';
import {ensureChatSchema} from './chat-store.js';

// Internal device execution admission. The owner-authenticated HTTP route
// verifies its nonportable device grant before calling this function.
// Never accept account tokens
// or send a plan model to an API-key provider from this module.
export function deviceDreamPlanSlug(modelId){
  if(typeof modelId!=='string'||!modelId.startsWith('chatgpt-plan:'))return null;
  const slug=modelId.slice('chatgpt-plan:'.length);
  return /^[A-Za-z0-9_.:-]{1,160}$/.test(slug)?slug:null;
}

export async function claimDeviceDream(env,cid,{revision,modelId,now=Date.now(),clock=Date.now}={}){
  if(env.COAST_DEVICE_DREAM_TIDE_ENABLED!=='true'||!env.COAST_CHAT_DB)
    return {status:'disabled'};
  if(!deviceDreamPlanSlug(modelId)||typeof revision!=='string'||!revision)
    return {status:'not_authorized'};
  const db=env.COAST_CHAT_DB;
  const settings=await dreamExecutionConfig(db,cid,revision);
  if(!settings||settings.modelId!==modelId)return {status:'not_authorized'};
  await recoverSingleChatRuns(db,now);
  await recoverStaleReplyRuns(db,now,cid);
  await recoverDreamTide(db,now);
  // The same D1 unique slot, revision and ordinary chat exclusion apply to
  // device and server activity. No copy of the online window is made.
  const claim=await claimDreamTide(db,cid,{now,currentModelId:modelId,busy:false,expectedRevision:revision});
  if(!claim)return {status:'not_due'};
  let phase='context';
  try{
    if(!await recordDreamPhase(db,claim,phase,clock()))throw new Error('revoked');
    if(!await dreamTideClaimAuthorized(db,claim))throw new Error('revoked');
    const actual=await dreamExecutionConfig(db,cid,claim.revision);
    if(!actual||actual.modelId!==modelId)throw new Error('revoked');
    const context=await buildDreamContext(db,claim,actual,now,env);
    phase='tools_prepare';
    if(!await recordDreamPhase(db,claim,phase,clock()))throw new Error('revoked');
    const {allowed}=await buildDreamToolContext(env,claim,actual,now);
    phase='claim_response_ready';
    if(!await recordDreamPhase(db,claim,phase,clock()))throw new Error('revoked');
    return {status:'claimed',claim,settings:actual,context,tools:actual.execution.toolBudget?allowed:[]};
  }catch{
    // No inference was sent. Consume the claimed slot, never replay it.
    const authorized=await dreamTideClaimAuthorized(db,claim);
    await finishDreamActivity(db,claim,authorized?'failed':'cancelled',{
      reason:authorized?(phase==='tools_prepare'?'tool_context_unavailable':'context_unavailable'):'authorization_ended',phase,
      total_tokens:0,cost:null,activities:[],
    },clock());
    return {status:authorized?'context_unavailable':'authorization_ended'};
  }
}

const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);
const integer=(x,min=0)=>Number.isSafeInteger(x)&&x>=min;
const str=(x,max=160)=>typeof x==='string'&&x.length>0&&x.length<=max;
const exact=(a,keys)=>a&&typeof a==='object'&&!Array.isArray(a)&&Object.keys(a).length===keys.length&&keys.every(k=>Object.hasOwn(a,k));
export async function deviceKeyDigest(key){
  if(typeof key!=='string'||!/^[a-f0-9]{64}$/.test(key))return null;
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key)))].map(v=>v.toString(16).padStart(2,'0')).join('');
}
export async function deviceGrant(db,cid,revision,key){
  const digest=await deviceKeyDigest(key);
  if(!digest||!str(revision))return null;
  await ensureChatSchema(db);
  return await stmt(db,`SELECT model_id,device_request_limit FROM dream_tide_arms
    WHERE conversation_id=? AND revision=? AND enabled=1 AND device_digest=?`,cid,revision,digest).first();
}
async function liveClaim(db,cid,revision,claimId,modelId){
  const row=await stmt(db,`SELECT claim_id,started_at,model_id FROM dream_tide_runs WHERE conversation_id=? AND arm_revision=? AND claim_id=? AND model_id=? AND status='running'`,cid,revision,claimId,modelId).first();
  return row?{conversationId:cid,claimId,revision,modelId,startedAt:row.started_at}:null;
}
async function stepRows(db,claim){
  return (await stmt(db,'SELECT step_index,status,receipt_json,device_dispatch_done FROM dream_tide_steps WHERE claim_id=? ORDER BY step_index',claim.claimId).all()).results;
}
async function toolRows(db,claim){
  return (await stmt(db,'SELECT step_index,call_index,tool_name,status,receipt_json FROM dream_tide_tool_events WHERE claim_id=? ORDER BY step_index,call_index',claim.claimId).all()).results;
}
function reportedUsage(v){
  if(!v||typeof v!=='object'||!integer(v.total_tokens)||v.total_tokens>1000000000)return null;
  return {total_tokens:v.total_tokens,...Object.fromEntries(['prompt_tokens','completion_tokens'].filter(k=>integer(v[k])).map(k=>[k,v[k]]))};
}
function totals(rows){
  let total=0;
  for(const r of rows){
    const n=r.receipt_json?JSON.parse(r.receipt_json).usage?.total_tokens:null;
    if(r.status!=='completed'||!integer(n)||!Number.isSafeInteger(total+n))return null;
    total+=n;
  }
  return total;
}
const failure=reason=>({ok:false,reason});
function parseCalls(value){
  if(!Array.isArray(value)||value.length>128)return null;
  const seen=new Set(),calls=[];
  for(const call of value){
    const id=call?.id,name=call?.function?.name,args=call?.function?.arguments;
    if(!str(id)||seen.has(id)||typeof name!=='string'||!/^[a-zA-Z0-9_-]{1,120}$/.test(name)||typeof args!=='string'||args.length>60000)return null;
    let parsed;try{parsed=JSON.parse(args);}catch{return null;}
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return null;
    seen.add(id);calls.push({id,name,args,parsed});
  }
  return calls;
}
async function runDeviceTool(env,claim,actual,call,step,index,now,clock){
  const db=env.COAST_CHAT_DB,cid=claim.conversationId,e=actual.execution,name=call.name,a=call.parsed;
  const {toolContext,imageModel,commonNames,allowed}=await buildDreamToolContext(env,claim,actual,claim.startedAt);
  if(!allowed.some(t=>t.function.name===name)||!await reserveDreamTool(db,claim,step,index,name,now))return failure('unavailable_or_budget');
  let result=failure('unavailable_or_invalid');
  try{
    if(!await dreamTideClaimAuthorized(db,claim))throw Error('revoked');
    if(name==='dream_read_history'&&exact(a,['mode','start','count'])){
      const previous=await previousDream(db,claim);
      result=await readDreamHistory(db,cid,{...a,since:previous?.started_at??null,until:claim.startedAt,maxTurns:e.readTurns});
    }else if(name==='dream_write_note'&&exact(a,['body'])){
      result={ok:await writeDreamNote(db,claim,a.body,now)};
    }else if(name==='dream_schedule_extra'&&exact(a,['at'])&&typeof a.at==='string'&&/(Z|[+-]\d{2}:\d{2})$/.test(a.at)){
      const at=Date.parse(a.at),rows=await toolRows(db,claim);
      const prior=rows.some(r=>r.receipt_json&&JSON.parse(r.receipt_json).proposed_extra_at);
      if(integer(at,now+1)&&!prior)result={ok:true,status:'proposed_pending_completion',proposed_extra_at:at};
    }else if(name==='dream_memory_candidate'&&exact(a,['title','content','destination'])){
      const v=await proposeDreamMemory(db,a,{...toolContext,autonomous_event:{step,index}},now);
      result={ok:true,data:v,...(v.id?{record_id:v.id}:{})};
    }else if(name==='image_generate'&&imageModel&&exact(a,['prompt'])){
      const v=await generateDreamImage(db,env,a,{...toolContext,autonomous_event:{step,index}},{expectedModel:imageModel});
      result={ok:true,record_id:v.id,data:{...v,readback:'not_delivered'}};
    }else if(commonNames.has(name)&&!(name==='library_write'&&a.action!=='create')&&!(name==='create_diary'&&('replace_id' in a||'conflict_mode' in a))){
      const callId='dream:'+claim.claimId+':'+step+':'+index;
      const value=await executeModelTool(db,{id:callId,type:'function',function:{name,arguments:call.args}},{...toolContext,tool_call_id:callId,autonomous_event:{step,index}});
      const recordId=name==='library_write'?value?.note?.id:['create_moment','create_diary'].includes(name)?value?.record_id:['calendar_create','voice_create'].includes(name)?value?.id:null;
      result=JSON.stringify(value).length<=24000?{ok:value?.ok!==false,data:value,...(recordId?{record_id:recordId}:{})}:recordId?{ok:true,record_id:recordId,reason:'saved_result_body_omitted'}:failure('result_too_large');
    }
  }catch{result=failure('tool_failed');}
  const receipt={ok:result.ok===true||(Array.isArray(result.turns)&&!result.reason),...(Array.isArray(result.turns)?{count:result.turns.length}:{}),...(result.record_id?{record_id:result.record_id}:{}),...(result.proposed_extra_at?{proposed_extra_at:result.proposed_extra_at}:{})};
  if(!await recordDreamTool(db,claim,step,index,receipt,clock()))return failure('tool_settlement_unconfirmed');
  return result;
}
/** Owner-authenticated route calls this only with the nonportable device key.
 * It accepts normalized receipts and tool arguments, never OAuth credentials,
 * raw provider output, reasoning items, or the model's private final text. */
export async function deviceDreamAction(env,cid,value,now=Date.now(),clock=Date.now){
  if(env.COAST_DEVICE_DREAM_TIDE_ENABLED!=='true')return failure('disabled');
  const db=env.COAST_CHAT_DB,grant=await deviceGrant(db,cid,value.revision,value.deviceKey);
  if(!grant||!deviceDreamPlanSlug(grant.model_id)||value.modelId!==grant.model_id)return failure('not_authorized');
  if(value.action==='claim'){
    const result=await claimDeviceDream(env,cid,{revision:value.revision,modelId:grant.model_id,now,clock});
    if(result.status!=='claimed')return {ok:false,reason:result.status};
    // Do not transfer the prior raw ledger row; context already includes
    // the selected and labeled previous-activity summary.
    return {ok:true,claim:result.claim,settings:result.settings,instructions:result.context.messages[0].content,tools:result.tools,requestLimit:grant.device_request_limit};
  }
  const claim=await liveClaim(db,cid,value.revision,value.claim_id,grant.model_id);
  if(!claim||!await dreamTideClaimAuthorized(db,claim))return failure('authorization_ended');
  if(value.action==='heartbeat')return {ok:await heartbeatDreamTide(db,claim,now)};
  if(value.action==='received')return {ok:await recordDreamPhase(db,claim,'device_received',now)};
  const actual=await dreamExecutionConfig(db,cid,value.revision);
  if(!actual)return failure('authorization_ended');
  const rows=await stepRows(db,claim),used=totals(rows),index=value.step;
  if(value.action==='reserve'){
    if(!integer(index)||index!==rows.length||index>=grant.device_request_limit||index>actual.execution.toolBudget||used===null||used>=actual.execution.tokenBudget||rows.at(-1)?.receipt_json&&JSON.parse(rows.at(-1).receipt_json).finish_reason!=='tool_calls')return failure('request_budget_or_sequence');
    const events=await toolRows(db,claim);
    if(events.some(r=>r.status==='claimed')||rows.some(r=>r.device_dispatch_done!==1))return failure('tool_unconfirmed');
    const reserved=await reserveDreamStep(db,claim,index,now);
    if(reserved)await recordDreamPhase(db,claim,'request_reserved',now);
    return {ok:reserved};
  }
  if(value.action==='step'){
    if(!integer(index)||rows.at(-1)?.step_index!==index||rows.at(-1)?.status!=='claimed')return failure('step_not_reserved');
    const calls=parseCalls(value.calls),usage=reportedUsage(value.usage);
    const finish=value.finish;
    if(!calls||!['stop','tool_calls','failed'].includes(finish)||finish==='stop'&&calls.length||finish==='tool_calls'&&!calls.length||finish==='failed'&&calls.length)return failure('invalid_step');
    const receipt={usage,cost:null,model:grant.model_id,finish_reason:finish,requested_tools:calls.map(c=>c.name)};
    if(finish==='failed')receipt.error_type=typeof value.reason==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(value.reason)?value.reason:'plan_request_unconfirmed';
    if(!await recordDreamStep(db,claim,index,finish==='failed'?'failed':'completed',receipt,now))return failure('step_unconfirmed');
    await recordDreamPhase(db,claim,'tool_dispatch',now);
    const results=[];
    const after=usage&&totals([...rows.slice(0,-1),{status:'completed',receipt_json:JSON.stringify(receipt)}]);
    // A last request must have no tools; unknown usage is terminal.
    for(let i=0;i<calls.length;i++){
      const c=calls[i];let result=failure('budget_or_usage_unknown');
      if(after!==null&&after<actual.execution.tokenBudget&&index<actual.execution.toolBudget&&index+1<grant.device_request_limit&&await dreamTideClaimAuthorized(db,claim))
        result=await runDeviceTool(env,claim,actual,c,index,i,clock(),clock);
      results.push({role:'tool',tool_call_id:c.id,name:c.name,content:JSON.stringify(result)});
    }
    const dispatch=await stmt(db,"UPDATE dream_tide_steps SET device_dispatch_done=1 WHERE claim_id=? AND step_index=? AND device_dispatch_done=0",claim.claimId,index).run();
    if(dispatch.meta.changes!==1)return failure('tool_settlement_unconfirmed');
    await recordDreamPhase(db,claim,'step_recorded',clock());
    return {ok:true,results,canContinue:finish==='tool_calls'&&after!==null&&after<actual.execution.tokenBudget&&index<actual.execution.toolBudget&&index+1<grant.device_request_limit};
  }
  if(value.action==='finish'){
    const last=rows.at(-1),lastReceipt=last?.receipt_json?JSON.parse(last.receipt_json):null,events=await toolRows(db,claim);
    if(events.some(x=>x.status==='claimed')||rows.some(x=>x.status==='completed'&&x.device_dispatch_done!==1))return failure('tool_settlement_unconfirmed');
    const completed=value.completed===true&&last?.status==='completed'&&lastReceipt?.finish_reason==='stop'&&last.device_dispatch_done===1&&used!==null&&!events.some(x=>x.status==='claimed');
    const reason=completed?'ended':typeof value.reason==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(value.reason)?value.reason:'plan_incomplete';
    const proposed=events.map(x=>x.receipt_json?JSON.parse(x.receipt_json).proposed_extra_at:null).find(x=>integer(x,1));
    const result={reason,phase:typeof value.phase==='string'&&['device_received','request_prepare','request_reserved','provider_wait','step_delivery','finish'].includes(value.phase)?value.phase:'finish',total_tokens:used,reported_cost:null,tool_calls:events.length,activities:events.map(x=>({kind:x.tool_name,ok:x.status==='completed'})),accounting:'device plan reported usage; separate media costs not included; soft budget',...(proposed?{proposed_extra_at:proposed}:{})};
    const settled=await finishDreamActivity(db,claim,completed?'completed':'failed',result,now);
    return {ok:settled.finished,status:completed?'completed':'failed',extraScheduled:settled.extraScheduled};
  }
  return failure('invalid_action');
}
