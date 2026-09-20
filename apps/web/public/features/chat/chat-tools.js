import { escapeAttribute, escapeHtml } from '../../core/dom.js';

function safeToolRuns(value) {
  return (Array.isArray(value) ? value : []).filter((run) => run && run.id && run.label).slice(0, 16);
}

function toolRunLine(run) {
  const ok = run.status !== 'error';
  const runtime = String(run.id || '').startsWith('runtime:');
  const label = ok || runtime ? run.label : '某个工具没有正常完成';
  const count = Number(run.count || 0);
  const suffix = run.tool_key === 'memory.search' && count
    ? `：${count} 条`
    : run.tool_key === 'web.search' && count
      ? `：${count} 次`
      : '';
  const items = (Array.isArray(run.items) ? run.items : []).slice(0, 5)
    .map((item) => `<li>${escapeHtml(item.kind ? `${item.kind}｜${item.title}` : item.title)}</li>`)
    .join('');
  const extra = Number(run.extra_count || 0) > 0 ? `<li>另有 ${Number(run.extra_count)} 条</li>` : '';
  const error = !ok && run.error_type ? `<small>错误类型：${escapeHtml(run.error_type)}</small>` : '';
  return `<div class="tool-run is-${ok ? 'success' : 'error'}"><p><span>${ok ? '✓' : '!'}</span>${escapeHtml(label + suffix)}</p>${items || extra ? `<ul>${items}${extra}</ul>` : ''}${error}</div>`;
}

export function renderToolRuns(value, { conversationId = '' } = {}) {
  const runs = safeToolRuns(value);
  if (!runs.length) return '';
  const loggableIds = runs
    .filter((run) => !String(run.id || '').startsWith('runtime:'))
    .map((run) => String(run.id))
    .filter(Boolean);
  const actionLog = loggableIds.length
    ? `<button type="button" data-action="toolroom:open" data-run-ids="${escapeAttribute(loggableIds.join(','))}" data-conversation-id="${escapeAttribute(conversationId)}">查看工具调用记录</button>`
    : '';
  return `<details class="chat-tool">
    <summary><span>本轮工具</span><strong>使用了 ${runs.length} 件工具</strong></summary>
    <div class="tool-body">${runs.map(toolRunLine).join('')}${actionLog}</div>
  </details>`;
}
