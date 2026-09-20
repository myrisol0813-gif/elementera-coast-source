const SENSITIVE_KEY = /^(authorization|proxy-authorization|api[-_]?key|x-api-key|access[-_]?token|refresh[-_]?token|token|cookie|set-cookie|provider[-_]?secret|client[-_]?secret|session[-_]?secret|jwt|secret|password)$/i;
const ENCRYPTED_KEY = /^(encrypted_content|encrypted_reasoning|reasoning_encrypted_content)$/i;
const MODEL_PARTNER_CONTENT_PATH = /choices\.\d+\.(message|delta)\.content$/;
const MAX_RAW_FRAMES = 160;
const MAX_STRING = 16000;

function clipText(value, limit = MAX_STRING) {
  return typeof value === 'string' ? value.slice(0, limit) : '';
}

function redactString(value) {
  return String(value || '')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
    .replace(/\bor-v1-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED]');
}

export function sanitizeProviderMetadata(value, path = '') {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return redactString(value).slice(0, MAX_STRING);
  if (Array.isArray(value)) return value.slice(0, 240).map((item, index) => sanitizeProviderMetadata(item, `${path}.${index}`));
  if (typeof value !== 'object') return String(value).slice(0, 500);
  const output = {};
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = String(rawKey).slice(0, 160);
    const nextPath = path ? `${path}.${key}` : key;
    if (SENSITIVE_KEY.test(key)) {
      output[key] = '[REDACTED]';
      continue;
    }
    if (ENCRYPTED_KEY.test(key)) {
      output[key] = '[REDACTED_ENCRYPTED]';
      continue;
    }
    if (MODEL_PARTNER_CONTENT_PATH.test(nextPath)) {
      output[key] = '[OMITTED_MODEL_PARTNER_CONTENT]';
      continue;
    }
    output[key] = sanitizeProviderMetadata(rawValue, nextPath);
  }
  return output;
}

async function sha256(value) {
  if (!value) return '';
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function choiceOf(value) {
  return value?.choices?.[0] || {};
}

function reasoningTextOf(value) {
  const choice = choiceOf(value);
  const message = choice?.message || {};
  const delta = choice?.delta || {};
  const candidates = [
    delta.reasoning,
    delta.reasoning_text,
    delta.reasoning_content,
    message.reasoning,
    message.reasoning_text,
    message.reasoning_content,
    value?.reasoning,
    value?.reasoning_text,
    value?.reasoning_content,
  ];
  return candidates.find((item) => typeof item === 'string' && item) || '';
}

function reasoningSummaryOf(value) {
  const choice = choiceOf(value);
  const message = choice?.message || {};
  const delta = choice?.delta || {};
  const candidates = [
    delta.reasoning_summary,
    delta.summary,
    message.reasoning_summary,
    message.summary,
    value?.reasoning_summary,
    value?.summary,
  ];
  return candidates.find((item) => typeof item === 'string' && item) || '';
}

function reasoningDetailsOf(value) {
  const choice = choiceOf(value);
  const message = choice?.message || {};
  const delta = choice?.delta || {};
  return delta.reasoning_details ?? message.reasoning_details ?? value?.reasoning_details ?? null;
}

function collectEncrypted(value, bucket, seen = new WeakSet()) {
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectEncrypted(item, bucket, seen);
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (ENCRYPTED_KEY.test(key) && typeof item === 'string' && item) bucket.push(item);
    else if (item && typeof item === 'object') collectEncrypted(item, bucket, seen);
  }
}

function safeNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function usageMetadata(value) {
  const usage = value && typeof value === 'object' ? value : {};
  const prompt = safeNumber(usage.prompt_tokens ?? usage.input_tokens);
  const completion = safeNumber(usage.completion_tokens ?? usage.output_tokens);
  const reasoning = safeNumber(
    usage.reasoning_tokens
      ?? usage.completion_tokens_details?.reasoning_tokens
      ?? usage.output_tokens_details?.reasoning_tokens,
  );
  const cached = safeNumber(
    usage.cached_tokens
      ?? usage.prompt_tokens_details?.cached_tokens
      ?? usage.input_tokens_details?.cached_tokens,
  );
  const total = safeNumber(usage.total_tokens);
  const cost = safeNumber(usage.cost ?? usage.total_cost);
  if ([prompt, completion, reasoning, cached, total, cost].every((item) => item == null)) return null;
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    reasoning_tokens: reasoning,
    cached_tokens: cached,
    total_tokens: total,
    cost,
  };
}

function addNullableNumber(left, right) {
  if (left == null && right == null) return null;
  return Number(left || 0) + Number(right || 0);
}

export function addUsageMetadata(left, right) {
  if (!left) return right || null;
  if (!right) return left;
  return {
    prompt_tokens: addNullableNumber(left.prompt_tokens, right.prompt_tokens),
    completion_tokens: addNullableNumber(left.completion_tokens, right.completion_tokens),
    reasoning_tokens: addNullableNumber(left.reasoning_tokens, right.reasoning_tokens),
    cached_tokens: addNullableNumber(left.cached_tokens, right.cached_tokens),
    total_tokens: addNullableNumber(left.total_tokens, right.total_tokens),
    cost: addNullableNumber(left.cost, right.cost),
  };
}

export function safeRequestMetadata(payload = {}) {
  const reasoning = payload.reasoning && typeof payload.reasoning === 'object' ? payload.reasoning : {};
  const maxTokens = safeNumber(payload.max_completion_tokens ?? payload.max_tokens);
  const temperature = safeNumber(payload.temperature);
  const topP = safeNumber(payload.top_p);
  const reasoningMax = safeNumber(reasoning.max_tokens ?? payload.reasoning_max_tokens);
  return {
    temperature,
    top_p: topP,
    max_tokens: maxTokens,
    reasoning_effort: clipText(reasoning.effort ?? payload.reasoning_effort, 120) || null,
    reasoning_max_tokens: reasoningMax,
    stream: payload.stream === true,
    response_format: payload.response_format ? sanitizeProviderMetadata(payload.response_format) : null,
  };
}

