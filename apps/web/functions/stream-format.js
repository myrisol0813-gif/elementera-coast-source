export class SseParseError extends Error {
  constructor(message = 'Coast 流式响应格式无效。', options = {}) {
    super(message, options);
    this.name = 'SseParseError';
    this.type = 'invalid_stream_event';
  }
}

export function parseSseEventBlock(block) {
  let event = 'message';
  let id;
  let retry;
  const data = [];
  for (const line of String(block || '').split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue;
    const separator = line.indexOf(':');
    const field = separator < 0 ? line : line.slice(0, separator);
    let value = separator < 0 ? '' : line.slice(separator + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value || 'message';
    else if (field === 'data') data.push(value);
    else if (field === 'id') id = value;
    else if (field === 'retry' && /^\d+$/.test(value)) retry = Number(value);
  }
  if (!data.length) return null;
  const rawData = data.join('\n');
  let parsed;
  if (rawData.trim() === '[DONE]') {
    parsed = '[DONE]';
  } else {
    try {
      parsed = JSON.parse(rawData);
    } catch (cause) {
      throw new SseParseError('Coast 流式响应格式无效。', { cause });
    }
  }
  return {
    event,
    data: parsed,
    ...(id !== undefined ? { id } : {}),
    ...(retry !== undefined ? { retry } : {}),
  };
}

export function encodeSseEvent(event, data, options = {}) {
  const eventName = String(event || 'message').replace(/[\r\n]/g, '') || 'message';
  const lines = [];
  if (options.id !== undefined && options.id !== null) {
    lines.push(`id: ${String(options.id).replace(/[\r\n]/g, '')}`);
  }
  const retry = Number(options.retry);
  if (Number.isInteger(retry) && retry >= 0) lines.push(`retry: ${retry}`);
  lines.push(`event: ${eventName}`);
  const serialized = JSON.stringify(data === undefined ? null : data) ?? 'null';
  for (const line of serialized.split(/\r?\n/)) lines.push(`data: ${line}`);
  return `${lines.join('\n')}\n\n`;
}
