import { MAX_CHAT_CONTENT_CHARS } from './model-constants.js';

export class ModelRequestError extends Error {
  constructor(type, message, status = 400, details = {}) {
    super(message);
    this.name = 'ModelRequestError';
    this.type = type;
    this.status = status;
    this.details = details;
  }
}

export function clamp(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

export function normalizeUsage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const fields = ['prompt_tokens', 'completion_tokens', 'total_tokens'];
  const values = fields.map((field) => Number(value[field]));
  if (!values.every((number) => Number.isFinite(number) && number >= 0)) return null;
  return Object.fromEntries(fields.map((field, index) => [field, Math.trunc(values[index])]));
}

const MAX_IMAGE_DATA_URL_CHARS = 12 * 1024 * 1024;

function validateTextContent(content, maxContent) {
  if (typeof content !== 'string' || !content.trim() || content.length > maxContent) {
    const tooLong = typeof content === 'string' && content.length > maxContent;
    throw new ModelRequestError(
      tooLong ? 'request_body_too_large' : 'invalid_messages',
      tooLong ? `单条模型消息超过海岸技术保护上限 ${maxContent} 字符，海岸没有静默裁剪。` : '消息内容无效。',
      tooLong ? 413 : 400,
      tooLong ? { technical_max_message_chars: maxContent, attempted_chars: content.length } : {},
    );
  }
  return content;
}

function validateUserMultimodalContent(content, maxContent) {
  if (!Array.isArray(content) || !content.length || content.length > 16) {
    throw new ModelRequestError('invalid_messages', '多模态消息格式无效。', 400);
  }
  let textChars = 0;
  const parts = content.map((part) => {
    if (part?.type === 'text' && typeof part.text === 'string') {
      const text = part.text;
      textChars += text.length;
      if (textChars > maxContent) {
        throw new ModelRequestError(
          'request_body_too_large',
          `单条模型消息超过海岸技术保护上限 ${maxContent} 字符，海岸没有静默裁剪。`,
          413,
          { technical_max_message_chars: maxContent, attempted_chars: textChars },
        );
      }
      return { type: 'text', text };
    }
    const url = part?.type === 'image_url' ? String(part?.image_url?.url || '') : '';
    if (
      url
      && /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(url)
      && url.length <= MAX_IMAGE_DATA_URL_CHARS
    ) {
      return { type: 'image_url', image_url: { url } };
    }
    throw new ModelRequestError('invalid_messages', '图片附件格式无效。', 400);
  });
  if (!parts.some((part) => part.type === 'text' && part.text.trim()) && !parts.some((part) => part.type === 'image_url')) {
    throw new ModelRequestError('invalid_messages', '多模态消息为空。', 400);
  }
  return parts;
}

export function validateMessages(messages, { system = false, maxContent = MAX_CHAT_CONTENT_CHARS } = {}) {
  if (!Array.isArray(messages) || messages.length < 1) {
    throw new ModelRequestError('invalid_messages', '消息格式无效。', 400);
  }
  const roles = system ? ['system', 'user', 'assistant'] : ['user', 'assistant'];
  return messages.map((message) => {
    if (!message || !roles.includes(message.role)) {
      throw new ModelRequestError('invalid_messages', '消息角色无效。', 400);
    }
    const content = message.role === 'user' && Array.isArray(message.content)
      ? validateUserMultimodalContent(message.content, maxContent)
      : validateTextContent(message.content, maxContent);
    return { role: message.role, content };
  });
}

export function catalogModel(catalog, modelId) {
  return [
    ...(catalog?.groups?.openai_chat || []),
    ...(catalog?.groups?.free_test || []),
    ...(catalog?.groups?.openai_image || []),
  ].find((model) => model.id === modelId) || null;
}

export function supportsTemperature(modelId, model) {
  if (Array.isArray(model?.supported_parameters) && model.supported_parameters.length) {
    return model.supported_parameters.includes('temperature');
  }
  const id = String(modelId || '').toLowerCase();
  return !(id.startsWith('openai/o') || id.startsWith('openai/gpt-5'));
}

export function supportsReasoningControl(modelId, model) {
  const parameters = Array.isArray(model?.supported_parameters) ? model.supported_parameters : [];
  return parameters.includes('reasoning') || /^openai\/(?:o|gpt-5)/i.test(String(modelId || ''));
}

export function supportsResponseFormat(model) {
  return Array.isArray(model?.supported_parameters) && model.supported_parameters.includes('response_format');
}

export function supportsTools(modelId, model) {
  const parameters = Array.isArray(model?.supported_parameters) ? model.supported_parameters : [];
  if (parameters.length) {
    return parameters.includes('tools') || parameters.includes('tool_choice');
  }
  return String(modelId || '').startsWith('openai/');
}

