import { estimateContextTokens } from './context-comfort-range.js';
import { fetchModelCatalog, cachedCatalogModel } from './models/model-catalog.js';
import { ModelRequestError } from './models/model-validation.js';

export function resolveContextBudget(settings = {}, modelEntry = null, tools = []) {
  const automatic = settings.contextBudget === 0 || settings.contextBudget === '0';
  const manual = Number(settings.contextBudget);
  const desired = automatic ? 18000 : Number.isSafeInteger(manual) && manual >= 1800 ? manual : 6000;
  const positive = n => Number.isSafeInteger(Number(n)) && Number(n) > 0;
  const windows = [modelEntry?.context_length, modelEntry?.top_provider?.context_length].filter(positive).map(Number);
  const window = windows.length ? Math.min(...windows) : null;
  if (window === null) return { ceiling: desired, materialLimit: null, note: automatic
    ? '自动预算 · 未取得模型目录容量，采用 18000 token 舒服区间；不是模型真实上限。'
    : '手动预算 · 未取得模型目录容量，实际仍由供应商限制。' };
  const configuredOutput = settings.outputLength === 'short' ? 700 : Number(settings.maxOutputTokens ?? settings.max_tokens ?? 8000);
  const output = Number.isFinite(configuredOutput) ? Math.min(65536, Math.max(64, Math.trunc(configuredOutput))) : 8000;
  const toolReserve = tools.length ? 4096 + estimateContextTokens(JSON.stringify(tools)) : 0;
  const materialLimit = window - output - toolReserve - 256;
  if (materialLimit < 1800) throw new ModelRequestError('context_window_too_small', '模型目录报告的容量不足以同时预留输出及工具空间，请降低输出上限或换用更大窗口的模型。');
  return { ceiling: automatic ? materialLimit : Math.min(desired, materialLimit), materialLimit,
    note: (automatic ? '自动预算' : '手动预算') + ' · 目录窗口 ' + window + ' · 输出预留 ' + output
      + (toolReserve ? ' · 工具预留 ' + toolReserve : '') + ' · 估算文本输入上限 ' + materialLimit + '；实际以供应商为准。' };
}

export async function contextBudgetForModel(env, settings, model, tools) {
  const id = String(model || '');
  let entry = cachedCatalogModel(id);
  // Only the explicitly chosen OpenRouter route can request its catalog here.
  // Account-plan and unknown routes keep an honest unknown-capacity fallback.
  if (!entry && (settings.contextBudget === 0 || settings.contextBudget === '0') && /^[^/:]+\/.+/.test(id)) {
    try {
      const catalog = await fetchModelCatalog(env);
      entry = Object.values(catalog.groups || {}).flat().find(item => item.id === id) || null;
    } catch { entry = null; }
  }
  return resolveContextBudget(settings, entry, tools);
}

/** Estimate the actual request, not base64 length or only the pre-attachment text.
 * Image token usage depends on provider/model; 2048 per image is an estimate,
 * not a promise of the actual billed vision cost. */
export function estimateWireInputTokens(payload = {}) {
  const estimatePart = part => part?.type === 'text'
    ? estimateContextTokens(part.text || '')
    : part?.type === 'image_url' ? 2048 : estimateContextTokens(JSON.stringify(part || {}));
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const tools = Array.isArray(payload.tools) ? payload.tools : [];
  return messages.reduce((total, message) => {
    const content = Array.isArray(message?.content)
      ? message.content.reduce((sum, part) => sum + estimatePart(part), 0)
      : estimateContextTokens(message?.content || '');
    const calls = message?.tool_calls ? estimateContextTokens(JSON.stringify(message.tool_calls)) : 0;
    return total + content + calls + 4;
  }, 0) + (tools.length ? estimateContextTokens(JSON.stringify(tools)) : 0);
}

export function assertWireInputBudget(payload, modelEntry = cachedCatalogModel(payload.model), continuation = false) {
  const windows = [modelEntry?.context_length, modelEntry?.top_provider?.context_length]
    .map(Number).filter(n => Number.isSafeInteger(n) && n > 0);
  const estimate = estimateWireInputTokens(payload);
  if (!windows.length) return estimate;
  const window = Math.min(...windows);
  const output = Number(payload.max_completion_tokens ?? payload.max_tokens ?? 8000);
  const limit = window - (Number.isFinite(output) && output > 0 ? output : 8000) - 256;
  if (estimate > limit) {
    throw new ModelRequestError('context_window_estimate_exceeded',
      continuation
        ? '工具执行后的完整输入预计超过模型目录容量；已停止续请求，已成功执行的工具不会自动撤销。'
        : '完整消息、附件及工具定义预计超过模型目录容量；未发送给模型，请减少附件或降低输出上限。',
      400, { estimated_input_tokens: estimate, estimated_input_limit: Math.max(0, limit),
        directory_context_length: window, continuation });
  }
  return estimate;
}
