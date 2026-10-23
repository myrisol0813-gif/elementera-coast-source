import { assembleCleanContext } from './context-assemble-clean.js';
import { resolveChatAttachmentsForModel, applyChatAttachmentsToMessages, attachmentDeskReceipt } from './chat-attachments.js';
import { ChatStoreError, getConversation, readConversationState, sanitizeId } from './chat-store.js';
import { json, methodNotAllowed, readJson, sameOrigin } from './http.js';
import { saveModelEcho } from './model-metadata-api.js';

const BODY_BYTES = 2 * 1024 * 1024;
const MAX_TOOLS_PER_TURN = 12;

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
    contextBudget: Math.max(1800, Math.min(65536, Number(settings.contextBudget) || 6000)),
    soilBudget: Math.max(300, Math.min(4000, Number(settings.soilBudget) || 1800)),
    worldbookEnabled: settings.worldbookEnabled !== false,
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
async function contextFromRequest(env, value, { preview = false } = {}) {
  const conversationId = sanitizeId(value.conversation_id || '', 'conversation');
  const turnId = sanitizeId(value.source_turn_id || '', 'turn');
  const room = await getConversation(env.COAST_CHAT_DB, conversationId);
  if (room.room_type === 'lighthouse') throw new ChatStoreError('lighthouse_generation_disabled', '灯塔不触发聊天模型。', 409);
  const history = await readConversationState(env.COAST_CHAT_DB, conversationId);
  assertConversationTurn(history, turnId);
  const messages = parsedMessages(value);
  const suppliedText = messages.at(-1).content.trim();
  const userTurn = history.turns.find(t=>t.id===turnId);
  const actualText = userTurn.user.variants[userTurn.user.active || 0].content.trim();
  if (actualText !== suppliedText && !(actualText === '' && suppliedText === '请查看本轮附件。')) {
    throw new ChatStoreError('turn_stale', '聊天记录已更新，请重新发送本轮。', 409);
  }
  const model = acceptedModel(value);
  const assembled = await assembleCleanContext(env, {
    conversationId, sourceTurnId:turnId, messages,
    lastUser: messages.at(-1), settings: chatSettings(value.settings),
    localDate: value.local_date, localDateTime: value.local_datetime,
    surface:room.room_type==='radio'?'radio':'main_chat', model,
    permission:'owner', crossWindow:value.cross_window,
    preview, exposeOpenRouterSearch:false,
  });
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
    limitations:{ hosted_openrouter_search:false, max_tools_per_turn:MAX_TOOLS_PER_TURN },
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
  const {assembled}=await contextFromRequest(env, value, {preview:true});
  const call=value.tool_call;
  const name=String(call?.function?.name||'').trim();
  if(!name||String(call?.function?.arguments||'').length>32000) {
    throw new ChatStoreError('invalid_tool_call','工具调用名称或参数无效。',400);
  }
  if(!namedTools(assembled.tools).some(t=>t.function.name===name)) {
    throw new ChatStoreError('tool_unavailable','模型请求的工具不在本轮允许清单中。',403);
  }
  try {
    const result=await assembled.executeTool({
      id:String(call?.id||'').slice(0,128),
      type:'function',
      function:{name,arguments:call.function.arguments},
    });
    return json({
      ok:true, output:JSON.stringify(result??null).slice(0,30000),
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
