import { OPENROUTER_CHAT_URL, OPENROUTER_REFERER } from './model-constants.js';
import { openRouterKey } from './model-catalog.js';
import { prepareFormalChat } from './model-payload.js';
import { SseParseError, parseSseEventBlock } from '../stream-format.js';
import {
  ModelRequestError,
  addUsage,
  compact,
  normalizeToolCalls,
  normalizeUsage,
  normalizedProviderError,
} from './model-validation.js';
import {
  createModelMetadataCollector,
  metadataFromProviderCalls,
} from './model-metadata.js';

async function providerError(response) {
  const raw = await response.text().catch(() => '');
  try {
    const value = JSON.parse(raw);
    return compact(value?.error?.message || value?.message || value?.error || raw);
  } catch {
    return compact(raw);
  }
}

function providerRequest(env, payload, title, signal) {
  return fetch(OPENROUTER_CHAT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openRouterKey(env)}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': OPENROUTER_REFERER,
      'X-Title': title,
    },
    body: JSON.stringify(payload),
    signal,
  });
}

export async function requestOpenRouter(env, payload, title) {
  let response;
  try {
    response = await providerRequest(env, payload, title);
  } catch {
    throw new ModelRequestError('provider_unavailable', '上游模型暂时不可用。', 502, { model: payload.model });
  }
  if (!response.ok) {
    const preview = await providerError(response);
    const [type, message] = normalizedProviderError(response.status, payload.model, preview);
    const status = [401, 402, 403, 404, 429].includes(response.status) ? response.status : 502;
    throw new ModelRequestError(type, message, status, {
      model: payload.model,
      upstream_status: response.status,
      provider_message_preview: preview,
    });
  }
  try {
    return await response.json();
  } catch {
    throw new ModelRequestError('invalid_provider_response', '上游返回了无效响应。', 502, { model: payload.model });
  }
}

async function requestOpenRouterStream(env, payload, title, signal) {
  let response;
  try {
    response = await providerRequest(env, payload, title, signal);
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new ModelRequestError('provider_unavailable', '上游模型暂时不可用。', 502, { model: payload.model });
  }
  if (!response.ok) {
    const preview = await providerError(response);
    const [type, message] = normalizedProviderError(response.status, payload.model, preview);
    const status = [401, 402, 403, 404, 429].includes(response.status) ? response.status : 502;
    throw new ModelRequestError(type, message, status, {
      model: payload.model,
      upstream_status: response.status,
      provider_message_preview: preview,
    });
  }
  if (!response.body) throw new ModelRequestError('invalid_provider_response', '上游没有返回可读取的流。', 502, { model: payload.model });
  return response;
}

async function* readProviderSse(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const blocks = function* (final = false) {
    while (true) {
      const match = buffer.match(/\r?\n\r?\n/);
      if (!match || match.index == null) break;
      const block = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      yield block;
    }
    if (final && buffer.trim()) {
      const block = buffer;
      buffer = '';
      yield block;
    }
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for (const block of blocks()) yield block;
    }
    buffer += decoder.decode();
    for (const block of blocks(true)) yield block;
  } finally {
    reader.releaseLock();
  }
}

function streamChunkError(value, modelId) {
  const status = Number(value?.error?.code || value?.error?.status || 502);
  const preview = compact(value?.error?.message || value?.message || '');
  const [type, message] = normalizedProviderError(status, modelId, preview);
  return new ModelRequestError(type, message, 502, {
    model: modelId,
    upstream_status: status,
    provider_message_preview: preview,
  });
}

function currentUserQuery(input, prepared) {
  const explicit = String(input?.web_search_query || '').trim();
  if (explicit) return explicit.slice(0, 800);
  const messages = Array.isArray(prepared?.payload?.messages) ? prepared.payload.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'user') continue;
    if (typeof message.content === 'string') return message.content.trim().slice(0, 800);
    if (Array.isArray(message.content)) {
      const text = message.content
        .filter((part) => part?.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text)
        .join('\n')
        .trim();
      if (text) return text.slice(0, 800);
    }
  }
  return '';
}

function webSearchEnabled(payload) {
  return (Array.isArray(payload?.tools) ? payload.tools : [])
    .some((tool) => tool?.type === 'openrouter:web_search');
}

