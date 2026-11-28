import { attachImageTool } from './chat-image-tool.js';
import { attachStickerTools } from './chat-sticker-tool.js';
import { assembleCleanContext } from './context-assemble-clean.js';
import { resolveChatAttachmentsForModel, applyChatAttachmentsToMessages, attachmentDeskReceipt } from './chat-attachments.js';
import { ChatStoreError, getConversation, readConversationState, sanitizeId } from './chat-store.js';
import { json, methodNotAllowed, readJson, sameOrigin } from './http.js';
import { saveModelEcho } from './model-metadata-api.js';
import { acquireReplyRun,reserveReplyStep,claimReplyStep,reserveReplyMedia,commitReplyStep,settleReplyRun,recoverStaleReplyRuns,canonicalReplyContext,isReplyRunActive,nativePlanRun,nativePlanClaim,reserveNativePlanTool,finishNativePlanTool,refreshReplyClaim } from './chat-reply-run.js';
import { prepareReplyGroupDogtalk } from './dogtalk-store.js';
import {acquireSingleChatRun,heartbeatSingleChatRun,releaseSingleChatRun,recoverSingleChatRuns,hasSingleChatClaim,isSingleChatRunActive} from './chat-single-run.js';

const BODY_BYTES = 2 * 1024 * 1024;
import { normalizeToolCallLimit } from './turn-tool-policy.js';

