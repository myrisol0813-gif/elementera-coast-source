import {ensureChatSchema,normalizeState,readConversationState,ChatStoreError} from './chat-store.js';

// Internal durable ledger. No public route or provider call in this module.
// An uncertain claimed request is never replayed, even after recovery.
const ID=/^[A-Za-z0-9_.:-]{1,160}$/;
const STALE_MS=30*60*1000;
const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);
const changes=r=>r?.meta?.changes===1;
const fail=(type,message)=>{throw new ChatStoreError(type,message,409)};
function ids(...values){if(!values.every(v=>typeof v==='string'&&ID.test(v)))fail('reply_run_invalid','连续回复身份无效。');}
function branch(state,turnId,userId){
  const turn=state.turns.find(t=>t.id===turnId);
  if(!turn||turn.turn_type==='landing'||turn.user.variants[turn.user.active]?.id!==userId||turn.user.variants[turn.user.active]?.hidden)
    fail('reply_run_branch_changed','原用户消息或窗口分支已改变。');
  const key=String(turn.user.active);
  return {turn,key,list:turn.assistant.variantsByUserVariant[key]||[]};
}
async function source(db,cid){
  const row=await stmt(db,`SELECT s.state_json,c.room_type,c.source,c.conversation_kind
    FROM conversation_states s JOIN conversations c ON c.id=s.conversation_id
    WHERE c.id=? AND c.user_id='owner' AND c.deleted_at IS NULL`,cid).first();
  if(!row||!['main','radio'].includes(row.room_type)||row.source!=='coast'||row.conversation_kind!=='chat')
    fail('reply_run_window_unavailable','此窗口不支持连续回复。');
  return {raw:row.state_json,state:normalizeState(JSON.parse(row.state_json))};
}
async function rowFor(db,identity){
  ids(identity.conversationId,identity.turnId,identity.userVariantId,identity.sequenceId);
  const row=await stmt(db,`SELECT * FROM chat_reply_runs WHERE sequence_id=? AND conversation_id=? AND turn_id=? AND user_variant_id=?`,
    identity.sequenceId,identity.conversationId,identity.turnId,identity.userVariantId).first();
  return row||null;
}
const receipts=row=>JSON.parse(row.receipts_json);
function remaining(row){
  let tools=row.tool_budget,tokens=row.token_budget;
  for(const receipt of receipts(row)){
    if(!Number.isSafeInteger(receipt.tool_calls)||receipt.tool_calls<0||!Number.isSafeInteger(receipt.total_tokens)||receipt.total_tokens<0)return null;
    tools=Math.max(0,tools-receipt.tool_calls);tokens=Math.max(0,tokens-receipt.total_tokens);
  }
  return {tools,tokens};
}
export async function acquireReplyRun(db,identity,budget){
  await ensureChatSchema(db);
  ids(identity.conversationId,identity.turnId,identity.userVariantId,identity.sequenceId);
  const {raw,state}=await source(db,identity.conversationId);
  if(!state.context_settings.reply_sequence_enabled)return false;
  const {list}=branch(state,identity.turnId,identity.userVariantId);
  const int=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
  if(!int(budget.maxMessages,1,20)||!int(budget.toolBudget,0,128)||!int(budget.tokenBudget,1,1000000))
    fail('reply_run_invalid_budget','连续回复预算无效。');
  const cfg=state.context_settings;
  const max=Math.min(cfg.reply_sequence_max_messages??budget.maxMessages,20-list.length);
  const tools=cfg.reply_sequence_tool_budget??budget.toolBudget,tokens=cfg.reply_sequence_token_budget??budget.tokenBudget;
  if(max<1||list.some(v=>v.reply_sequence?.id===identity.sequenceId||['image_pending','image_tool_ready','sticker_tool_ready','image_saved','sticker_saved'].includes(v.finish_reason)))return false;
  return changes(await stmt(db,`INSERT OR IGNORE INTO chat_reply_runs(sequence_id,conversation_id,turn_id,user_variant_id,status,max_messages,tool_budget,token_budget,updated_at)
    SELECT ?,?,?,?,'running',?,?,?,? WHERE EXISTS(SELECT 1 FROM conversation_states s JOIN conversations c ON c.id=s.conversation_id WHERE s.conversation_id=? AND s.state_json=? AND c.deleted_at IS NULL)`,
    identity.sequenceId,identity.conversationId,identity.turnId,identity.userVariantId,max,tools,tokens,Date.now(),identity.conversationId,raw).run());
}
export async function reserveReplyStep(db,identity,messageId,index){
  ids(messageId);
  const row=await rowFor(db,identity);
  if(!row||row.status!=='running'||row.pending_id||index!==receipts(row).length||index>=row.max_messages)return false;
  const prior=receipts(row);
  if(index>0&&prior.at(-1)?.continue_requested!==true)return false;
  const budget=remaining(row);if(!budget||budget.tokens<=0)return false;
  const {raw,state}=await source(db,identity.conversationId);
  if(!state.context_settings.reply_sequence_enabled)return false;
  const {list}=branch(state,identity.turnId,identity.userVariantId);
  if(list.length>=20||prior.some(r=>r.message_id===messageId)||state.turns.some(t=>Object.values(t.assistant.variantsByUserVariant).flat().some(v=>v.id===messageId)))return false;
  const group=list.filter(v=>v.reply_sequence?.id===identity.sequenceId);
  if(group.length!==index||group.some((v,i)=>v.id!==prior[i]?.message_id||v.reply_sequence.index!==i))return false;
  return changes(await stmt(db,`UPDATE chat_reply_runs SET pending_id=?,pending_state='reserved',updated_at=? WHERE sequence_id=? AND status='running' AND pending_id IS NULL AND receipts_json=? AND EXISTS(SELECT 1 FROM conversation_states WHERE conversation_id=? AND state_json=?)`,
    messageId,Date.now(),identity.sequenceId,row.receipts_json,identity.conversationId,raw).run());
}
export async function claimReplyStep(db,identity,messageId){
  ids(messageId);
  const row=await rowFor(db,identity);
  if(!row||row.status!=='running'||row.pending_id!==messageId||row.pending_state!=='reserved')return null;
  const budget=remaining(row);if(!budget||budget.tokens<=0)return null;
  const {raw,state}=await source(db,identity.conversationId);
  if(!state.context_settings.reply_sequence_enabled)return null;
  const {list}=branch(state,identity.turnId,identity.userVariantId);
  const index=receipts(row).length;
  if(list.length>=20)return null;
  const changed=await stmt(db,`UPDATE chat_reply_runs SET pending_state='claimed',updated_at=? WHERE sequence_id=? AND status='running' AND pending_id=? AND pending_state='reserved' AND EXISTS(SELECT 1 FROM conversation_states WHERE conversation_id=? AND state_json=?)`,
    Date.now(),identity.sequenceId,messageId,identity.conversationId,raw).run();
  if(!changes(changed))return null;
  return {index,mayContinue:index+1<row.max_messages&&list.length+1<20,toolBudget:budget.tools,tokenBudget:budget.tokens,
    previous:list.filter(v=>v.reply_sequence?.id===identity.sequenceId).map(v=>({id:v.id,content:v.content,...(v.attachments?.length?{attachments:v.attachments}: {})}))};
}
// Materialize a media reservation only for the currently claimed step.
// It is not a committed group member until commitReplyStep promotes it.
// Existing media transactions may attach verified originals to this exact ID.
export async function reserveReplyMedia(db,identity,messageId,modelId,{image=false,sticker=false}={}){
  ids(messageId);
  if(!image&&!sticker)return false;
  const row=await rowFor(db,identity);
  if(!row||row.status!=='running'||row.pending_id!==messageId||row.pending_state!=='claimed')return false;
  const {raw,state}=await source(db,identity.conversationId);
  const {turn,key,list}=branch(state,identity.turnId,identity.userVariantId);
  if(!state.context_settings.reply_sequence_enabled||list.length>=20||state.turns.some(t=>[...t.user.variants,...Object.values(t.assistant.variantsByUserVariant).flat()].some(v=>v.id===messageId)))return false;
  if(sticker&&!image&&!state.context_settings.sticker_send_enabled&&!state.context_settings.sticker_add_enabled)return false;
  const stamp=Date.now();
  const slot={id:messageId,content:'',created_at:new Date(stamp).toISOString(),model_id:modelId,generation_source:'chat',finish_reason:image?'image_tool_ready':'sticker_tool_ready'};
  turn.assistant.variantsByUserVariant[key]=[...list,slot];
  state.updated_at=new Date(stamp).toISOString();
  return changes(await stmt(db,`UPDATE conversation_states SET state_json=?,updated_at=? WHERE conversation_id=? AND state_json=? AND EXISTS(SELECT 1 FROM chat_reply_runs WHERE sequence_id=? AND status='running' AND pending_id=? AND pending_state='claimed' AND receipts_json=?) AND EXISTS(SELECT 1 FROM conversations WHERE id=? AND deleted_at IS NULL)`,
    JSON.stringify(normalizeState(state)),stamp,identity.conversationId,raw,identity.sequenceId,messageId,row.receipts_json,identity.conversationId).run());
}
export async function commitReplyStep(db,identity,messageId,variant,receipt){
  ids(messageId);
  const row=await rowFor(db,identity);
  if(!row||row.status!=='running'||row.pending_id!==messageId||row.pending_state!=='claimed')return null;
  const {raw,state}=await source(db,identity.conversationId);
  const {turn,key,list}=branch(state,identity.turnId,identity.userVariantId);
  const prior=receipts(row),index=prior.length,budget=remaining(row);
  const slotIndex=list.findIndex(v=>v.id===messageId);
  const slot=slotIndex<0?null:list[slotIndex];
  if(slot&&(slotIndex!==list.length-1||slot.reply_sequence||!['image_tool_ready','sticker_tool_ready','image_saved','sticker_saved','image_failed'].includes(slot.finish_reason)))return null;
  const originals=(slot?.attachments||[]).filter(a=>a.image_generation?.message_id===messageId||a.sticker_delivery?.message_id===messageId);
  if((slot?list.length>20:list.length>=20)||!budget||typeof variant?.content!=='string'||(!variant.content.trim()&&!originals.length)||variant.id!==messageId)return null;
  const calls=receipt?.tool_calls,tokens=receipt?.total_tokens;
  const known=Number.isSafeInteger(calls)&&calls>=0&&calls<=budget.tools&&Number.isSafeInteger(tokens)&&tokens>=0;
  const record={message_id:messageId,tool_calls:known?calls:null,total_tokens:known?tokens:null,
    continue_requested:known&&tokens<budget.tokens&&receipt?.continue_requested===true&&variant.finish_reason==='stop'};
  const next={...variant,id:messageId,...(slot?{created_at:slot.created_at,attachments:originals}:{}),reply_sequence:{id:identity.sequenceId,index},archive_retained_desk_slip:true};
  turn.assistant.variantsByUserVariant[key]=slot?[...list.slice(0,slotIndex),next]:[...list,next];
  turn.assistant.activeByUserVariant[key]=slot?slotIndex:list.length;
  const stamp=Date.now();
  state.updated_at=new Date(stamp).toISOString();
  const newRaw=JSON.stringify(normalizeState(state)),newReceipts=JSON.stringify([...prior,record]);
  // Both writes run in one D1 transaction. The ledger advance requires the
  // exact new canonical history, while the history requires the claimed step.
  const result=await db.batch([
    stmt(db,`UPDATE conversation_states SET state_json=?,updated_at=? WHERE conversation_id=? AND state_json=? AND EXISTS(SELECT 1 FROM conversations WHERE id=? AND deleted_at IS NULL) AND EXISTS(SELECT 1 FROM chat_reply_runs WHERE sequence_id=? AND status='running' AND pending_id=? AND pending_state='claimed' AND receipts_json=?)`,
      newRaw,stamp,identity.conversationId,raw,identity.conversationId,identity.sequenceId,messageId,row.receipts_json),
    stmt(db,`UPDATE chat_reply_runs SET pending_id=NULL,pending_state=NULL,receipts_json=?,updated_at=? WHERE sequence_id=? AND status='running' AND pending_id=? AND pending_state='claimed' AND receipts_json=? AND EXISTS(SELECT 1 FROM conversation_states WHERE conversation_id=? AND state_json=?)`,
      newReceipts,stamp,identity.sequenceId,messageId,row.receipts_json,identity.conversationId,newRaw),
    stmt(db,`UPDATE conversations SET updated_at=? WHERE id=? AND deleted_at IS NULL AND EXISTS(SELECT 1 FROM chat_reply_runs WHERE sequence_id=? AND receipts_json=?)`,
      stamp,identity.conversationId,identity.sequenceId,newReceipts),
  ]);
  if(!changes(result[0])||!changes(result[1]))return null;
  return {id:messageId,content:variant.content,receipt:record};
}
export async function settleReplyRun(db,identity,status){
  const row=await rowFor(db,identity);if(!row||row.status!=='running')return false;
  if(!['completed','limit_reached','permission_or_budget','reservation_lost','failed','cancelled','interrupted'].includes(status))fail('reply_run_invalid_status','任务状态无效。');
  if(row.pending_id&&['completed','limit_reached'].includes(status))return false;
  // A failed media step must not discard originals or leave a ready slot
  // callable after settlement. Preserve an interrupted picture on its own
  // exact message ID; no continuation or organizer receipt is fabricated.
  if(row.pending_id){
    const {raw,state}=await source(db,identity.conversationId);
    const {turn,key,list}=branch(state,identity.turnId,identity.userVariantId);
    const i=list.findIndex(v=>v.id===row.pending_id);
    const slot=list[i];
    if(slot&&!slot.reply_sequence&&['image_tool_ready','sticker_tool_ready','image_pending','image_saved','sticker_saved','image_failed'].includes(slot.finish_reason)){
      const originals=(slot.attachments||[]).filter(a=>a.image_generation?.message_id===slot.id||a.sticker_delivery?.message_id===slot.id);
      if(originals.length||['image_pending','image_failed'].includes(slot.finish_reason)){
        slot.finish_reason=originals.length?(originals.some(a=>a.image_generation)?'image_saved_interrupted':'sticker_saved_interrupted'):'image_failed';
        slot.errorDetail=originals.length?'图片原件已保存，连续回复文字未确认完成。':'绘图未确认完成；不会自动重试，供应商可能已计费。';
        // Keep the original as a member of the interrupted group, but
        // deliberately leave the unconfirmed step out of the usage ledger.
        slot.reply_sequence={id:identity.sequenceId,index:receipts(row).length};
        turn.assistant.activeByUserVariant[key]=i;
      }else{
        list.splice(i,1);
        turn.assistant.activeByUserVariant[key]=Math.min(turn.assistant.activeByUserVariant[key]||0,Math.max(0,list.length-1));
      }
      const stamp=Date.now();state.updated_at=new Date(stamp).toISOString();
      const encoded=JSON.stringify(normalizeState(state));
      const result=await db.batch([
        stmt(db,`UPDATE conversation_states SET state_json=?,updated_at=? WHERE conversation_id=? AND state_json=? AND EXISTS(SELECT 1 FROM chat_reply_runs WHERE sequence_id=? AND status='running' AND pending_id=? AND pending_state IS ? AND receipts_json=?)`,encoded,stamp,identity.conversationId,raw,identity.sequenceId,row.pending_id,row.pending_state,row.receipts_json),
        stmt(db,`UPDATE chat_reply_runs SET status=?,updated_at=? WHERE sequence_id=? AND status='running' AND pending_id=? AND pending_state IS ? AND receipts_json=? AND EXISTS(SELECT 1 FROM conversation_states WHERE conversation_id=? AND state_json=?)`,status,stamp,identity.sequenceId,row.pending_id,row.pending_state,row.receipts_json,identity.conversationId,encoded)
      ]);
      return changes(result[0])&&changes(result[1]);
    }
  }
  return changes(await stmt(db,`UPDATE chat_reply_runs SET status=?,updated_at=? WHERE sequence_id=? AND status='running' AND receipts_json=? AND pending_id IS ? AND pending_state IS ?`,
    status,Date.now(),identity.sequenceId,row.receipts_json,row.pending_id,row.pending_state).run());
}
export async function recoverStaleReplyRuns(db,now=Date.now()){
  await ensureChatSchema(db);
  // Never call a provider or clear pending identity. A claimed call may have
  // been billed. Explicit user regeneration must use a fresh sequence ID.
  return (await stmt(db,`UPDATE chat_reply_runs SET status='interrupted',updated_at=? WHERE status='running' AND updated_at<?`,now,now-STALE_MS).run()).meta?.changes||0;
}