function normalizeWebSearchTool(tool) {
  if (tool?.type !== 'openrouter:web_search') return null;
  const input = tool.parameters && typeof tool.parameters === 'object' && !Array.isArray(tool.parameters)
    ? tool.parameters
    : {};
  const engine = ['auto', 'native', 'exa', 'firecrawl', 'parallel', 'perplexity'].includes(input.engine)
    ? input.engine
    : 'auto';
  const parameters = {
    engine,
    max_results: Math.min(10, Math.max(1, Math.trunc(Number(input.max_results) || 5))),
    max_total_results: Math.min(30, Math.max(1, Math.trunc(Number(input.max_total_results) || 10))),
  };
  if (['low', 'medium', 'high'].includes(input.search_context_size)) {
    parameters.search_context_size = input.search_context_size;
  }
  const maxCharacters = Number(input.max_characters);
  if (Number.isFinite(maxCharacters)) parameters.max_characters = Math.min(100000, Math.max(1, Math.trunc(maxCharacters)));
  return { type: 'openrouter:web_search', parameters };
}

export function normalizeTools(value) {
  const normalized = [];
  for (const tool of Array.isArray(value) ? value : []) {
    const webSearch = normalizeWebSearchTool(tool);
    if (webSearch) {
      normalized.push(webSearch);
      continue;
    }
    if (tool?.type !== 'function'
      || !/^[a-zA-Z0-9_-]{1,64}$/.test(String(tool?.function?.name || ''))
      || !tool?.function?.parameters
      || typeof tool.function.parameters !== 'object') continue;
    normalized.push({
      type: 'function',
      function: {
        name: String(tool.function.name),
        description: String(tool.function.description || '').slice(0, 2000),
        parameters: tool.function.parameters,
      },
    });
  }
  return normalized;
}

export function compact(value, max = 160) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function creditTokenShortfall(preview = '') {
  const match = String(preview).match(/requested up to\s+([\d,]+)\s+tokens?,\s+but can only afford\s+([\d,]+)/i);
  if (!match) return null;
  const requested = Number(match[1].replace(/,/g, ''));
  const affordable = Number(match[2].replace(/,/g, ''));
  if (!Number.isFinite(requested) || !Number.isFinite(affordable)) return null;
  return { requested: Math.trunc(requested), affordable: Math.trunc(affordable), missing: Math.max(0, Math.trunc(requested - affordable)) };
}

function contextLimitPreview(lower) {
  return lower.includes('context_length_exceeded')
    || lower.includes('context length')
    || lower.includes('maximum context')
    || lower.includes('max context')
    || lower.includes('too many tokens')
    || lower.includes('prompt is too long')
    || lower.includes('input is too long');
}

export function normalizedProviderError(status, model, preview = '') {
  const lower = preview.toLowerCase();
  if (status === 401) return ['auth_error', 'API key 无效或未配置。'];
  if (status === 402) {
    const credit = creditTokenShortfall(preview);
    if (credit) return ['insufficient_credits', `OpenRouter 额度预检未通过：本次最大输出设为 ${credit.requested} tokens，当前余额最多负担 ${credit.affordable}，还差 ${credit.missing} tokens。请在 API 小屋把“最大输出 token”调到 ${credit.affordable} 或更低。`];
    return ['insufficient_credits', 'OpenRouter 余额或 credits 不足。可以在 API 小屋调低“最大输出 token”。'];
  }
  if (status === 413) return ['request_body_too_large', 'provider 拒绝了过大的请求体；海岸没有偷偷缩短跨窗口内容。'];
  if (contextLimitPreview(lower)) return ['context_length_exceeded', 'provider / 模型拒绝了这次完整上下文；海岸没有偷偷裁剪跨窗口内容。'];
  if (status === 408 || lower.includes('timed out') || lower.includes('timeout')) return ['provider_timeout', 'provider 在等待完整请求时超时；海岸没有自动缩短后重试。'];
  if (status === 403 && lower.includes('not available in your region')) return ['region_unavailable', '该模型在当前网络地区不可用。可以切换网络出口，或换用其他模型。'];
  if (status === 403) return ['forbidden', '当前 key 或账户没有权限使用该模型。'];
  if (status === 404) return ['model_not_found', '模型不存在或已下架。'];
  if (status === 429) return ['rate_limited', '请求过快或模型限速，请稍后再试。'];
  if ([502, 503, 504].includes(status)) return ['provider_unavailable', '上游模型暂时不可用。可以稍后重试或换模型。'];
  return ['chat_error', '消息生成失败，请稍后重试。'];
}

export function normalizeToolCalls(value) {
  const calls = Array.isArray(value) ? value : [];
  return calls.map((call) => {
    const id = String(call?.id || '').slice(0, 160);
    const name = String(call?.function?.name || '').slice(0, 64);
    const rawArguments = call?.function?.arguments;
    const args = typeof rawArguments === 'string'
      ? rawArguments
      : JSON.stringify(rawArguments && typeof rawArguments === 'object' ? rawArguments : {});
    if (!id || !/^[a-zA-Z0-9_-]{1,64}$/.test(name)) {
      throw new ModelRequestError('invalid_provider_response', '模型返回了无效的工具调用。', 502);
    }
    return {
      id,
      type: 'function',
      function: {
        name,
        arguments: args.slice(0, 24000),
      },
    };
  });
}

export function addUsage(left, right) {
  const current = normalizeUsage(left);
  const next = normalizeUsage(right);
  if (!current) return next;
  if (!next) return current;
  return {
    prompt_tokens: current.prompt_tokens + next.prompt_tokens,
    completion_tokens: current.completion_tokens + next.completion_tokens,
    total_tokens: current.total_tokens + next.total_tokens,
  };
}