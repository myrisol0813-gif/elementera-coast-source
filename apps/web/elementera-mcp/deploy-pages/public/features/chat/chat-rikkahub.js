import { API, requestJson } from '../../core/api.js';

export const RIKKAHUB_PACKAGE_KIND = 'coast-rikkahub-chat-import-v1';

export async function fetchRikkaHubAttachments(conversationId) {
  const data = await requestJson(`${API.rikkahubAttachments}?conversation_id=${encodeURIComponent(conversationId)}`);
  const byMessage = new Map();
  for (const attachment of Array.isArray(data.attachments) ? data.attachments : []) {
    const messageId = String(attachment?.message_id || '').trim();
    if (!messageId) continue;
    const list = byMessage.get(messageId) || [];
    list.push(attachment);
    byMessage.set(messageId, list);
  }
  return byMessage;
}

export async function importRikkaHubPackage(file) {
  if (!file) throw new Error('没有选择导入文件');
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error('这不是可读取的 RikkaHub 聊天导入包');
  }
  if (parsed?.kind !== RIKKAHUB_PACKAGE_KIND || !Array.isArray(parsed.conversations)) {
    throw new Error('导入包格式不匹配；请选择 Coast 净化后的 RikkaHub 聊天包');
  }
  const summary = { conversations: 0, messages: 0, attachments: 0 };
  for (const conversation of parsed.conversations) {
    const data = await requestJson(API.rikkahubImport, {
      method: 'POST',
      body: JSON.stringify(conversation),
    });
    const result = data.import || {};
    summary.conversations += 1;
    summary.messages += Number(result.message_count || 0);
    summary.attachments += Number(result.attachment_count || 0);
  }
  return summary;
}

export function pickRikkaHubPackage() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.hidden = true;
    input.addEventListener('change', () => {
      const file = input.files?.[0] || null;
      input.remove();
      resolve(file);
    }, { once: true });
    document.body.appendChild(input);
    input.click();
  });
}