function assertRequest(request) {
  if (request.method !== 'POST') return methodNotAllowed('POST');
  if (!sameOrigin(request)) throw new ChatStoreError('forbidden', 'Forbidden.', 403);
  return null;
}
function parsedMessages(value) {
  const messages = Array.isArray(value.messages) ? value.messages : [];
  const recent = messages.slice(-100)
    .filter(m => ['user', 'assistant'].includes(m?.role) && typeof m.content === 'string')
    .map(m => ({role:m.role,content:m.content}));
  if (recent.at(-1)?.role !== 'user' || !recent.at(-1).content.trim()) {
    throw new ChatStoreError('invalid_request', '本轮必须以用户消息结尾。', 400);
  }
  return recent;
}
function assertConversationTurn(history, turnId) {
  const target = history.turns?.find(t => t.id === turnId);
  if (!target) throw new ChatStoreError('turn_not_found', '本轮消息不存在，不能递给 ChatGPT 套餐模型。', 409);
  const variant = target.user?.variants?.[target.user.active || 0];
  if (!variant || variant.hidden) throw new ChatStoreError('turn_not_found', '本轮用户消息已被删除。', 409);
}
function chatSettings(value) {
  const settings = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    recentTurns: Math.max(1, Math.min(400, Number(settings.recentTurns) || 8)),
    contextBudget: settings.contextBudget===0||settings.contextBudget==='0'?0:Math.max(1800, Math.min(65536, Number(settings.contextBudget) || 6000)),
    soilBudget: Math.max(300, Math.min(4000, Number(settings.soilBudget) || 1800)),
    worldbookEnabled: settings.worldbookEnabled !== false && settings.worldbookEnabled !== 'false',
    worldbookLimit: Math.max(0, Math.min(6, Number(settings.worldbookLimit ?? 6))),
    memoryLimit: Math.max(0, Math.min(12, Number(settings.memoryLimit ?? 8))),
  };
}
function namedTools(tools) {
  return (Array.isArray(tools) ? tools : []).filter(t => t?.type === 'function'
    && t?.function?.name && t?.function?.parameters);
}
function asNativeTools(tools) {
  return namedTools(tools).map(t => ({
    type: 'function',
    name: t.function.name,
    description: t.function.description || '',
    parameters: t.function.parameters,
  }));
}
function acceptedModel(value) {
  const model = String(value.model || '').trim().slice(0, 128);
  if (!/^[a-z0-9][a-z0-9._-]{1,127}$/i.test(model)) throw new ChatStoreError('invalid_model', 'ChatGPT 套餐模型名称格式无效。', 400);
  return model;
}
// Older clients may prepare ordinary context only while dream execution is
// disabled and no competing single request holds the window. They must
// upgrade before the deployment may enable autonomous execution.
async function assertNativeSingleClaim(env,cid,claimId){
  const db=env.COAST_CHAT_DB;
  if(claimId){
    if(!await hasSingleChatClaim(db,cid,claimId)||!await heartbeatSingleChatRun(db,{conversationId:cid,claimId}))
      throw new ChatStoreError('native_single_claim_lost','套餐普通聊天的执行预约已失效。',409);
    return;
  }
  if(env.COAST_DREAM_TIDE_ENABLED==='true'||env.COAST_DEVICE_DREAM_TIDE_ENABLED==='true'||await isSingleChatRunActive(db,cid))
    throw new ChatStoreError('native_single_claim_required','请更新客户端，或等待本窗口当前任务结束。',409);
}
export async function routeNativeSingleChatRun(request,env){
  const invalid=assertRequest(request);if(invalid)return invalid;
  const value=await readJson(request,16*1024),db=env.COAST_CHAT_DB,cid=sanitizeId(value.conversation_id||'','conversation');
  await getConversation(db,cid);
  if(value.action==='start'){
    await recoverSingleChatRuns(db);
    await recoverStaleReplyRuns(db,Date.now(),cid);
    const claim=await acquireSingleChatRun(db,cid);
    if(!claim)throw new ChatStoreError('window_execution_busy','窗口已有运行任务。',409);
    return json({ok:true,claim_id:claim.claimId});
  }
  const claimId=sanitizeId(value.claim_id||'','claim');
  const claim={conversationId:cid,claimId};
  if(value.action==='heartbeat')return json({ok:await heartbeatSingleChatRun(db,claim)});
  if(value.action==='release')return json({ok:await releaseSingleChatRun(db,claim)});
  throw new ChatStoreError('native_single_action_invalid','无效的普通聊天执行操作。',400);
}
async function contextFromRequest(env, value, { preview = false, group = null } = {}) {
  const conversationId = sanitizeId(value.conversation_id || '', 'conversation');
  const turnId = sanitizeId(value.source_turn_id || '', 'turn');
  const room = await getConversation(env.COAST_CHAT_DB, conversationId);
  if (room.room_type === 'lighthouse') throw new ChatStoreError('lighthouse_generation_disabled', '灯塔不触发聊天模型。', 409);
  const history = await readConversationState(env.COAST_CHAT_DB, conversationId);
  assertConversationTurn(history, turnId);
  if(!group)await assertNativeSingleClaim(env,conversationId,value.native_single_claim);
  if(!group&&await isReplyRunActive(env.COAST_CHAT_DB,conversationId))throw new ChatStoreError('reply_run_active','当前窗口正在连续回复。',409);
  const messages = group?canonicalReplyContext(history,group.identity,chatSettings(value.settings).recentTurns):parsedMessages(value);
  const suppliedText = messages.at(-1).content.trim();
  const userTurn = history.turns.find(t=>t.id===turnId);
  const actualText = userTurn.user.variants[userTurn.user.active || 0].content.trim();
  if (!group && actualText !== suppliedText && !(actualText === '' && suppliedText === '请查看本轮附件。')) {
    throw new ChatStoreError('turn_stale', '聊天记录已更新，请重新发送本轮。', 409);
  }
  const model = acceptedModel(value);
  let groupDogtalk;
  if(group){
    const previous=group.claim.previous[0]?.desk_slip?.dogtalk;
    groupDogtalk=group.claim.index>0?(previous?.delivered&&previous.context?{context:previous.context,selected:true,reason:'same_group'}:null):preview?null:await prepareReplyGroupDogtalk(env.COAST_CHAT_DB,{conversationId,turnId,user:userTurn.user.variants[userTurn.user.active||0]});
  }
  let assembled = await assembleCleanContext(env, {
    conversationId, sourceTurnId:turnId, messages,
    lastUser: messages.at(-1), settings: chatSettings(value.settings),
    localDate: value.local_date, localDateTime: value.local_datetime,
    realityContext: value.reality_context,
    surface:room.room_type==='radio'?'radio':'main_chat', model,
    permission:'owner', crossWindow:value.cross_window,
    preview, exposeOpenRouterSearch:false, ...(group?{groupDogtalk,exposeTools:group.claim.toolBudget>0}:{}),
  });
  // The direct Responses route already uses the native input_image contract
  // for owner attachments. No OpenRouter chat request is made on this path.
  assembled=await attachImageTool(env,assembled,{
    conversationId,turnId,messageId:String(value.message_id||''),roomType:room.room_type,
    chatModel:model,enabled:value.image_tool_enabled===true&&typeof value.image_model_id==='string'&&!!value.image_model_id,
    expectedImageModel:value.image_model_id??null,visionOverride:true,sequenceId:group?.identity.sequenceId??null
  });
  if(!group||group.claim.toolBudget>0)assembled=await attachStickerTools(env,assembled,{conversationId,turnId,messageId:String(value.message_id||''),roomType:room.room_type,sequenceId:group?.identity.sequenceId??null});
  return { assembled, conversationId, turnId, model };
}

