import { requestChatStream } from './chat-stream.js';
import { resetToolStatus, showLocalToolStatus, showWebSearchStatus } from './chat-tool-status.js';

function failureReason(type) {
  if (type === 'context_length_exceeded') return 'provider_context_limit';
  if (type === 'request_body_too_large' || type === 'body_too_large') return 'provider_body_limit';
  if (type === 'provider_timeout') return 'provider_timeout';
  if (type === 'stream_incomplete') return 'stream_incomplete';
  if (type === 'empty_model_reply') return 'empty_model_reply';
  return 'provider_error';
}

function markCrossWindowFailure(slip, error) {
  const section = slip?.cross_window;
  if (!section || section.mode === 'off') return slip;
  const requested = Math.max(0, Number(section.requested_turns ?? section.total_requested_turns) || 0);
  const loaded = Math.max(0, Number(section.loaded_turns ?? section.total_loaded_turns ?? section.attempted_delivered_turns) || 0);
  const chars = Math.max(0, Number(section.loaded_chars ?? section.attempted_chars) || 0);
  const type = String(error?.type || 'stream_error');
  const message = String(error?.message || '模型请求失败。');
  return {
    ...slip,
    comfort: '跨窗口没有静默裁剪；完整递送尝试失败',
    cross_window: {
      ...section,
      status: '递送失败',
      delivered: false,
      requested_turns: requested,
      loaded_turns: loaded,
      attempted_delivered_turns: loaded,
      attempted_chars: chars,
      delivered_to_model_turns: 0,
      delivered_to_model_chars: 0,
      total_delivered_turns: 0,
      trimmed: false,
      trim_reason: '',
      failure_reason: failureReason(type),
      provider_error_type: type,
      provider_error_message: message.slice(0, 500),
      error: `requested_turns=${requested}; loaded_turns=${loaded}; attempted_delivered_turns=${loaded}; attempted_chars=${chars}; ${type}: ${message}`,
    },
  };
}

function annotateCrossWindowError(error, slip, runtime) {
  const failedSlip = markCrossWindowFailure(slip, error);
  const section = failedSlip?.cross_window;
  if (!section || section.mode === 'off') return error;
  runtime.desk?.captureSlip(failedSlip);
  error.details = {
    ...(error.details && typeof error.details === 'object' ? error.details : {}),
    cross_window: section,
  };
  error.message = `这轮跨窗口读取递送失败。前端没有偷偷裁剪，也没有自动缩短后重试。requested=${section.requested_turns}轮，loaded=${section.loaded_turns}轮，attempted=${section.attempted_delivered_turns}轮，attempted_chars=${section.attempted_chars}；${section.provider_error_type || error.type}：${section.provider_error_message || error.message}`;
  return error;
}

function hostOf(value) {
  try {
    return new URL(String(value || '')).hostname.replace(/^www\./i, '').slice(0, 80);
  } catch {
    return '';
  }
}

function runtimeFurniture(deskSlip) {
  if (!deskSlip || typeof deskSlip !== 'object') return [];
  const runs = [];
  const attachments = deskSlip.attachments;
  if (attachments && typeof attachments === 'object') {
    const delivered = Array.isArray(attachments.delivered) ? attachments.delivered : [];
    const images = delivered.filter((item) => item?.mode === 'vision');
    const files = delivered.filter((item) => item?.mode === 'text');
    const missed = Array.isArray(attachments.not_delivered) ? attachments.not_delivered : [];
    if (images.length) runs.push({
      id: 'runtime:attachment-vision', tool_key: 'attachment.vision',
      label: images.length === 1 ? '看了一张图片' : `看了 ${images.length} 张图片`, status: 'success', count: images.length,
      items: images.slice(0, 5).map((item) => ({ title: String(item?.name || item?.id || '图片'), kind: '图片' })),
      extra_count: Math.max(0, images.length - 5),
    });
    if (files.length) runs.push({
      id: 'runtime:attachment-read', tool_key: 'attachment.read',
      label: files.length === 1 ? '读了一份文件' : `读了 ${files.length} 份文件`, status: 'success', count: files.length,
      items: files.slice(0, 5).map((item) => ({ title: String(item?.name || item?.id || '文件'), kind: '文件' })),
      extra_count: Math.max(0, files.length - 5),
    });
    if (missed.length) runs.push({
      id: 'runtime:attachment-not-delivered', tool_key: 'attachment.delivery',
      label: missed.length === 1 ? '有一份附件没有递进去' : `有 ${missed.length} 份附件没有递进去`, status: 'error', count: missed.length,
      items: missed.slice(0, 5).map((item) => ({ title: String(item?.name || item?.id || '附件'), kind: String(item?.reason || '未递送') })),
      extra_count: Math.max(0, missed.length - 5),
      error_type: String(missed[0]?.reason || 'attachment_not_delivered'),
    });
  }
  const search = deskSlip.web_search;
  if (search?.used) {
    const results = Array.isArray(search.results) ? search.results : [];
    runs.push({
      id: 'runtime:web-search', tool_key: 'web.search', label: '搜索了公开网络', status: 'success',
      count: Math.max(1, Number(search.requests) || 1),
      items: results.slice(0, 5).map((item) => {
        const host = hostOf(item?.url);
        return { title: String(item?.title || host || '搜索来源'), kind: host || '来源' };
      }),
      extra_count: Math.max(0, results.length - 5),
    });
  }
  return runs;
}