function webSearchRequestCount(value) {
  const count = Number(value?.usage?.server_tool_use?.web_search_requests);
  return Number.isFinite(count) && count > 0 ? Math.trunc(count) : 0;
}

function citationOf(value) {
  if (!value || typeof value !== 'object') return null;
  const kind = String(value.type || value.annotation_type || '');
  const body = value.url_citation && typeof value.url_citation === 'object'
    ? value.url_citation
    : value;
  const url = String(body.url || body.uri || '').trim().slice(0, 2000);
  if (kind && kind !== 'url_citation' && !url) return null;
  if (!url || !/^https?:\/\//i.test(url)) return null;
  return {
    title: String(body.title || body.name || url).replace(/\s+/g, ' ').trim().slice(0, 300),
    url,
    content: String(body.content || body.snippet || body.text || '').trim().slice(0, 4000),
  };
}

function annotationsOf(value) {
  const choice = value?.choices?.[0] || {};
  const message = choice?.message || {};
  const delta = choice?.delta || {};
  return [
    ...(Array.isArray(message.annotations) ? message.annotations : []),
    ...(Array.isArray(delta.annotations) ? delta.annotations : []),
    ...(Array.isArray(value?.annotations) ? value.annotations : []),
  ];
}

function createWebSearchTracker(input, prepared) {
  const available = webSearchEnabled(prepared?.payload);
  const requestedQuery = currentUserQuery(input, prepared);
  let requests = 0;
  const results = new Map();
  function observe(value) {
    requests += webSearchRequestCount(value);
    for (const annotation of annotationsOf(value)) {
      const citation = citationOf(annotation);
      if (!citation) continue;
      const key = citation.url;
      if (!results.has(key)) results.set(key, citation);
      else {
        const existing = results.get(key);
        results.set(key, {
          ...existing,
          title: existing.title || citation.title,
          content: existing.content || citation.content,
        });
      }
    }
  }
  function snapshot() {
    const list = [...results.values()].slice(0, 20);
    return {
      web_search: {
        available,
        used: requests > 0 || list.length > 0,
        requested_query: requestedQuery,
        query_source: 'current_user_message',
        provider_query_returned: false,
        requests,
        results_count: list.length,
        results: list,
        ...(!available ? { reason: 'model_tools_unsupported_or_web_tool_not_exposed' } : {}),
      },
    };
  }
  return Object.freeze({ observe, snapshot });
}

function safeToolFailure(error) {
  return {
    ok: false,
    error: {
      type: String(error?.type || 'tool_execution_failed').slice(0, 120),
      message: String(error?.message || '工具执行失败。').slice(0, 1200),
    },
  };
}

async function executeToolCalls(calls, executeTool) {
  const results = [];
  const messages = [];
  for (const call of calls) {
    let value;
    try {
      value = await executeTool(call);
    } catch (error) {
      value = safeToolFailure(error);
    }
    const normalized = value && typeof value === 'object' ? value : { ok: true, result: value ?? null };
    results.push({
      id: call.id,
      name: call.function.name,
      result: normalized,
    });
    messages.push({
      role: 'tool',
      tool_call_id: call.id,
      name: call.function.name,
      content: JSON.stringify(normalized),
    });
  }
  return { results, messages };
}

function completedReply(message, model, finishReason, completedToolCalls = 0) {
  const content = typeof message?.content === 'string' ? message.content : '';
  if (!content.trim()) {
    throw new ModelRequestError('empty_model_reply', '模型结束了工具调用，但没有返回可展示正文。前端没有把空白回复当作成功。', 502, {
      model,
      finish_reason: finishReason || null,
      completed_tool_calls: completedToolCalls,
    });
  }
  return content;
}

export async function performFormalChat(env, input = {}, {
  allowSystem = false,
  captureMetadata = false,
} = {}) {
  const prepared = await prepareFormalChat(env, input, allowSystem);
  const webSearch = createWebSearchTracker(input, prepared);
  const upstream = await requestOpenRouter(env, prepared.payload, 'Elementera Coast Formal Chat');
  webSearch.observe(upstream);
  const choice = upstream?.choices?.[0] || {};
  const result = {
    ok: true,
    model: upstream?.model || prepared.modelId,
    message: { role: 'assistant', content: typeof choice?.message?.content === 'string' ? choice.message.content : '' },
    usage: normalizeUsage(upstream?.usage),
    finish_reason: choice?.finish_reason || null,
    server_tools: webSearch.snapshot(),
  };
  if (captureMetadata) {
    result.model_metadata = await metadataFromProviderCalls({
      requestedModel: prepared.modelId,
      calls: [upstream],
      requestPayload: prepared.payload,
    });
  }
  return result;
}

export async function performFormalChatWithTools(env, input = {}, {
  allowSystem = false,
  executeTool,
  captureMetadata = false,
} = {}) {
  const prepared = await prepareFormalChat(env, input, allowSystem);
  const webSearch = createWebSearchTracker(input, prepared);
  const providerCalls = [];
  const allToolResults = [];
  let usage = null;
  let messages = [...prepared.payload.messages];

  while (true) {
    const upstream = await requestOpenRouter(env, {
      ...prepared.payload,
      messages,
    }, 'Elementera Coast Formal Chat');
    providerCalls.push(upstream);
    webSearch.observe(upstream);
    usage = addUsage(usage, upstream?.usage);
    const choice = upstream?.choices?.[0] || {};
    const message = choice?.message || {};
    const calls = normalizeToolCalls(message.tool_calls);

    if (!calls.length) {
      const model = upstream?.model || prepared.modelId;
      const content = completedReply(message, model, choice?.finish_reason, allToolResults.length);
      const result = {
        ok: true,
        model,
        message: { role: 'assistant', content },
        usage: normalizeUsage(usage),
        finish_reason: choice?.finish_reason || null,
        tool_results: allToolResults,
        server_tools: webSearch.snapshot(),
      };
      if (captureMetadata) {
        result.model_metadata = await metadataFromProviderCalls({
          requestedModel: prepared.modelId,
          calls: providerCalls,
          requestPayload: prepared.payload,
          toolResults: allToolResults,
        });
      }
      return result;
    }

    if (choice?.finish_reason !== 'tool_calls') {
      throw new ModelRequestError('invalid_provider_response', '模型返回了工具调用，但 finish_reason 不是 tool_calls。', 502);
    }

    if (typeof executeTool !== 'function') {
      throw new ModelRequestError('tool_executor_missing', '模型请求了本地工具，但当前调用没有工具执行器。', 500);
    }
    const executed = await executeToolCalls(calls, executeTool);
    allToolResults.push(...executed.results);
    messages = [
      ...messages,
      {
        role: 'assistant',
        content: typeof message.content === 'string' ? message.content : null,
        tool_calls: calls,
      },
      ...executed.messages,
    ];
  }
}

function appendStreamToolCalls(target, chunks) {
  for (const chunk of Array.isArray(chunks) ? chunks : []) {
    const index = Number.isFinite(Number(chunk?.index)) ? Number(chunk.index) : target.size;
    const current = target.get(index) || {
      id: '',
      type: 'function',
      function: { name: '', arguments: '' },
    };
    if (chunk?.id) current.id = String(chunk.id).slice(0, 160);
    if (chunk?.function?.name) current.function.name += String(chunk.function.name);
    if (chunk?.function?.arguments) current.function.arguments += String(chunk.function.arguments);
    target.set(index, current);
  }
}

export async function* performFormalChatStream(env, input = {}, {
  allowSystem = false,
  signal,
  executeTool,
  onMetadata,
} = {}) {
  const prepared = await prepareFormalChat(env, input, allowSystem);
  const webSearch = createWebSearchTracker(input, prepared);
  let messages = [...prepared.payload.messages];
  let metaSent = false;
  let actualModel = prepared.modelId;
  let generationId = crypto.randomUUID();
  let totalUsage = null;
  let completedToolCalls = 0;
  const metadataCollector = typeof onMetadata === 'function'
    ? createModelMetadataCollector({
      requestedModel: prepared.modelId,
      requestPayload: prepared.payload,
      isStream: true,
    })
    : null;

  try {
    while (true) {
      const payload = {
        ...prepared.payload,
        messages,
        stream: true,
        stream_options: { include_usage: true },
      };
      const response = await requestOpenRouterStream(env, payload, 'Elementera Coast Formal Chat', signal);
      let finishReason = null;
      let providerDone = false;
      let roundContent = '';
      const toolChunks = new Map();

      for await (const block of readProviderSse(response)) {
        let parsedEvent;
        try {
          parsedEvent = parseSseEventBlock(block);
        } catch (error) {
          if (error instanceof SseParseError) {
            throw new ModelRequestError('invalid_provider_response', '上游返回了无效的流式响应。', 502, { model: prepared.modelId });
          }
          throw error;
        }
        if (!parsedEvent) continue;
        if (parsedEvent.data === '[DONE]') {
          providerDone = true;
          break;
        }
        const value = parsedEvent.data;
        if (value?.error) throw streamChunkError(value, prepared.modelId);
        metadataCollector?.observe(value);
        webSearch.observe(value);
        actualModel = String(value?.model || actualModel || prepared.modelId);
        generationId = String(value?.id || generationId);
        if (!metaSent) {
          metaSent = true;
          yield { event: 'meta', data: { model: actualModel, generation_id: generationId } };
        }
        const delta = value?.choices?.[0]?.delta || {};
        const content = delta.content;
        if (typeof content === 'string' && content) {
          roundContent += content;
          yield { event: 'delta', data: { content } };
        }
        appendStreamToolCalls(toolChunks, delta.tool_calls);
        totalUsage = addUsage(totalUsage, value?.usage);
        if (value?.choices?.[0]?.finish_reason != null) finishReason = String(value.choices[0].finish_reason);
      }

      if (!providerDone && finishReason == null) {
        throw new ModelRequestError('stream_incomplete', '上游流式响应提前中断。', 502, { model: prepared.modelId });
      }

      const calls = normalizeToolCalls([...toolChunks.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, call]) => call));

      if (calls.length) {
        if (finishReason !== 'tool_calls') {
          throw new ModelRequestError('invalid_provider_response', '模型返回了工具调用，但 finish_reason 不是 tool_calls。', 502);
        }
        if (typeof executeTool !== 'function') {
          throw new ModelRequestError('tool_executor_missing', '模型请求了本地工具，但当前调用没有工具执行器。', 500);
        }
        const executed = await executeToolCalls(calls, executeTool);
        completedToolCalls += executed.results.length;
        metadataCollector?.addToolResults(executed.results);
        for (const result of executed.results) {
          yield {
            event: 'tool',
            data: {
              id: result.id,
              name: result.name,
              ok: result.result?.ok !== false,
              result: result.result,
            },
          };
        }
        messages = [
          ...messages,
          {
            role: 'assistant',
            content: roundContent || null,
            tool_calls: calls,
          },
          ...executed.messages,
        ];
        continue;
      }

      if (!roundContent.trim()) {
        throw new ModelRequestError('empty_model_reply', '模型结束了工具调用，但没有返回可展示正文。前端没有把空白回复当作成功。', 502, {
          model: actualModel,
          finish_reason: finishReason,
          completed_tool_calls: completedToolCalls,
        });
      }
      metadataCollector?.setFinish(finishReason);
      if (metadataCollector && typeof onMetadata === 'function') {
        await onMetadata(await metadataCollector.snapshot());
      }
      if (!metaSent) yield { event: 'meta', data: { model: actualModel, generation_id: generationId } };
      yield { event: 'server_tools', data: webSearch.snapshot() };
      if (totalUsage) yield { event: 'usage', data: totalUsage };
      yield { event: 'done', data: { finish_reason: finishReason } };
      return;
    }
  } catch (error) {
    const aborted = error?.name === 'AbortError';
    metadataCollector?.setFinish(aborted ? 'cancelled' : 'error');
    if (metadataCollector && typeof onMetadata === 'function') {
      await onMetadata(await metadataCollector.snapshot({
        aborted,
        errorSummary: aborted ? '' : String(error?.message || '流式生成中断。').slice(0, 1200),
      })).catch(() => undefined);
    }
    throw error;
  }
}