/** Reuse Coast's complete context builder, without putting the OAuth credential on Cloudflare. */
export async function prepareNativeChatGpt(request, env) {
  const invalid = assertRequest(request);
  if (invalid) return invalid;
  const value = await readJson(request, BODY_BYTES);
  const { assembled, conversationId, turnId, model } = await contextFromRequest(env, value);
  const ids = Array.isArray(value.attachment_ids) ? value.attachment_ids.slice(0,12) : [];
  const resolved = ids.length ? await resolveChatAttachmentsForModel(env, env.COAST_CHAT_DB, {
    conversationId, turnId, attachmentIds:ids, modelId:model,
    visionSupportedOverride:true,
  }) : null;
  const preparedMessages = resolved
    ? applyChatAttachmentsToMessages(assembled.modelMessages, resolved)
    : assembled.modelMessages;
  const tools = asNativeTools(assembled.tools);
  return json({
    ok:true,
    model_messages:preparedMessages,
    tools,
    desk_slip: { ...assembled.deskSlip(), ...(resolved ? {attachments:attachmentDeskReceipt(resolved)} : {}) },
    // This is not a hidden clamp: unsupported OpenRouter-hosted tools are excluded.
    limitations:{ hosted_openrouter_search:false, max_tools_per_turn:normalizeToolCallLimit(value.settings?.toolCallLimit) },
    selected_memory_ids:assembled.selected_memory_ids,
  });
}

/** Owner-authenticated, per-call tool execution with server-side permission revalidation. */
export async function executeNativeChatGptTool(request, env) {
  const invalid=assertRequest(request);
  if(invalid)return invalid;
  // Tool requests replay the same authenticated context envelope as preparation.
  // A smaller body cap breaks every tool in longer conversations before execution.
  const value=await readJson(request, BODY_BYTES);
  const group=value.reply_sequence_id?await nativeGroupClaim(env,value):null;
  const {assembled}=await contextFromRequest(env, value, {preview:true,group});
  const call=value.tool_call;
  const name=String(call?.function?.name||'').trim();
  if(!name||String(call?.function?.arguments||'').length>32000) {
    throw new ChatStoreError('invalid_tool_call','工具调用名称或参数无效。',400);
  }
  if(!namedTools(assembled.tools).some(t=>t.function.name===name)) {
    throw new ChatStoreError('tool_unavailable','模型请求的工具不在本轮允许清单中。',403);
  }
  if(group&&!await reserveNativePlanTool(env.COAST_CHAT_DB,group.identity,group.model,value.message_id,String(call?.id||''),name,value.tool_index))throw new ChatStoreError('native_plan_tool_claim_lost','工具额度不足、重复调用或预约已变化；没有再次执行。',409);
  try {
    const result=await assembled.executeTool({
      id:String(call?.id||'').slice(0,128),
      type:'function',
      function:{name,arguments:call.function.arguments},
    });
    const privateContinuation=assembled.takePrivateContinuation?.()||[];
    return json({
      ok:result?.ok!==false, output:JSON.stringify(result??null).slice(0,30000),
      ...(privateContinuation.length?{private_continuation:privateContinuation}:{}),
      furniture_runs:assembled.furnitureRuns(), desk_slip:assembled.deskSlip(),
    });
  } catch (error) {
    return json({
      ok:false,
      output:JSON.stringify({ok:false,error:{
        type:String(error?.type||'tool_execution_failed').slice(0,120),
        message:String(error?.message||'工具执行失败。').slice(0,300),
      }}),
      furniture_runs:assembled.furnitureRuns(),desk_slip:assembled.deskSlip(),
    });
  } finally {
    if(group&&!await finishNativePlanTool(env.COAST_CHAT_DB,group.identity,group.model,value.message_id,String(call?.id||'')))throw new ChatStoreError('native_plan_tool_unconfirmed','工具完成回执未确认；不会自动重试。',409);
  }
}