// Old clients cannot silently discard or split a committed group. Explicit
// revision-matched deletion may remove a whole group, not individual members.
export function protectReplyGroupHistory(old,next,{allowDelete=false}={}){
  for(const turn of old.turns){
    const incoming=next.turns.find(t=>t.id===turn.id);
    for(const [key,list] of Object.entries(turn.assistant.variantsByUserVariant)){
      const uid=turn.user.variants[Number(key)]?.id;
      const nextKey=incoming?.user.variants.findIndex(v=>v.id===uid)??-1;
      const variants=nextKey<0?[]:incoming.assistant.variantsByUserVariant[String(nextKey)]||[];
      const groups=new Map();
      for(const v of list)if(v.reply_sequence){const id=v.reply_sequence.id;groups.set(id,[...(groups.get(id)||[]),v]);}
      for(const group of groups.values()){
        const matches=group.map(v=>variants.find(x=>x.id===v.id));
        if(matches.every(v=>!v)&&allowDelete)continue;
        if(matches.some((v,i)=>!v||v.reply_sequence?.id!==group[i].reply_sequence.id||v.reply_sequence.index!==group[i].reply_sequence.index||v.content!==group[i].content||v.finish_reason!==group[i].finish_reason))return 'reply_group_history_changed';
      }
    }
  }
  return null;
}

