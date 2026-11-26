// A sequence owns one user variant and several real provider invocations.
// The adapter must persist a fresh exact message reservation before invoking,
// and return the canonical committed message (including media/tool receipts).
// No timer, automatic retries, fabricated user turn or text splitting here.
const ID=/^[A-Za-z0-9_.:-]{1,160}$/;
function validId(s){return typeof s==='string'&&ID.test(s);}
export function replySequenceLimit(value){
  // Current branch storage permits at most 20 variant records. This is a
  // compatibility ceiling, not a recommendation to spend 20 generations.
  if(!Number.isInteger(value)||value<1||value>20)throw Error('invalid_reply_sequence_limit');
  return value;
}
export function makeContinueReplyControl(allowed){
  let requested=false;
  const tool={type:'function',function:{name:'continue_reply',description:'如果本条真实回复结束后，你自主想再发一条独立消息，可以调用此工具。无需为了用满额度而调用。未调用即结束本组。',parameters:{type:'object',properties:{},required:[],additionalProperties:false}}};
  return Object.freeze({
    tools:allowed===true?[tool]:[],
    execute(call){
      if(!allowed||call?.function?.name!=='continue_reply'||requested)return {ok:false,error:'continuation_unavailable'};
      let args;try{args=JSON.parse(call.function.arguments||'{}');}catch{return {ok:false,error:'invalid_arguments'};}
      if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).length)return {ok:false,error:'invalid_arguments'};
      requested=true;return {ok:true,status:'next_message_requested'};
    },
    requested:()=>requested,
  });
}
/** One execution per acquired durable sequence. reserve() MUST reject duplicate
 * or stale IDs atomically. commit() MUST check that exact reservation. The
 * adapter owns storage, permission, budget/tool accounting and provider I/O.
 * settle() is called once even on interruption; it must not replay requests.
 * organize() receives only canonically saved successful messages, once.
 */
export async function runReplySequence({conversationId,turnId,userVariantId,sequenceId,maxMessages,signal,
  newMessageId,acquire,reserve,invoke,commit,settle,organize,canContinue=async()=>true}){
  if(![conversationId,turnId,userVariantId,sequenceId].every(validId))throw Error('invalid_reply_sequence_identity');
  const max=replySequenceLimit(maxMessages),identity=Object.freeze({conversationId,turnId,userVariantId,sequenceId});
  if(signal?.aborted)return {status:'cancelled',messages:[]};
  if(await acquire(identity)!==true)return {status:'not_acquired',messages:[]};
  const messages=[],ids=new Set();
  let pending=null,status='completed',failure=null;
  try{
    for(let index=0;index<max;index++){
      if(signal?.aborted){status='cancelled';break;}
      if(index>0&&await canContinue(identity,messages.slice())!==true){status='permission_or_budget';break;}
      const id=newMessageId();
      if(!validId(id)||ids.has(id))throw Error('duplicate_reply_message_id');
      ids.add(id);
      const step=Object.freeze({...identity,messageId:id,index,mayContinue:index+1<max});
      if(await reserve(step)!==true){status='reservation_lost';break;}
      pending=step;
      // A cancelled reservation never causes an additional provider call.
      if(signal?.aborted){status='cancelled';break;}
      const result=await invoke(step,messages.slice(),signal);
      const saved=await commit(step,result);
      if(!saved||saved.id!==id)throw Error('reply_commit_unconfirmed');
      pending=null;messages.push(saved);
      if(signal?.aborted){status='cancelled';break;}
      if(result?.continueRequested!==true||result?.successful!==true)break;
      if(index+1===max)status='limit_reached';
    }
  }catch(e){status=signal?.aborted?'cancelled':'failed';failure=e;}
  const receipt={...identity,status,pending,messages:messages.slice()};
  // If settle fails, fail closed; no new generation or unconfirmed organization.
  await settle(receipt);
  if(messages.length)await organize(receipt);
  return {status,messages:messages.slice(),...(failure?{error:failure}:{})};
}

/** A selected regeneration alternative is either a legacy single message
 * or the entire contiguous sequence. Keep raw indices for exact operations;
 * a sequence is not a list of replacement candidates. */
export function selectedReplyGroup(variants,activeIndex){
  const active=variants[activeIndex];
  if(!active)return [];
  const id=active.reply_sequence?.id;
  if(!id)return [active];
  const group=variants.filter(v=>v.reply_sequence?.id===id).sort((a,b)=>a.reply_sequence.index-b.reply_sequence.index);
  if(group.some((v,i)=>v.reply_sequence.index!==i))throw Error('invalid_reply_sequence_group');
  return group;
}

// One navigation entry per alternative, even if its messages have several IDs.
// Keep the raw index of the last message as the existing active pointer.
export function replyAlternatives(variants){
  const seen=new Set(),out=[];
  variants.forEach((variant,index)=>{
    if(seen.has(variant.id))return;
    const messages=selectedReplyGroup(variants,index);
    for(const message of messages)seen.add(message.id);
    out.push({messages,activeIndex:variants.indexOf(messages[messages.length-1])});
  });
  return out;
}

// A snapshot of human-editable group settings. Window overrides do not
// mutate device defaults. Capacity is a physical storage bound, not a quota.
export function resolveReplySequenceBudget(global={},window={},usedVariants=0){
  const valid=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
  const choose=(override,value,fallback,min,max)=>valid(override,min,max)?override:valid(value,min,max)?value:fallback;
  if(!Number.isSafeInteger(usedVariants)||usedVariants<0)throw Error('invalid_reply_sequence_capacity');
  const enabled=window.reply_sequence_enabled===true;
  const maxMessages=Math.min(enabled?choose(window.reply_sequence_max_messages,global.replySequenceMaxMessages,3,1,20):1,Math.max(0,20-usedVariants));
  return Object.freeze({enabled,maxMessages,
    toolBudget:choose(window.reply_sequence_tool_budget,global.replySequenceToolBudget,24,0,128),
    tokenBudget:choose(window.reply_sequence_token_budget,global.replySequenceTokenBudget,48000,1,1000000)});
}
// Authoritative completed-request receipts only. A missing/invalid usage
// receipt cannot be treated as free. This is a continuation gate, not a
// promise that a provider will enforce an exact token or monetary ceiling.
export function remainingReplySequenceBudget(budget,receipts){
  let tools=0,tokens=0;
  for(const r of receipts){
    if(!Number.isSafeInteger(r?.toolCalls)||r.toolCalls<0||!Number.isSafeInteger(r?.totalTokens)||r.totalTokens<0)
      return {known:false,tools:0,tokens:0};
    tools+=r.toolCalls;tokens+=r.totalTokens;
  }
  return {known:true,tools:Math.max(0,budget.toolBudget-tools),tokens:Math.max(0,budget.tokenBudget-tokens)};
}
