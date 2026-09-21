const MAX_ITEMS = 5;

function clean(value, max = 160) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function count(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : 0;
}

function memoryKind(entry) {
  const tag = clean(entry?.tag, 40);
  if (tag) return tag;
  return entry?.entry_type === 'seed' ? '种子' : '记忆';
}

function memorySummary(output) {
  const entries = Array.isArray(output?.entries) ? output.entries : [];
  const items = entries.slice(0, MAX_ITEMS).map((entry) => ({
    title: clean(entry?.title || '未命名记忆', 100),
    kind: memoryKind(entry),
  })).filter((item) => item.title);
  return {
    count: entries.length,
    items,
    extra_count: Math.max(0, entries.length - items.length),
  };
}

function candidateSummary(output) {
  const title = clean(output?.title || output?.life_core || '', 100);
  return title ? { count: 1, items: [{ title, kind: '待确认' }], extra_count: 0 } : { count: 1, items: [], extra_count: 0 };
}

function genericCount(output) {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return 1;
  for (const key of ['count', 'message_count', 'reply_count', 'record_count', 'visitor_count']) {
    const value = count(output[key]);
    if (value) return value;
  }
  return 1;
}

function successLabel(toolKey, displayName) {
  const labels = {
    'daily.create_moment': '写了一条碳硅圈',
    'daily.create_diary': '写了一篇日记',
    'daily.moment_comment': '评论了一条碳硅圈',
    'daily.moment_like': '调整了碳硅圈点赞',
    'dogtalk.read': '读取了人类思考链',
    'memory.search': '搜索了记忆',
    'memory.write_candidate': '放入待确认区',
    'memory.global_excerpt_propose': '全局摘录：新增 1 条待确认修改',
  };
  return labels[toolKey] || clean(displayName || toolKey, 120) || '动用了一件海岸家具';
}

export function buildFurnitureSummary({ id, toolKey, displayName, status = 'success', output = null, error = null } = {}) {
  const runId = clean(id, 180);
  const key = clean(toolKey, 120);
  if (!runId || !key) return null;
  if (status !== 'success') {
    return {
      id: runId,
      tool_key: key,
      label: '某个工具没有正常完成',
      status: 'error',
      count: 1,
      items: [],
      extra_count: 0,
      error_type: clean(error?.type || error?.name || 'tool_execution_failed', 120),
    };
  }

  let detail = { count: genericCount(output), items: [], extra_count: 0 };
  if (key === 'memory.search') detail = memorySummary(output);
  else if (key === 'memory.write_candidate') detail = candidateSummary(output);
  else if (key === 'memory.global_excerpt_propose') detail = { count: 1, items: [{ title: '待确认的全局摘录修改', kind: '全局摘录' }], extra_count: 0 };

  return {
    id: runId,
    tool_key: key,
    label: successLabel(key, displayName),
    status: 'success',
    count: Math.max(1, detail.count || 0),
    items: detail.items,
    extra_count: detail.extra_count,
  };
}

export function sanitizeFurnitureRuns(value) {
  return (Array.isArray(value) ? value : []).slice(0, 16).map((run) => {
    const id = clean(run?.id, 180);
    const toolKey = clean(run?.tool_key, 120);
    const label = clean(run?.label, 120);
    if (!id || !toolKey || !label) return null;
    const items = (Array.isArray(run?.items) ? run.items : []).slice(0, MAX_ITEMS).map((item) => ({
      title: clean(item?.title, 100),
      kind: clean(item?.kind, 40),
    })).filter((item) => item.title);
    const status = run?.status === 'error' ? 'error' : 'success';
    return {
      id,
      tool_key: toolKey,
      label,
      status,
      count: Math.max(1, count(run?.count) || 1),
      items,
      extra_count: Math.max(0, count(run?.extra_count)),
      ...(status === 'error' ? { error_type: clean(run?.error_type || 'tool_execution_failed', 120) } : {}),
    };
  }).filter(Boolean);
}