// Canonical context before the target. The active old alternative of the
// target turn is deliberately excluded; regeneration is a new group.
export function canonicalReplyContext(state,identity,recentTurns=8){
  branch(state,identity.turnId,identity.userVariantId);
  const rounds=[];
  for(const turn of state.turns){
    const key=String(turn.user.active),user=turn.user.variants[turn.user.active];
    const messages=[];
    if(user&&!user.hidden&&(user.content.trim()||user.attachments?.length)){
      const body=user.content||'请查看本轮附件。';
      messages.push({role:'user',content:user.message_source==='official_mcp'?'[来源：官端 ChatGPT / official_mcp]\n'+body:body});
    }
    if(turn.id!==identity.turnId){
      const list=turn.assistant.variantsByUserVariant[key]||[],active=list[turn.assistant.activeByUserVariant[key]];
      const group=active?.reply_sequence?list.filter(v=>v.reply_sequence?.id===active.reply_sequence.id).sort((a,b)=>a.reply_sequence.index-b.reply_sequence.index):active?[active]:[];
      if(group.some((v,i)=>v.reply_sequence&&v.reply_sequence.index!==i))fail('reply_group_history_changed','连续回复组不完整。');
      for(const v of group)if(v.content.trim())messages.push({role:'assistant',content:v.content});
    }
    rounds.push(messages);
    if(turn.id===identity.turnId)break;
  }
  const count=Number.isSafeInteger(recentTurns)&&recentTurns>0?recentTurns:8;
  const messages=rounds.slice(-count).flat();
  while(messages[0]?.role==='assistant')messages.shift();
  if(messages.at(-1)?.role!=='user')fail('reply_run_branch_changed','原用户消息不可读取。');
  return messages;
}
export async function isReplyRunActive(db,cid){
  await ensureChatSchema(db);
  return Boolean(await stmt(db,"SELECT sequence_id FROM chat_reply_runs WHERE conversation_id=? AND status='running'",cid).first());
}

