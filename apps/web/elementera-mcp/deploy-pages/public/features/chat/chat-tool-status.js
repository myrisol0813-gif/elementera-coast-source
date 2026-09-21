const TOOL_LABELS = Object.freeze({
  'memory.search': '搜索记忆',
  'memory.write_candidate': '放入待确认区',
  'dogtalk.read': '读取私人草稿',
  'daily.create_moment': '写碳硅圈',
  'daily.create_diary': '写日记',
  'daily.moment_comment': '评论碳硅圈',
  'daily.moment_like': '调整碳硅圈点赞',
});

let hideTimer = 0;

function node() {
  return document.querySelector('#toolStatus');
}

function toolLabel(value) {
  const key = String(value || '').trim();
  if (!key) return '前端工具';
  return TOOL_LABELS[key] || key.replace(/[._-]+/g, ' ');
}

function show(message, { hideAfter = 0 } = {}) {
  const target = node();
  if (!target) return;
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = 0;
  }
  target.textContent = String(message || '');
  target.dataset.kind = 'loading';
  target.hidden = !message;
  if (hideAfter > 0 && message) {
    hideTimer = setTimeout(() => {
      target.textContent = '';
      target.hidden = true;
      hideTimer = 0;
    }, hideAfter);
  }
}

export function resetToolStatus() {
  show('');
}

export function showLocalToolStatus(data) {
  const ok = data?.ok !== false;
  const label = toolLabel(data?.name);
  show(ok ? `使用工具 · ${label}` : `工具没有成功 · ${label}`, {
    hideAfter: ok ? 1600 : 3200,
  });
}

export function showWebSearchStatus(data) {
  const search = data?.web_search;
  if (!search?.used) return;
  const sources = Math.max(0, Number(search.results_count) || (Array.isArray(search.results) ? search.results.length : 0));
  const requests = Math.max(0, Number(search.requests) || 0);
  const detail = sources > 0 ? `${sources} 个来源` : `${Math.max(1, requests)} 次`;
  show(`搜索了公开网络 · ${detail}`, { hideAfter: 2400 });
}