function mergeFurniture(existing, deskSlip) {
  const merged = [...(Array.isArray(existing) ? existing : []), ...runtimeFurniture(deskSlip)];
  const seen = new Set();
  return merged.filter((run) => {
    const id = String(run?.id || '');
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  }).slice(0, 16);
}

export async function runChatStreamFlow({
  payload,
  signal,
  runtime,
  conversationId,
  turnId,
  appended,
  modelId,
  patchGeneratedVariant,
  patchAssistantStreamingText,
  state,
}) {
  const streamState = state || {
    done: false,
    finishReason: '',
    partialContent: '',
    streamModelId: '',
    streamUsage: null,
    furnitureRuns: [],
    deskSlip: null,
  };

  resetToolStatus();
  let selected;
  try {
    selected = await requestChatStream(payload, {
      signal,
      onEvent(item) {
        if (item.event === 'desk_slip') {
          streamState.deskSlip = item.data && typeof item.data === 'object' ? item.data : null;
          runtime.desk?.captureSlip(streamState.deskSlip);
          return;
        }
        if (item.event === 'meta') {
          streamState.streamModelId = String(item.data?.model || '').slice(0, 180);
          patchGeneratedVariant(conversationId, turnId, appended, {
            model_id: streamState.streamModelId,
            generation_source: 'chat',
          });
          return;
        }
        if (item.event === 'delta') {
          streamState.partialContent += typeof item.data?.content === 'string' ? item.data.content : '';
          patchGeneratedVariant(conversationId, turnId, appended, {
            content: streamState.partialContent,
            model_id: streamState.streamModelId || modelId,
            generation_source: 'chat',
            errorDetail: '',
          }, { render: false });
          patchAssistantStreamingText?.(conversationId, turnId, streamState.partialContent, {
            errorDetail: '',
            loading: true,
          });
          return;
        }
        if (item.event === 'tool') {
          showLocalToolStatus(item.data);
          return;
        }
        if (item.event === 'server_tools') {
          showWebSearchStatus(item.data);
          return;
        }
        if (item.event === 'furniture_runs') {
          streamState.furnitureRuns = Array.isArray(item.data) ? item.data : [];
          return;
        }
        if (item.event === 'usage') {
          streamState.streamUsage = item.data;
          patchGeneratedVariant(conversationId, turnId, appended, { usage: streamState.streamUsage });
          return;
        }
        if (item.event === 'done') {
          streamState.finishReason = String(item.data?.finish_reason || '');
          streamState.done = true;
          return;
        }
        if (item.event === 'error') {
          const error = new Error(item.data?.message || '流式生成失败。');
          error.type = item.data?.type || 'stream_error';
          error.details = item.data?.details && typeof item.data.details === 'object' ? item.data.details : null;
          throw error;
        }
      },
    });
  } catch (error) {
    if (error?.name !== 'AbortError') throw annotateCrossWindowError(error, streamState.deskSlip, runtime);
    throw error;
  }

  const history = runtime.recallHistory.get(conversationId) || [];
  runtime.recallHistory.set(conversationId, [...history, selected].slice(-8));
  if (!streamState.done) {
    const error = new Error('流式响应在完成事件前中断。');
    error.type = 'stream_incomplete';
    throw annotateCrossWindowError(error, streamState.deskSlip, runtime);
  }
  if (!streamState.partialContent.trim()) {
    const error = new Error('模型完成了这次请求，但没有返回文字。');
    error.type = 'empty_model_reply';
    throw annotateCrossWindowError(error, streamState.deskSlip, runtime);
  }

  const furnitureRuns = mergeFurniture(streamState.furnitureRuns, streamState.deskSlip);
  return {
    patch: {
      content: streamState.partialContent,
      errorDetail: '',
      model_id: streamState.streamModelId || modelId,
      ...(streamState.streamUsage ? { usage: streamState.streamUsage } : {}),
      finish_reason: streamState.finishReason,
      generation_source: 'chat',
      ...(furnitureRuns.length ? { furniture_runs: furnitureRuns } : {}),
      ...(streamState.deskSlip ? { desk_slip: streamState.deskSlip } : {}),
    },
    state: { ...streamState, furnitureRuns },
  };
}