/** A real run owns its entire lifecycle. Each invocation is separate and
 * receives the canonical prior messages from its claimed reservation.
 * No caller-provided assistant content, usage or continuation receipt.
 * Event delivery is not the commit boundary; disconnect never replays. */
export async function executeDurableReplyRun(db,identity,budget,{invoke,emit=()=>{},signal,newMessageId=()=>crypto.randomUUID()}={}){
  if(signal?.aborted)return {status:'cancelled',saved:0};
  if(!await acquireReplyRun(db,identity,budget))fail('reply_run_not_acquired','窗口未启用、额度不足或另一个回复组正在运行。');
  let saved=0,status='completed',failure=null;
  try{
    const row=await rowFor(db,identity);
    emit('reply_group_start',{sequence_id:identity.sequenceId,max_messages:row.max_messages});
    for(let index=0;index<row.max_messages;index++){
      if(signal?.aborted){status='cancelled';break;}
      const messageId=newMessageId();
      if(!await reserveReplyStep(db,identity,messageId,index)){status='permission_or_budget';break;}
      if(signal?.aborted){status='cancelled';break;}
      const claim=await claimReplyStep(db,identity,messageId);
      if(!claim){status='reservation_lost';break;}
      if(signal?.aborted){status='cancelled';break;}
      emit('reply_begin',{message_id:messageId,index});
      const state=await readConversationState(db,identity.conversationId);
      const result=await invoke({identity,messageId,...claim,state,signal},chunk=>emit('reply_delta',{message_id:messageId,content:chunk}));
      const committed=await commitReplyStep(db,identity,messageId,result.variant,result.receipt);
      if(!committed)fail('reply_commit_unconfirmed','回复未确认写入；不会重放。');
      saved++;
      emit('reply_committed',{message_id:messageId,index,history:await readConversationState(db,identity.conversationId)});
      if(signal?.aborted){status='cancelled';break;}
      if(!committed.receipt.continue_requested)break;
      if(!claim.mayContinue){status='limit_reached';break;}
    }
  }catch(error){status=signal?.aborted?'cancelled':'failed';failure=error;}
  if(!await settleReplyRun(db,identity,status))fail('reply_settle_unconfirmed','整组状态未确认，请刷新窗口；不会重试。');
  return {status,saved,...(failure?{error_type:String(failure.type||'reply_failed'),message:String(failure.message||'连续回复中断。').slice(0,1200)}:{})};
}


