import {claimDreamTide,dreamTideClaimAuthorized,heartbeatDreamTide,settleDreamTide,recoverDreamTide} from './dream-tide-ledger.js';
import {recoverSingleChatRuns} from './chat-single-run.js';
import {recoverStaleReplyRuns} from './chat-reply-run.js';
import {dreamExecutionConfig,reserveDreamStep,recordDreamStep,reserveDreamTool,recordDreamTool,writeDreamNote,readDreamNotes,readDreamHistory,previousDream,finishDreamActivity} from './dream-tide-records.js';
import {prepareFormalChat} from './models/model-payload.js';
import {requestOpenRouter} from './models/model-formal-chat.js';
import {normalizeUsage,normalizeToolCalls} from './models/model-validation.js';
import {readConversationState} from './chat-store.js';
import {readCustomInstructions,readUserPortrait,readGlobalExcerpt} from './memory-store.js';
import {buildRealityContext} from './reality-context.js';
import {localClock} from './dream-tide-schedule.js';
import {dreamToolNames} from './dream-tide-policy.js';
import {autonomousVoiceConfigured} from './voice-clips.js';
import {autonomousImageModel,generateDreamImage} from './dream-tide-image.js';
import {resolveToolSelection,executeModelTool} from './tool-registry-core.js';
import {estimateWireInputTokens,assertWireInputBudget} from './context-budget.js';

const tool=(name,description,properties,required)=>({type:'function',function:{name,description,parameters:{type:'object',properties,required,additionalProperties:false}}});
const integer={type:'integer'},string={type:'string'};
const toolsFor=(cfg,extraAllowed)=>[
  ...(cfg.readHistory?[tool('dream_read_history','自行选读本窗口完整历史轮次，从零开始分页；since_previous 仅返回两次唤醒之间的对话。',{mode:{type:'string',enum:['window','since_previous']},start:integer,count:integer},['mode','start','count'])]:[]),
  ...(cfg.writeNote?[tool('dream_write_note','可选：写一封独立自主手记，屋主可以稍后回复。不必写，也不发送普通聊天消息。',{body:string},['body'])]:[]),
  ...(extraAllowed?[tool('dream_schedule_extra','可选：安排一次未来额外唤醒，时间为带时区的 ISO 8601 字符串。不会立即执行。',{at:string},['at'])]:[]),
];
const actualCost=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
function parseArgs(call){
  try{const a=JSON.parse(call.function.arguments);return a&&typeof a==='object'&&!Array.isArray(a)?a:null;}catch{return null;}
}
const exact=(a,keys)=>a&&Object.keys(a).length===keys.length&&keys.every(k=>Object.hasOwn(a,k));
function safeError(error){return String(error?.type||error?.name||'execution_failed').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,100)||'execution_failed';}
function clockText(now,zone){
  return new Intl.DateTimeFormat('zh-CN',{timeZone:zone,dateStyle:'full',timeStyle:'long'}).format(now);
}
export async function buildDreamContext(db,claim,settings,now,env={COAST_CHAT_DB:db}){
  const e=settings.execution,prev=await previousDream(db,claim);
  const modules=['【自主唤醒 · 系统发起的独立活动】这不是用户新发言。可以探索或安静结束；无需产出聊天消息，不必使用任何工具。',e.invitation];
  if(e.includeTime)modules.push('【当前时间】'+clockText(now,settings.timeZone));
  if(e.includePrevious&&prev){
    const result=prev.result_json?JSON.parse(prev.result_json):null;
    modules.push('【上次活动】'+JSON.stringify({status:prev.status,elapsed_ms:Math.max(0,now-prev.started_at),activities:result?.activities||[]}));
  }
  if(e.includeReplies){
    const notes=await readDreamNotes(db,claim.conversationId,10);
    // Whole notes/replies only, newest first. Omission is explicit.
    const selected=[];let omitted=0;
    for(const n of notes){
      const row={id:n.claim_id,body:n.body,replies:n.replies.map(x=>({body:x.body,created_at:x.created_at}))};
      if(JSON.stringify([...selected,row]).length>24000){omitted++;continue;}
      selected.push(row);
    }
    modules.push('【自主手记与回复 · 历史资料，不是新发言】'+JSON.stringify({notes:selected,omitted,scope:'最近最多十封'}));
  }
  // Opt-in whole documents, no automatic memory recall or invented activity.
  if(e.includeCustom){const doc=await readCustomInstructions(db);if(doc?.content?.trim())modules.push('【核心自定义】'+doc.content);}
  if(e.includeUserPortrait){const doc=await readUserPortrait(db);if(doc?.body?.trim())modules.push('【用户画像】'+doc.body);}
  if(e.includeSelfPortrait){const doc=await readGlobalExcerpt(db);if(doc?.body?.trim())modules.push('【自我画像】'+doc.body);}
  if(e.includeConversationCount||e.includeWeather||e.includeCalendar){
    const history=await readConversationState(db,claim.conversationId);
    if(e.includeConversationCount&&prev){
      const n=history.turns.filter(t=>{const u=t.user.variants[t.user.active],at=Date.parse(u?.created_at);return u&&!u.hidden&&Number.isFinite(at)&&at>prev.started_at&&at<=now;}).length;
      modules.push('【期间新增对话轮数】'+n+'（当前窗口，按用户消息实际时间）');
    }
    const fields=[...(e.includeWeather?['weather']:[]),...(e.includeCalendar?['calendar']:[])];
    if(fields.length){
      const reality=await buildRealityContext(env,{settings:history.context_settings,localDate:localClock(now,settings.timeZone).day,allowedFields:fields});
      if(reality.text)modules.push('【已授权现实上下文】'+reality.text);
      if(reality.missing?.length)modules.push('【未取得的现实资料】'+reality.missing.join('、'));
    }
  }
  // A server worker has no device snapshot. Do not infer step counts or app use.
  if(e.includeSteps||e.includeAppUsage)modules.push('【设备资料】本次服务端唤醒未取得设备步数或应用使用数据。');
  return {messages:[{role:'system',content:modules.join('\n\n')}],previous:prev};
}

