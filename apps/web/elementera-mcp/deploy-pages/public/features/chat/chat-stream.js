import { API } from '../../core/api.js';
import { parseSseEventBlock } from '../../core/stream-format.js';

export { parseSseEventBlock as parseSseBlock } from '../../core/stream-format.js';


export function createCoastSseParser(onEvent) {
  let buffer = '';
  function drain() {
    while (true) {
      const match = buffer.match(/\r?\n\r?\n/);
      if (!match || match.index == null) return;
      const block = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      const parsed = parseSseEventBlock(block);
      if (parsed) onEvent(parsed);
    }
  }
  return Object.freeze({
    push(chunk) {
      buffer += String(chunk || '');
      drain();
    },
    finish() {
      drain();
      buffer = '';
    },
  });
}

export async function requestChatStream(payload, { signal, onEvent }) {
  const response = await fetch(API.chat, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
    headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, stream: true }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const upstream = data?.error;
    const error = new Error(typeof upstream === 'string' ? upstream : upstream?.message || `请求失败（${response.status}）`);
    error.type = upstream?.type || 'request_failed';
    throw error;
  }
  if (!response.body) {
    const error = new Error('浏览器没有收到可读取的流。');
    error.type = 'stream_unavailable';
    throw error;
  }
  let selected = [];
  try {
    const header = JSON.parse(response.headers.get('X-Coast-Memory-Selected') || '[]');
    if (Array.isArray(header)) selected = header.map(String);
  } catch {
    selected = [];
  }
  const parser = createCoastSseParser(onEvent);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
    }
    parser.push(decoder.decode());
    parser.finish();
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  return selected;
}