// One automatic organizer claim per settled group. A lost receipt is not
// retried automatically, just as a lost provider response is not replayed.
export async function claimReplyRunSoil(db,conversationId,sequenceId,tailId){
  await ensureChatSchema(db);ids(conversationId,sequenceId,tailId);
  const row=await stmt(db,'SELECT * FROM chat_reply_runs WHERE conversation_id=? AND sequence_id=?',conversationId,sequenceId).first();
  if(!row||row.status==='running'||row.soil_state||receipts(row).at(-1)?.message_id!==tailId)return false;
  const {raw,state}=await source(db,conversationId);
  const {turn,key,list}=branch(state,row.turn_id,row.user_variant_id);
  const group=list.filter(v=>v.reply_sequence?.id===sequenceId);
  const records=receipts(row);
  if(group.length!==records.length||group.some((v,i)=>v.id!==records[i].message_id||v.reply_sequence.index!==i)
    ||list[turn.assistant.activeByUserVariant[key]]?.id!==tailId)return false;
  return changes(await stmt(db,`UPDATE chat_reply_runs SET soil_state='claimed',soil_updated_at=? WHERE sequence_id=? AND status!='running' AND soil_state IS NULL AND receipts_json=? AND EXISTS(SELECT 1 FROM conversation_states WHERE conversation_id=? AND state_json=?) AND NOT EXISTS(SELECT 1 FROM chat_reply_runs WHERE conversation_id=? AND status='running')`,
    Date.now(),sequenceId,row.receipts_json,conversationId,raw,conversationId).run());
}
export async function finishReplyRunSoil(db,conversationId,sequenceId,status){
  if(!['done','skipped','failed'].includes(status))fail('reply_soil_status_invalid','整理状态无效。');
  return changes(await stmt(db,"UPDATE chat_reply_runs SET soil_state=?,soil_updated_at=? WHERE conversation_id=? AND sequence_id=? AND soil_state='claimed'",status,Date.now(),conversationId,sequenceId).run());
}