// Internal executor, not a public API. The deployment gate must be explicitly
// enabled and the caller must be trusted. Native plan models are intentionally
// not sent to OpenRouter. No scheduler is installed by this module.
export async function executeDreamTide(env,cid,{currentModelId,busy=true,signal,expectedRevision=null,now=Date.now(),
  prepare=prepareFormalChat,invoke=requestOpenRouter,clock=Date.now}={}){
  const db=env.COAST_CHAT_DB;
  if(env.COAST_DREAM_TIDE_ENABLED!=='true'||busy!==false||signal?.aborted)return {status:'disabled_or_busy'};
  const config=await dreamExecutionConfig(db,cid,expectedRevision);
  if(!config||currentModelId!==config.modelId||!/^[-\w.]+\/.+/.test(currentModelId))return {status:'not_authorized'};
  await recoverSingleChatRuns(db,now);
  await recoverStaleReplyRuns(db,now,cid);
  await recoverDreamTide(db,now);
  const claim=await claimDreamTide(db,cid,{now,currentModelId,busy:false,expectedRevision:config.revision});
  if(!claim)return {status:'not_due'};
  const controller=new AbortController(),abort=()=>controller.abort();
  if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  let pending=null;
  const heartbeat=setInterval(()=>{
    if(pending)return;
    pending=heartbeatDreamTide(db,claim,clock()).then(ok=>{if(!ok)abort();},abort).finally(()=>{pending=null;});
  },15000);
  let status='failed',reason=null,used=0,cost=0,known=true,costKnown=true,calls=0,extraAt=null,activities=[];
  const authorize=async()=>{
    if(controller.signal.aborted||!await dreamTideClaimAuthorized(db,claim))throw new DOMException('Aborted','AbortError');
  };
  try{
    const actual=await dreamExecutionConfig(db,cid,claim.revision);
    if(!actual||actual.modelId!==currentModelId)throw new DOMException('Aborted','AbortError');
    await authorize();
    const e=actual.execution,context=await buildDreamContext(db,claim,actual,now,env);
    await authorize();
    const toolContext={permission:'owner',surface:'main_chat',env,conversation_id:cid,source_turn_id:null,
      model_label:currentModelId,local_date:localClock(now,actual.timeZone).day,autonomous_activity:true,autonomous_claim:claim,autonomous_tool_names:dreamToolNames(actual).filter(name=>name!=='voice_create'||autonomousVoiceConfigured(env)),
      independent_web_enabled:e.allowWeb===true};
    const common=resolveToolSelection(toolContext).modelVisibleTools.map(t=>t.function.name==='create_diary'?{...t,function:{...t.function,description:'可选：创建自己的日记，追加而不替换既有日记。',parameters:{...t.function.parameters,properties:Object.fromEntries(Object.entries(t.function.parameters.properties).filter(([k])=>!['replace_id','conflict_mode'].includes(k)))}}}:t.function.name==='create_moment'?{...t,function:{...t.function,description:'可选：在海岸内部新增自己的动态，不外发。'}}:t.function.name==='library_write'?{
      ...t,function:{...t.function,description:'可选：创建自己的书房批注、划线或读后感。此次活动不修改或删除既有笔记。',parameters:{...t.function.parameters,properties:{...t.function.parameters.properties,action:{type:'string',enum:['create']}}}}
    }:t);
    const imageModel=e.allowImage&&e.imageLimit>0?await autonomousImageModel(db,env):null;
    const imageTool=imageModel?tool('image_generate','可选：生成并保存一张独立活动图像，使用已授权生图供应商额度。只发送必要绘图提示。不返回像素，不要假称看见。', {prompt:{type:'string',minLength:1,maxLength:4000}},['prompt']):null;
    let imageAttempts=0,voiceAttempts=0;
    const commonNames=new Set(common.map(t=>t.function.name));
    const allowed=[...toolsFor(e,actual.allowExtra&&e.extraPerDay>0),...common,...(imageTool?[imageTool]:[])];
    const prepared=await prepare(env,{model:currentModelId,messages:context.messages,tools:e.toolBudget?allowed:[],settings:{max_tokens:e.outputLimit}},true);
    if(prepared.modelId!==currentModelId||prepared.payload.model!==currentModelId)throw Error('model route mismatch');
    let messages=prepared.payload.messages;
    for(let index=0;index<=e.toolBudget;index++){
      await authorize();
      const remaining=e.tokenBudget-used;
      const payload={...prepared.payload,messages};
      if(calls>=e.toolBudget||index===e.toolBudget){delete payload.tools;delete payload.tool_choice;}
      const estimate=estimateWireInputTokens(payload);
      const output=Math.min(e.outputLimit,remaining-estimate);
      if(!known||output<1){reason='budget_or_usage_unknown';break;}
      payload.max_completion_tokens=output;
      if('max_tokens' in payload)payload.max_tokens=output;
      assertWireInputBudget(payload);
      if(!await reserveDreamStep(db,claim,index,clock()))throw new DOMException('Aborted','AbortError');
      // A durable reservation is recorded before the potentially billable request.
      let raw;
      try{await authorize();raw=await invoke(env,payload,'Elementera Coast Dream Tide',controller.signal);}
      catch(error){
        await recordDreamStep(db,claim,index,'failed',{error_type:safeError(error),usage:null,cost:null},clock());
        known=false;costKnown=false;throw error;
      }
      const usage=normalizeUsage(raw?.usage),stepCost=actualCost(raw?.usage?.cost),choice=raw?.choices?.[0];
      if(usage)used+=usage.total_tokens;else known=false;
      if(stepCost===null)costKnown=false;else cost+=stepCost;
      let requested;
      try{requested=normalizeToolCalls(choice?.message?.tool_calls);}
      catch(error){await recordDreamStep(db,claim,index,'failed',{error_type:safeError(error),usage,cost:stepCost},clock());throw error;}
      const receipt={usage,cost:stepCost,model:typeof raw?.model==='string'?raw.model.slice(0,180):null,
        finish_reason:typeof choice?.finish_reason==='string'?choice.finish_reason.slice(0,80):null,requested_tools:requested.map(x=>x.function.name)};
      if(!await recordDreamStep(db,claim,index,'completed',receipt,clock()))throw new DOMException('Aborted','AbortError');
      await authorize();
      if(!choice||!known||used>=e.tokenBudget){reason='budget_or_usage_unknown';break;}
      if(!requested.length){
        if(choice.finish_reason==='stop'){status='completed';reason='ended';}
        else reason='provider_incomplete';
        break;
      }
      if(choice.finish_reason!=='tool_calls'||!payload.tools?.length){reason='unexpected_tool_request';break;}
      const exposed=new Set(payload.tools.map(t=>t.function?.name)),results=[];
      for(const [callIndex,call] of requested.entries()){
        const name=call.function.name,a=parseArgs(call);
        let result={ok:false,reason:'unavailable_or_invalid'};
        if(calls<e.toolBudget&&exposed.has(name)&&!(name==='voice_create'&&voiceAttempts>=e.voiceLimit)&&!(name==='image_generate'&&imageAttempts>=e.imageLimit)){
          await authorize();
          if(!await reserveDreamTool(db,claim,index,callIndex,name,clock()))throw new DOMException('Aborted','AbortError');
          calls++;
          if(name==='voice_create')voiceAttempts++;
          if(name==='image_generate')imageAttempts++;
          try{
            if(name==='dream_read_history'&&exact(a,['mode','start','count'])){
              result=await readDreamHistory(db,cid,{...a,since:context.previous?.started_at??null,until:now,maxTurns:e.readTurns});
              activities.push({kind:'history_read',ok:!result.reason,count:result.turns.length});
            }else if(name==='dream_write_note'&&exact(a,['body'])){
              result={ok:await writeDreamNote(db,claim,a.body,clock())};activities.push({kind:'note',ok:result.ok});
            }else if(name==='dream_schedule_extra'&&exact(a,['at'])&&typeof a.at==='string'&&/(Z|[+-]\d{2}:\d{2})$/.test(a.at)&&extraAt===null){
              const at=Date.parse(a.at);
              if(Number.isSafeInteger(at)&&at>clock()){extraAt=at;result={ok:true,status:'proposed_pending_completion'};}
              activities.push({kind:'extra_requested',ok:result.ok});
            }else if(name==='image_generate'&&imageModel&&exact(a,['prompt'])){
              const value=await generateDreamImage(db,env,a,{...toolContext,autonomous_event:{step:index,index:callIndex}},{expectedModel:imageModel});
              result={ok:true,record_id:value.id,data:value};activities.push({kind:name,ok:true});
            }else if(commonNames.has(name)&&a&&!(name==='library_write'&&a.action!=='create')&&!(name==='create_diary'&&('replace_id' in a||'conflict_mode' in a))){
              // Recheck revision and current registry permission immediately
              // before dispatch; the registry still validates its own arguments.
              await authorize();
              const callId='dream:'+claim.claimId+':'+index+':'+callIndex;
              const value=await executeModelTool(db,{...call,id:callId},{...toolContext,tool_call_id:callId,autonomous_event:{step:index,index:callIndex}});
              if(name==='library_write'&&value?.note?.id)result.record_id=value.note.id;
              if(['create_moment','create_diary'].includes(name)&&value?.record_id)result.record_id=value.record_id;
              if(['calendar_create','voice_create'].includes(name)&&value?.id)result.record_id=value.id;
              const encoded=JSON.stringify(value);
              result=encoded.length<=24000?{ok:value?.ok!==false,data:value,...(result.record_id?{record_id:result.record_id}:{})}:result.record_id?{ok:true,record_id:result.record_id,reason:'saved_result_body_omitted'}:{ok:false,reason:'result_too_large'};
              activities.push({kind:name,ok:result.ok});
            }
          }catch{result={ok:false,reason:'tool_failed'};activities.push({kind:name,ok:false});}
          const receipt={ok:result.ok===true||(name==='dream_read_history'&&Array.isArray(result.turns)&&!result.reason),...(Array.isArray(result.turns)?{count:result.turns.length}:{}),...(result.record_id?{record_id:result.record_id}:{})};
          if(!await recordDreamTool(db,claim,index,callIndex,receipt,clock()))throw new DOMException('Aborted','AbortError');
        }
        results.push({role:'tool',tool_call_id:call.id,name,content:JSON.stringify(result)});
      }
      messages=[...messages,{role:'assistant',content:typeof choice.message.content==='string'?choice.message.content:null,tool_calls:requested},...results];
    }
  }catch(error){reason=safeError(error);status=error?.name==='AbortError'?'cancelled':'failed';}
  finally{
    clearInterval(heartbeat);signal?.removeEventListener('abort',abort);if(pending)await pending;
  }
  const result={reason,activities,tool_calls:calls,total_tokens:known?used:null,reported_cost:costKnown?cost:null,
    ...(extraAt!==null?{proposed_extra_at:extraAt}:{}),accounting:'chat provider reported; separate media cost not included; input estimate is not a hard billing guarantee'};
  const settled=await finishDreamActivity(db,claim,status,result,clock());
  if(!settled.finished){
    await settleDreamTide(db,claim,'interrupted',clock());
    return {status:'unconfirmed',claimId:claim.claimId};
  }
  return {status,claimId:claim.claimId,...result,extraScheduled:settled.extraScheduled};
}