function providerRouteOf(value) {
  const route = value?.provider
    ?? value?.provider_name
    ?? value?.route
    ?? value?.routing
    ?? value?.fallback
    ?? null;
  return route == null ? null : sanitizeProviderMetadata(route);
}

function providerNameOf(value) {
  const candidates = [value?.provider_name, value?.provider?.name, value?.provider];
  const found = candidates.find((item) => typeof item === 'string' && item.trim());
  return found ? found.trim().slice(0, 180) : 'openrouter';
}

function compactRawFrame(value) {
  const sanitized = sanitizeProviderMetadata(value);
  if (!sanitized || typeof sanitized !== 'object') return sanitized;
  return sanitized;
}

export function createModelMetadataCollector({ requestedModel = '', requestPayload = {}, isStream = false } = {}) {
  const state = {
    requestedModel: String(requestedModel || requestPayload?.model || '').slice(0, 180),
    resolvedModel: '',
    provider: 'openrouter',
    providerRoute: null,
    reasoningParts: [],
    summaryParts: [],
    reasoningDetails: [],
    encrypted: [],
    usage: null,
    finishReason: null,
    nativeFinishReason: null,
    toolCalls: [],
    toolResults: [],
    rawFrames: [],
    rawFramesTruncated: false,
    request: safeRequestMetadata({ ...requestPayload, stream: isStream || requestPayload?.stream === true }),
    isStream: Boolean(isStream),
  };

  function observe(value, { raw = true } = {}) {
    if (!value || typeof value !== 'object') return;
    const reasoning = reasoningTextOf(value);
    const summary = reasoningSummaryOf(value);
    const details = reasoningDetailsOf(value);
    if (reasoning) state.reasoningParts.push(clipText(reasoning));
    if (summary) state.summaryParts.push(clipText(summary, 8000));
    if (details != null) state.reasoningDetails.push(sanitizeProviderMetadata(details));
    collectEncrypted(value, state.encrypted);
    state.resolvedModel = String(value.model || state.resolvedModel || '').slice(0, 180);
    state.provider = providerNameOf(value) || state.provider;
    state.providerRoute = providerRouteOf(value) ?? state.providerRoute;
    state.usage = addUsageMetadata(state.usage, usageMetadata(value.usage));
    const choice = choiceOf(value);
    if (choice.finish_reason != null) state.finishReason = String(choice.finish_reason).slice(0, 120);
    const calls = choice?.message?.tool_calls ?? choice?.delta?.tool_calls;
    if (Array.isArray(calls) && calls.length) state.toolCalls.push(sanitizeProviderMetadata(calls));
    if (raw) {
      if (state.rawFrames.length < MAX_RAW_FRAMES) state.rawFrames.push(compactRawFrame(value));
      else state.rawFramesTruncated = true;
    }
  }

  function addToolResults(results) {
    if (Array.isArray(results) && results.length) state.toolResults.push(sanitizeProviderMetadata(results));
  }

  function setFinish(finishReason, nativeFinishReason = null) {
    if (finishReason != null) state.finishReason = String(finishReason).slice(0, 120);
    if (nativeFinishReason != null) state.nativeFinishReason = String(nativeFinishReason).slice(0, 120);
  }

  async function snapshot({ aborted = false, timeout = false, errorSummary = '', status = 'saved' } = {}) {
    const encryptedText = state.encrypted.join('\n');
    return {
      status,
      sanitized: true,
      metadata: {
        requested_model: state.requestedModel || null,
        resolved_model: state.resolvedModel || state.requestedModel || null,
        provider: state.provider || null,
        provider_route: state.providerRoute,
        reasoning_text: state.reasoningParts.join('').slice(0, 64000) || null,
        reasoning_summary: state.summaryParts.join('\n').slice(0, 24000) || null,
        reasoning_details: state.reasoningDetails.length ? state.reasoningDetails : null,
        reasoning_encrypted_content_present: state.encrypted.length > 0,
        reasoning_encrypted_content_length: encryptedText ? encryptedText.length : null,
        reasoning_encrypted_content_digest: encryptedText ? await sha256(encryptedText) : null,
        reasoning_status: state.reasoningParts.length || state.summaryParts.length || state.reasoningDetails.length
          ? 'returned'
          : state.encrypted.length ? 'encrypted_only' : 'not_returned',
        usage: state.usage,
        finish_reason: state.finishReason,
        native_finish_reason: state.nativeFinishReason,
        is_stream: state.isStream,
        is_aborted: Boolean(aborted),
        is_timeout: Boolean(timeout),
        error_summary: clipText(errorSummary, 1200) || null,
        tool_calls: state.toolCalls.length ? state.toolCalls : null,
        tool_results: state.toolResults.length ? state.toolResults : null,
        request: state.request,
      },
      raw_metadata_sanitized: {
        provider_calls: state.rawFrames,
        frames_truncated: state.rawFramesTruncated,
      },
    };
  }

  return Object.freeze({ observe, addToolResults, setFinish, snapshot });
}

export async function metadataFromProviderCalls({ requestedModel, calls = [], requestPayload = {}, toolResults = [] } = {}) {
  const collector = createModelMetadataCollector({ requestedModel, requestPayload, isStream: false });
  for (const value of calls) collector.observe(value);
  collector.addToolResults(toolResults);
  return collector.snapshot();
}