export async function saveNativeChatGptEcho(request, env) {
  const invalid=assertRequest(request);
  if(invalid)return invalid;
  const value=await readJson(request,128*1024);
  const conversationId=sanitizeId(value.conversation_id || '', 'conversation');
  const messageId=sanitizeId(value.message_id || '', 'assistant_variant');
  await getConversation(env.COAST_CHAT_DB,conversationId);
  const snapshot=value.snapshot;
  const metadata=snapshot?.metadata;
  if(!metadata||metadata.provider!=='chatgpt_plan'||snapshot.sanitized!==true) {
    throw new ChatStoreError('invalid_metadata','ChatGPT 模型回波格式无效。',400);
  }
  const safeSnapshot={
    status:'saved',sanitized:true,
    metadata:{
      requested_model:String(metadata.requested_model||'').slice(0,128),
      resolved_model:String(metadata.resolved_model||'').slice(0,128),
      provider:'chatgpt_plan',provider_route:'direct_responses',
      usage:metadata.usage??null,
      finish_reason:String(metadata.finish_reason||'').slice(0,80),
      is_stream:true,request:{
        store:false,stream:true,max_tokens:null,
        unsupported_settings:['max_output_tokens','temperature'],
      },
      reasoning_status:'not_returned',
      error_summary:null,
    },
    raw_metadata_sanitized:null,
  };
  return json(await saveModelEcho(env,conversationId,messageId,safeSnapshot));
}


function planIdentity(value){
  return {conversationId:value.conversation_id,turnId:value.source_turn_id,userVariantId:value.user_variant_id,sequenceId:value.sequence_id??value.reply_sequence_id};
}
function fullPlanModel(value){
  const raw=String(value.model||'');
  const slug=acceptedModel({model:raw.replace(/^chatgpt-plan:/,'')});
  return 'chatgpt-plan:'+slug;
}
async function nativeGroupClaim(env,value){
  const identity=planIdentity(value),model=fullPlanModel(value);
  const claim=await nativePlanClaim(env.COAST_CHAT_DB,identity,model,value.message_id);
  return {identity,model,claim};
}

/** Device executes Responses; server owns reservations, actual original media,
 * and canonical history. Usage/text are device-reported, not server-attested. */
