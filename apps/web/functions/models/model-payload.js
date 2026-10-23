import {
  DEFAULT_FORMAL_TOKENS,
  DEFAULT_MODEL,
  MAX_FORMAL_TOKENS,
} from './model-constants.js';
import { fetchModelCatalog, openRouterKey } from './model-catalog.js';
import {
  ModelRequestError,
  catalogModel,
  clamp,
  normalizeTools,
  supportsReasoningControl,
  supportsResponseFormat,
  supportsTemperature,
  supportsTools,
  validateMessages,
} from './model-validation.js';

export function chatPayload(modelId, messages, maxTokens, temperature, model, options = {}) {
  const payload = { model: modelId, messages };
  // Only the server-generated SHA-256 session key is accepted. This keeps
  // OpenRouter provider routing sticky without exposing a raw conversation ID.
  if (/^[0-9a-f]{64}$/.test(String(options.sessionId || ''))) {
    payload.session_id = options.sessionId;
  }
  if (maxTokens !== null) {
    payload.max_completion_tokens = maxTokens;
    if (!modelId.startsWith('openai/')) payload.max_tokens = maxTokens;
  }
  if (supportsTemperature(modelId, model)) payload.temperature = temperature;
  if (options.responseFormat && supportsResponseFormat(model)) payload.response_format = options.responseFormat;
  if (options.reasoning && supportsReasoningControl(modelId, model)) payload.reasoning = options.reasoning;
  const tools = supportsTools(modelId, model) ? normalizeTools(options.tools) : [];
  if (tools.length) {
    payload.tools = tools;
    payload.tool_choice = options.toolChoice || 'auto';
  }
  return payload;
}

export async function prepareFormalChat(env, input, allowSystem) {
  if (!openRouterKey(env)) throw new ModelRequestError('auth_error', 'OpenRouter key 未配置。', 503);
  const catalog = await fetchModelCatalog(env);
  const modelId = String(input.model || catalog.defaults.chat || DEFAULT_MODEL);
  if ((catalog.groups.openai_image || []).some((model) => model.id === modelId) || /gpt-image-|dall-e|image/i.test(modelId)) {
    throw new ModelRequestError('image_model_not_supported', '当前是生图模型，不能用于文字聊天。请切换聊天模型。', 400, { model: modelId });
  }
  const model = catalogModel(catalog, modelId);
  if (!model || ![...(catalog.groups.openai_chat || []), ...(catalog.groups.free_test || [])].some((item) => item.id === modelId)) {
    throw new ModelRequestError('model_not_allowed', '该模型不在当前正式线允许范围内。', 400, { model: modelId });
  }
  const messages = validateMessages(input.messages, { system: allowSystem });
  const settings = input.settings || {};
  // Absent/null per-request ceilings use the same visible 8,000-token default
  // as PWA and Native. A caller-provided ceiling (including short mode) wins.
  const configuredMaxTokens = settings.maxOutputTokens == null
    ? DEFAULT_FORMAL_TOKENS
    : clamp(settings.maxOutputTokens, DEFAULT_FORMAL_TOKENS, 64, MAX_FORMAL_TOKENS);
  const requestedMaxTokens = settings.max_tokens ?? input.max_tokens ?? configuredMaxTokens;
  const maxTokens = clamp(requestedMaxTokens, configuredMaxTokens, 1, MAX_FORMAL_TOKENS);
  const temperature = clamp(settings.temperature ?? input.temperature, 0.7, 0, 2);
  const effort = String(settings.reasoningEffort || '').trim();
  const allowedEfforts = Array.isArray(model.reasoning_efforts) ? model.reasoning_efforts : [];
  if (effort && !allowedEfforts.includes(effort)) {
    throw new ModelRequestError('reasoning_effort_unsupported',
      '当前模型没有提供此推理档位的可靠能力信息，请刷新模型目录或恢复默认档位。', 400,
      { model: modelId, requested_effort: effort, supported_efforts: allowedEfforts });
  }
  return {
    modelId,
    payload: chatPayload(modelId, messages, maxTokens, temperature, model, {
      responseFormat: input.response_format || null,
      reasoning: effort ? { effort } : (input.reasoning || null),
      tools: input.tools,
      toolChoice: input.tool_choice,
      sessionId: input.session_id,
    }),
  };
}
