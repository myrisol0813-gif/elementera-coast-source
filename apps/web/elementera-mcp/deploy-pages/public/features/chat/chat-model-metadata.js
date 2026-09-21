import { API, requestJson } from '../../core/api.js';
import { escapeAttribute, escapeHtml } from '../../core/dom.js';

const summaryCache = new Map();
const rawCache = new Map();
let stylesInstalled = false;

function ensureStyles() {
  if (stylesInstalled || typeof document === 'undefined') return;
  stylesInstalled = true;
  if (document.querySelector('link[data-model-metadata-styles]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/public/styles/model-metadata.css';
  link.dataset.modelMetadataStyles = 'true';
  document.head.append(link);
}

function key(conversationId, messageId) {
  return `${conversationId}:${messageId}`;
}

function statusLabel(value) {
  return ({
    saved: '已保存',
    save_failed: '保存失败',
    not_returned: '未返回',
    sanitized: '已脱敏',
  })[String(value || '')] || String(value || '未返回');
}

function metadataUrl(conversationId, messageId, includeRaw = false) {
  const params = new URLSearchParams({ conversation_id: conversationId, message_id: messageId });
  if (includeRaw) params.set('include_raw', '1');
  return `${API.messageMetadata}?${params}`;
}

function jsonText(value, fallback = '') {
  if (value == null) return fallback;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return fallback;
  }
}

function row(label, value, { pre = false } = {}) {
  const text = jsonText(value).trim();
  if (!text) return '';
  return `<div class="model-metadata-row"><b>${escapeHtml(label)}</b>${pre
    ? `<pre>${escapeHtml(text)}</pre>`
    : `<span>${escapeHtml(text)}</span>`}</div>`;
}

function section(title, content, emptyText = '') {
  const body = String(content || '');
  return `<section class="model-metadata-section"><h4>${escapeHtml(title)}</h4>${body || `<p class="model-metadata-empty">${escapeHtml(emptyText)}</p>`}</section>`;
}

function reasoningSection(metadata = {}) {
  const body = [
    row('推理摘要', metadata.reasoning_summary, { pre: true }),
    row('推理文本', metadata.reasoning_text, { pre: true }),
    row('结构化详情', metadata.reasoning_details, { pre: true }),
    metadata.reasoning_encrypted_content_present
      ? row('加密内容', [
        '存在加密推理内容',
        metadata.reasoning_encrypted_content_length != null ? `长度 ${metadata.reasoning_encrypted_content_length}` : '',
        metadata.reasoning_encrypted_content_digest ? `digest ${metadata.reasoning_encrypted_content_digest}` : '',
      ].filter(Boolean).join(' · '))
      : '',
  ].join('');
  return section('推理痕迹', body, '本轮模型没有返回可展示的推理痕迹。');
}

function usageSection(metadata = {}) {
  const usage = metadata.usage || {};
  const body = [
    row('输入', usage.prompt_tokens != null ? `${usage.prompt_tokens} tokens` : ''),
    row('输出', usage.completion_tokens != null ? `${usage.completion_tokens} tokens` : ''),
    row('推理', usage.reasoning_tokens != null ? `${usage.reasoning_tokens} tokens` : ''),
    row('缓存', usage.cached_tokens != null ? `${usage.cached_tokens} tokens` : ''),
    row('总计', usage.total_tokens != null ? `${usage.total_tokens} tokens` : ''),
    row('成本', usage.cost != null ? String(usage.cost) : ''),
  ].join('');
  return section('用量', body, '本轮供应商没有返回用量字段。');
}

function providerSection(metadata = {}) {
  const body = [
    row('请求模型', metadata.requested_model),
    row('实际模型', metadata.resolved_model),
    row('Provider', metadata.provider),
    row('Route / fallback', metadata.provider_route, { pre: true }),
  ].join('');
  return section('模型与供应商', body, '本轮没有返回额外的模型路由信息。');
}

function finishSection(metadata = {}) {
  const body = [
    row('finish_reason', metadata.finish_reason),
    row('native_finish_reason', metadata.native_finish_reason),
    row('模式', metadata.is_stream == null ? '' : metadata.is_stream ? 'streaming' : 'non-streaming'),
    row('中断', metadata.is_aborted ? '是' : ''),
    row('超时', metadata.is_timeout ? '是' : ''),
    row('错误摘要', metadata.error_summary),
  ].join('');
  return section('完成状态', body, '本轮没有额外完成状态。');
}

function toolSection(metadata = {}) {
  const body = [
    row('tool_calls', metadata.tool_calls, { pre: true }),
    row('tool_results', metadata.tool_results, { pre: true }),
  ].join('');
  return section('工具调用', body, '本轮没有返回工具调用痕迹。');
}

function requestSection(metadata = {}) {
  const request = metadata.request || {};
  const body = [
    row('temperature', request.temperature),
    row('top_p', request.top_p),
    row('max_tokens', request.max_tokens),
    row('reasoning_effort', request.reasoning_effort),
    row('reasoning_max_tokens', request.reasoning_max_tokens),
    row('stream', request.stream == null ? '' : String(request.stream)),
    row('response_format', request.response_format, { pre: true }),
  ].join('');
  return section('请求参数', body, '本轮没有可展示的请求参数。');
}

function summaryHtml(response, conversationId, messageId) {
  if (!response?.metadata) {
    return `<p class="model-metadata-empty">本轮模型没有返回可展示的模型后端返回原文。</p>`;
  }
  const sanitized = response.sanitized ? ' · 已脱敏' : '';
  return `<p class="model-metadata-status">${escapeHtml(statusLabel(response.status))}${escapeHtml(sanitized)}</p>
    ${reasoningSection(response.metadata)}
    ${usageSection(response.metadata)}
    ${providerSection(response.metadata)}
    ${finishSection(response.metadata)}
    ${toolSection(response.metadata)}
    ${requestSection(response.metadata)}
    <details class="model-metadata-raw" data-model-metadata-raw data-conversation-id="${escapeAttribute(conversationId)}" data-message-id="${escapeAttribute(messageId)}">
      <summary>脱敏后的原始回包</summary>
      <div class="model-metadata-raw-body"><p class="model-metadata-empty">展开后读取。</p></div>
    </details>`;
}

async function loadSummary(details) {
  if (details.dataset.loaded === 'true' || details.dataset.loading === 'true') return;
  const conversationId = details.dataset.conversationId || '';
  const messageId = details.dataset.messageId || '';
  const cacheKey = key(conversationId, messageId);
  const body = details.querySelector('.model-metadata-body');
  if (!body) return;
  details.dataset.loading = 'true';
  body.innerHTML = '<p class="model-metadata-empty">正在读取模型后端返回原文……</p>';
  try {
    const response = summaryCache.get(cacheKey)
      || await requestJson(metadataUrl(conversationId, messageId));
    summaryCache.set(cacheKey, response);
    body.innerHTML = summaryHtml(response, conversationId, messageId);
    details.dataset.loaded = 'true';
    bindRawDetails(body);
  } catch (error) {
    body.innerHTML = `<p class="model-metadata-empty">${escapeHtml(error?.message || '模型后端返回原文读取失败。')}</p>`;
  } finally {
    delete details.dataset.loading;
  }
}

async function loadRaw(details) {
  if (details.dataset.loaded === 'true' || details.dataset.loading === 'true') return;
  const conversationId = details.dataset.conversationId || '';
  const messageId = details.dataset.messageId || '';
  const cacheKey = key(conversationId, messageId);
  const body = details.querySelector('.model-metadata-raw-body');
  if (!body) return;
  details.dataset.loading = 'true';
  body.innerHTML = '<p class="model-metadata-empty">正在读取脱敏回包……</p>';
  try {
    const response = rawCache.get(cacheKey)
      || await requestJson(metadataUrl(conversationId, messageId, true));
    rawCache.set(cacheKey, response);
    const raw = response?.raw_metadata_sanitized;
    body.innerHTML = raw == null
      ? '<p class="model-metadata-empty">本轮没有保存可展示的 raw metadata。</p>'
      : `<pre class="model-metadata-json">${escapeHtml(jsonText(raw))}</pre>`;
    details.dataset.loaded = 'true';
  } catch (error) {
    body.innerHTML = `<p class="model-metadata-empty">${escapeHtml(error?.message || '脱敏原始回包读取失败。')}</p>`;
  } finally {
    delete details.dataset.loading;
  }
}

function bindRawDetails(root) {
  root.querySelectorAll('[data-model-metadata-raw]').forEach((details) => {
    if (details.dataset.bound === 'true') return;
    details.dataset.bound = 'true';
    details.addEventListener('toggle', () => {
      if (details.open) loadRaw(details);
    });
  });
}

export function renderModelMetadataTrace(variant, conversationId) {
  const messageId = String(variant?.id || '');
  const source = String(variant?.generation_source || '');
  if (!messageId || !['chat', 'landing', 'radio', 'lighthouse'].includes(source)) return '';
  return `<details class="model-metadata-trace" data-model-metadata-trace data-conversation-id="${escapeAttribute(conversationId)}" data-message-id="${escapeAttribute(messageId)}">
    <summary>推理文本与模型后端返回原文</summary>
    <div class="model-metadata-body"><p class="model-metadata-empty">展开后读取。</p></div>
  </details>`;
}

export function hydrateModelMetadataTraces(root) {
  ensureStyles();
  root?.querySelectorAll?.('[data-model-metadata-trace]').forEach((details) => {
    if (details.dataset.bound === 'true') return;
    details.dataset.bound = 'true';
    details.addEventListener('toggle', () => {
      if (details.open) loadSummary(details);
    });
  });
}

export async function readModelMetadataStatus(conversationId, messageId) {
  if (!conversationId || !messageId) return { status: 'not_returned', sanitized: true };
  const cacheKey = key(conversationId, messageId);
  const response = summaryCache.get(cacheKey)
    || await requestJson(metadataUrl(conversationId, messageId));
  summaryCache.set(cacheKey, response);
  return {
    status: String(response?.status || 'not_returned'),
    status_label: statusLabel(response?.status),
    sanitized: response?.sanitized !== false,
  };
}