export async function routeNativeReplySequence(request,env){
  const invalid=assertRequest(request);if(invalid)return invalid;
  const value=await readJson(request,BODY_BYTES),db=env.COAST_CHAT_DB;
  const identity=planIdentity(value),model=fullPlanModel(value),slug=model.slice('chatgpt-plan:'.length);
  const action=value.action;
  if(action==='start'){
    if(env.COAST_REPLY_SEQUENCE_EXPERIMENTAL==='false')throw new ChatStoreError('reply_sequence_unavailable','服务端已暂停连续回复。',409);
    await recoverStaleReplyRuns(db,Date.now(),identity.conversationId);
    if(!await acquireReplyRun(db,identity,value.budget||{},{nativePlanModel:model}))throw new ChatStoreError('reply_run_not_acquired','当前窗口未授权、预算不足或已有运行任务。',409);
    const row=await nativePlanRun(db,identity,model);
    return json({ok:true,max_messages:row.max_messages});
  }
  const row=await nativePlanRun(db,identity,model);
  if(action==='settle'){
    const status=String(value.status||'');
    if(!await settleReplyRun(db,identity,status))throw new ChatStoreError('reply_settle_unconfirmed','任务结束未确认；请刷新，不会重试。',409);
    return json({ok:true,history:await readConversationState(db,identity.conversationId)});
  }
  if(action==='heartbeat'){
    await nativePlanClaim(db,identity,model,value.message_id);
    return json({ok:await refreshReplyClaim(db,identity,value.message_id)});
  }
  if(action==='next'){
    const mid=value.message_id,index=value.index;
    if(!await reserveReplyStep(db,identity,mid,index)||!await claimReplyStep(db,identity,mid))throw new ChatStoreError('native_plan_claim_lost','下一条预约未确认；未发起模型调用。',409);
    let claim=await nativePlanClaim(db,identity,model,mid);
    const turn=claim.state.turns.find(t=>t.id===identity.turnId),active=turn.user.variants[turn.user.active];
    const cfg=claim.state.context_settings;
    const image=claim.toolBudget>0&&value.image_tool_enabled===true;
    const sticker=claim.toolBudget>0&&(cfg.sticker_send_enabled||cfg.sticker_add_enabled);
    if(image||sticker){
      if(!await reserveReplyMedia(db,identity,mid,model,{image,sticker}))throw new ChatStoreError('reply_media_reservation_lost','媒体预约未确认。',409);
      claim=await nativePlanClaim(db,identity,model,mid);
    }
    const group={identity,model,claim};
    const envelope={...value,model:slug,message_id:mid,image_tool_enabled:image};
    const {assembled}=await contextFromRequest(env,envelope,{preview:index>0,group});
    const attachmentIds=(active.attachments||[]).map(a=>a.id);
    const resolved=attachmentIds.length?await resolveChatAttachmentsForModel(env,db,{conversationId:identity.conversationId,turnId:identity.turnId,attachmentIds,modelId:slug,visionSupportedOverride:true}):null;
    const modelMessages=[...(resolved?applyChatAttachmentsToMessages(assembled.modelMessages,resolved):assembled.modelMessages)];
    const previous=[];
    for(const v of claim.previous){
      if(v.content.trim())modelMessages.push({role:'assistant',content:v.content});
      const ids=(v.attachments||[]).filter(a=>a.image_generation?.message_id===v.id||a.sticker_delivery?.message_id===v.id).map(a=>a.id);
      let mediaReceipt=null;
      if(ids.length){
        const media=await resolveChatAttachmentsForModel(env,db,{conversationId:identity.conversationId,attachmentIds:ids,modelId:slug,visionSupportedOverride:true});
        mediaReceipt=attachmentDeskReceipt(media);
        const note='【本组前序媒体 · 系统转交，非人类新发言】原助手消息 '+v.id+'；已保存图像 '+ids.join('、')+'。'+(media.image_parts.length?'附实际像素。':'本次未递入像素，不要声称看见。');
        modelMessages.push(media.image_parts.length?{role:'user',content:[{type:'text',text:note},...media.image_parts]}:{role:'system',content:note});
      }
      previous.push({message_id:v.id,content:v.content,...(mediaReceipt?{media_receipt:mediaReceipt}:{})});
    }
    const desk={...assembled.deskSlip(),...(resolved?{attachments:attachmentDeskReceipt(resolved)}:{}),reply_sequence_previous:previous};
    const tools=claim.toolBudget>0?asNativeTools(assembled.tools):[];
    return json({ok:true,max_messages:row.max_messages,tool_budget:claim.toolBudget,token_budget:claim.tokenBudget,
      may_continue:index+1<row.max_messages,context:{ok:true,model_messages:modelMessages,tools,desk_slip:desk,
        limitations:{max_tools_per_turn:normalizeToolCallLimit(value.settings?.toolCallLimit)}}});
  }
  if(action==='commit'){
    const claim=await nativePlanClaim(db,identity,model,value.message_id),variant=value.variant||{};
    const receipt=value.receipt||{};
    if(claim.calls.some(c=>!c.done)||receipt.tool_calls!==claim.calls.length||variant.id!==value.message_id||variant.model_id!==model||
        typeof variant.content!=='string'||variant.finish_reason!=='stop')throw new ChatStoreError('native_plan_commit_invalid','设备回复或工具回执不匹配。',409);
    const safe={id:variant.id,content:variant.content,model_id:model,finish_reason:'stop',generation_source:'chat',
      ...(variant.usage?{usage:variant.usage}:{}),...(variant.model_echo?{model_echo:variant.model_echo}:{}),
      furniture_runs:variant.furniture_runs||[],desk_slip:variant.desk_slip||{}};
    const committed=await commitReplyStep(db,identity,value.message_id,safe,receipt);
    if(!committed)throw new ChatStoreError('reply_commit_unconfirmed','回复未确认写入；不会重放。',409);
    return json({ok:true,continue_requested:committed.receipt.continue_requested,history:await readConversationState(db,identity.conversationId)});
  }
  throw new ChatStoreError('native_plan_action_invalid','无效的套餐连续回复操作。',400);
}
