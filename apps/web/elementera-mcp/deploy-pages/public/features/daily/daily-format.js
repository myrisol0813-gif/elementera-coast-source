export function dateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function dateLabel(value) {
  const [year = '', month = '--', day = '--'] = String(value || dateKey()).split('-');
  return year ? `${month}月${day}日` : '--月--日';
}

export function timeLabel(value) {
  const date = new Date(Number(value) || Date.now());
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export { shortModelName } from '../../core/model-format.js';

export function lines(value) {
  return String(value || '').split(/\r?\n|[,，]/).map((item) => item.trim()).filter(Boolean);
}

export function authorName(entry = {}) {
  if (entry.displayAuthor) return entry.displayAuthor;
  if (entry.author === 'api') return '前端 API ✦';
  if (entry.author === 'mcp') return 'ChatGPT≋';
  if (entry.author === 'model_partner') return '模型伙伴';
  return '屋主';
}
