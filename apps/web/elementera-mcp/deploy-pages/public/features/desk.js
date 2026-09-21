import { API, requestJson } from '../core/api.js';
import { escapeAttribute, escapeHtml, q } from '../core/dom.js';
import { activeBranch, normalizeState } from './chat-state.js';
import { readModelMetadataStatus } from './chat/chat-model-metadata.js';

const DESK_ROUTES = new Set(['desk-slip', 'desk-worldbook', 'desk-worldbook-editor']);
const HANDLER_NAMES = Object.freeze({ click: 'handleAction', submit: 'handleSubmit' });
const SCOPE_LABELS = Object.freeze({
  owner: '屋主', visitor: '访客', both: '双方', mailbox: '信箱', lighthouse: 'MCP 对话区', radio: '共通聊天室', official_mcp: '官端 MCP', daily: '小组件',
});
const ENTRY_TYPE_LABELS = Object.freeze({ memory: '记忆', seed: '种子' });

function deskDetails(body) { return body ? `<details class="desk-slip-detail"><summary>查看详情</summary>${body}</details>` : ''; }
function deskRow(title, status, detail = '') { return `<article><strong>${escapeHtml(title)}</strong><span>${escapeHtml(status || '未递给')}</span>${deskDetails(detail)}</article>`; }
function deskText(value, label = '') {
  const text = String(value ?? '');
  if (!text) return '';
  return `${label ? `<p><b>${escapeHtml(label)}</b></p>` : ''}<pre class="desk-slip-text">${escapeHtml(text)}</pre>`;
}
function paragraph(label, value) { const text = String(value ?? ''); return text ? `<p><b>${escapeHtml(label)}</b>${escapeHtml(text)}</p>` : ''; }
function sourceNote(value) { const text = String(value || '').trim(); return text ? `<p class="desk-slip-note">${escapeHtml(text)}</p>` : ''; }
function emptyNote() { return '<p class="desk-slip-note">本轮未递入</p>'; }
function scopeLabel(value) { return SCOPE_LABELS[String(value || '')] || String(value || ''); }
function recentDeskDetails(messages) {
  const list = Array.isArray(messages) ? messages : [];
  if (!list.length) return emptyNote();
  return `<div class="desk-message-list">${list.map((message) => `<section><b>${message.role === 'assistant' ? '另一位屋主回复' : '用户消息'}</b>${deskText(message.content)}</section>`).join('')}</div><p class="desk-slip-note">当前消息已单独列在上方，不在这里重复。</p>`;
}
function memoryDeskDetails(items) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return emptyNote();
  return `<div class="desk-record-list">${list.map((item) => `<section class="desk-record"><header><strong>${escapeHtml(item.title || '未命名')}</strong><small>${escapeHtml(ENTRY_TYPE_LABELS[item.entry_type] || '记忆')} · ${escapeHtml(item.tag || '无标签')} · ${escapeHtml(item.source_window || '未知窗口')} · 分数 ${escapeHtml(String(item.score ?? 0))}</small></header>${paragraph('来源模型：', item.source_model)}${paragraph('来源时间：', item.source_time || item.source_date)}${paragraph('命中原因：', item.reason)}${deskText(item.life_core, '核心')}${deskText(item.usage_hint, '使用时机')}${deskText(item.avoid_hint, '勿误用')}${deskText(item.content, '正文')}${deskText(item.delivered_text, '实际递给模型')}</section>`).join('')}</div>`;
}
function worldbookDeskDetails(entries) {
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) return emptyNote();
  return `<div class="desk-record-list">${list.map((item) => `<section class="desk-record"><header><strong>${escapeHtml(item.title || '未命名')}</strong><small>${escapeHtml(scopeLabel(item.scope) || '屋主')} · ${item.delivered ? '已递给' : '命中但未递给'}</small></header>${paragraph('命中方式：', item.matched_by)}${item.matched_keywords?.length ? paragraph('命中关键词：', item.matched_keywords.join('、')) : ''}${deskText(item.content, '正文')}${item.delivered_text ? deskText(item.delivered_text, '实际递给模型') : ''}</section>`).join('')}</div>`;
}
function crossWindowDeskDetails(section = {}) {
  const sources = Array.isArray(section.sources) ? section.sources : [];
  const requested = Math.max(0, Number(section.requested_turns ?? section.total_requested_turns) || 0);
  const loaded = Math.max(0, Number(section.loaded_turns ?? section.total_loaded_turns) || 0);
  const delivered = Math.max(0, Number(section.delivered_to_model_turns ?? section.total_delivered_turns) || 0);
  const attempted = Math.max(0, Number(section.attempted_delivered_turns) || 0);
  const requestedMessages = Math.max(0, Number(section.requested_messages) || 0);
  const loadedMessages = Math.max(0, Number(section.loaded_messages) || 0);
  const deliveredMessages = Math.max(0, Number(section.delivered_to_model_messages) || 0);
  const loadedChars = Math.max(0, Number(section.loaded_chars) || 0);
  const attemptedChars = Math.max(0, Number(section.attempted_chars) || 0);
  const estimatedTokens = Math.max(0, Number(section.attempted_estimated_tokens) || 0);
  const sourceList = sources.length
    ? `<div class="desk-record-list">${sources.map((source) => {
      const kind = source.source === 'rikkahub' ? 'RikkaHub' : (source.room_type === 'radio' || source.room_type === 'lighthouse') ? '' : '主聊天';
      const title = source.source === 'rikkahub' ? `【Rikka】${source.title || '未命名窗口'}` : source.title || '未命名窗口';
      const sourceRequested = Math.max(0, Number(source.requested_turns) || 0);
      const sourceLoaded = Math.max(0, Number(source.loaded_turns) || 0);
      const sourceDelivered = Math.max(0, Number(source.delivered_to_model_turns) || 0);
      const messageStatus = Number(source.loaded_messages || 0)
        ? ` · 消息 ${Number(source.loaded_messages || 0)} 条`
        : '';
      return `<section class="desk-record"><header><strong>${escapeHtml(kind ? `${kind}｜${title}` : title)}</strong><small>请求 ${sourceRequested} 轮 · 读取 ${sourceLoaded} 轮 · 递给 ${sourceDelivered} 轮${messageStatus}</small></header>${paragraph('更新：', source.updated_at)}</section>`;
    }).join('')}</div>`
    : section.mode === 'model_decides' && section.status !== '递送失败' ? '<p class="desk-slip-note">实际读取：暂无</p>' : emptyNote();
  const messageGroups = Array.isArray(section.messages) ? section.messages : [];
  const messageDetail = messageGroups.length
    ? `<div class="desk-message-list">${messageGroups.map((group) => `<section><b>${escapeHtml(sources.find((source) => source.conversation_id === group.conversation_id)?.title || '来源窗口')}</b>${(Array.isArray(group.messages) ? group.messages : []).map((message) => {
      const role = message.role === 'assistant' ? '另一位屋主' : '用户';
      const id = message.message_id ? ` · ${message.message_id}` : '';
      return deskText(message.content, `${role}${id}`);
    }).join('')}</section>`).join('')}</div>`
    : '';
  const totals = section.mode === 'off'
    ? ''
    : `<p><b>本轮总计：</b>请求 ${requested} 轮 · 读取 ${loaded} 轮 · 递给 ${delivered} 轮${requestedMessages || loadedMessages ? ` · 消息 请求 ${requestedMessages} / 读取 ${loadedMessages} / 递给 ${deliveredMessages}` : ''}${attempted ? ` · 尝试递送 ${attempted} 轮` : ''}</p>`;
  return [
    sourceNote(section.description),
    totals,
    loadedChars ? paragraph('已读取字符：', loadedChars) : '',
    attemptedChars ? paragraph('尝试递送字符：', attemptedChars) : '',
    estimatedTokens ? paragraph('估算请求 tokens：', estimatedTokens) : '',
    sourceList,
    section.trimmed ? paragraph('裁剪：', section.trim_reason || '发生了显式裁剪') : '',
    section.failure_reason ? paragraph('失败原因：', section.failure_reason) : '',
    section.provider_error_type ? paragraph('Provider 错误类型：', section.provider_error_type) : '',
    section.provider_error_message ? paragraph('Provider 错误摘要：', section.provider_error_message) : '',
    section.error ? paragraph('错误：', section.error) : '',
    messageDetail,
  ].join('');
}

function webSearchDeskDetails(section = {}) {
  const results = Array.isArray(section.results) ? section.results : [];
  const resultList = results.length
    ? `<div class="desk-record-list">${results.map((item) => {
      const title = escapeHtml(item.title || item.url || '搜索结果');
      const url = String(item.url || '');
      const safeUrl = /^https?:\/\//i.test(url) ? escapeAttribute(url) : '';
      const content = String(item.content || '').trim();
      return `<section class="desk-record"><header><strong>${safeUrl ? `<a href="${safeUrl}" target="_blank" rel="noopener">${title}</a>` : title}</strong><small>${escapeHtml(url)}</small></header>${content ? deskText(content, '摘要') : ''}</section>`;
    }).join('')}</div>`
    : emptyNote();
  return [
    paragraph('本轮触发语句：', section.requested_query),
    section.provider_query_returned === false
      ? '<p class="desk-slip-note">OpenRouter server tool 未向海岸回传模型内部生成的原始搜索 query；这里如实显示当前用户请求，不伪造 query。</p>'
      : '',
    paragraph('搜索次数：', Math.max(0, Number(section.requests) || 0)),
    paragraph('来源结果：', Math.max(0, Number(section.results_count) || 0)),
    section.reason ? paragraph('不可用原因：', section.reason) : '',
    resultList,
  ].join('');
}

function attachmentDeskDetails(section = {}) {
  const delivered = Array.isArray(section.delivered) ? section.delivered : [];
  const notDelivered = Array.isArray(section.not_delivered) ? section.not_delivered : [];
  const rows = [
    ...delivered.map((item) => `<section class="desk-record"><header><strong>${escapeHtml(item.name || item.id || '附件')}</strong><small>${item.type === 'image' ? '图片' : '文件'} · 已递给模型 · ${escapeHtml(item.mode === 'vision' ? '识图' : '文本读取')}</small></header></section>`),
    ...notDelivered.map((item) => `<section class="desk-record"><header><strong>${escapeHtml(item.name || item.id || '附件')}</strong><small>未递给模型</small></header>${paragraph('原因：', item.reason || 'unknown')}</section>`),
  ];
  return [
    `<p><b>本轮上传：</b>${Math.max(0, Number(section.uploaded) || 0)} 个 · <b>递给模型：</b>${Math.max(0, Number(section.delivered_to_model) || 0)} 个</p>`,
    `<p><b>识图：</b>${section.vision?.supported ? '当前模型支持' : '当前模型未确认支持'} · 已递图片 ${Math.max(0, Number(section.vision?.images_delivered) || 0)} 张</p>`,
    rows.length ? `<div class="desk-record-list">${rows.join('')}</div>` : emptyNote(),
  ].join('');
}

function toolResultDetails(items) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return '';
  return `<div class="desk-record-list">${list.map((item) => `<section class="desk-record"><header><strong>${escapeHtml(item.name || '工具')}</strong><small>${item.delivered ? '结果已递给模型' : '未递给'}</small></header>${deskText(item.content, '工具结果 JSON')}</section>`).join('')}</div>`;
}
function toolLabel(item) {
  if (typeof item === 'string') return escapeHtml(item);
  const chinese = String(item?.display_name || item?.name || item?.tool_key || '').trim();
  const english = String(item?.name || item?.tool_key || '').trim();
  if (!chinese) return '';
  return escapeHtml(english && english !== chinese ? `${chinese}｜${english}` : chinese);
}
function toolsLine(label, items) {
  const list = (Array.isArray(items) ? items : []).map(toolLabel).filter(Boolean);
  return list.length ? `<p><b>${escapeHtml(label)}：</b>${list.join('、')}</p>` : '';
}
function currentAssistant(history) {
  const turns = normalizeState(history).turns;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const assistant = activeBranch(turns[index]).assistant;
    if (assistant) return assistant;
  }
  return null;
}
function currentDeskSlip(history) {
  return currentAssistant(history)?.desk_slip || null;
}
function emptyModelEcho() {
  return { status_label: '未返回', sanitized: false, message_id: '', conversation_id: '' };
}
function modelEchoRow(value = {}) {
  const status = [value.status_label || '未返回', value.sanitized ? '已脱敏' : ''].filter(Boolean).join(' · ');
  return `<article class="desk-model-echo"><strong>模型后端返回原文</strong><span>${escapeHtml(status)}</span><p class="desk-slip-note">这是本轮模型 API 返回的推理痕迹、用量、模型、供应商、完成状态、工具调用和脱敏元数据。它只给屋主查看，不会递给模型，也不会进入记忆或种子。详细内容请回到对应回复下方查看。</p></article>`;
}

export function createDesk({ router, toast }) {
  const state = { slip: null, worldbook: [], modelEcho: emptyModelEcho() };
  let modelEchoRevision = 0;
  function renderStatus() {
    const root = q('#deskStatus');
    if (!root) return;
    if (!state.slip) { root.hidden = true; root.textContent = ''; return; }
    root.innerHTML = `<button type="button" data-action="desk:open"><span>${escapeHtml(state.slip.summary || '本轮递给模型')}</span><small>${escapeHtml(state.slip.comfort || '')}</small><b>›</b></button>`;
    root.hidden = false;
  }
  function deskView() {
    const slip = state.slip || {};
    const current = slip.current_message || { label: '当前消息', status: '未递给', content: '' };
    const recent = slip.recent_context || { label: '最近上下文', status: '未递给', status_detail: '0 轮', messages: [] };
    const custom = slip.custom_instructions || { label: '核心自定义', status: '未递给', length: 0, content: '' };
    const globalExcerpt = slip.global_excerpt || { label: '全局摘录', status: '未设置', injection: 'empty', estimated_tokens: 0, length: 0, content: '' };
    const contextBudget = slip.context_budget || { label: '上下文预算', estimated_tokens: 0, comfort_ceiling: 0, trimmed: false, trimmed_count: 0, sources_preserved: [], global_excerpt: 'empty' };
    const soil = slip.thinking_soil || { label: '整理当前对话的纸条', status: '未递给', context: '', current_text: '', hand_seeds: [], pocket_candidates_count: 0 };
    const memory = slip.related_memory || { label: '相关记忆', status: '未命中', items: [] };
    const worldbook = slip.worldbook || { label: '世界书', status: '未命中', entries: [] };
    const dogtalk = slip.dogtalk || { label: '人类思考链', status: '未递给', context: '' };
    const crossWindow = slip.cross_window || { label: '跨窗口读取', status: '未递给', mode: 'off', sources: [], messages: [] };
    const workbench = slip.workbench || { label: '工作台 / 工具回执', status: '未递给', model_visible_tools: [], backend_tools: [], core_tools: [], side_tools: [], furniture: [], prompt_delivered: false, prompt: '', tool_results: [], labels: {} };
    const attachments = slip.attachments || null;
    const webSearch = slip.web_search && typeof slip.web_search === 'object' ? slip.web_search : null;
    const external = slip.external_tide || { label: '外部入口消息', status: '未递给', content: '本轮没有递入外部材料。' };
    const labels = workbench.labels || {};
    const customStatus = custom.delivered ? `${custom.status} · 全文 ${Number(custom.length || 0)} 字` : custom.status;
    const recentStatus = recent.status_detail ? `${recent.status} · ${recent.status_detail}` : recent.status;
    const budgetStatus = `${Number(contextBudget.estimated_tokens || 0)} / ${Number(contextBudget.comfort_ceiling || 0)} tok · ${contextBudget.trimmed ? `已裁 ${Number(contextBudget.trimmed_count || 0)}` : '未裁剪'}`;
    const excerptStatus = globalExcerpt.length ? `${globalExcerpt.status} · ${Number(globalExcerpt.estimated_tokens || 0)} tok` : globalExcerpt.status;
    const memoryStatus = memory.confirmation_status ? `${memory.status} · ${memory.confirmation_status} ${Number(memory.count || 0)} 条` : memory.status;
    const worldbookStatus = worldbook.matched_count ? `${worldbook.status} · 命中 ${Number(worldbook.matched_count || 0)} 条` : worldbook.status;
    const crossWindowRequested = Math.max(0, Number(crossWindow.requested_turns ?? crossWindow.total_requested_turns) || 0);
    const crossWindowLoaded = Math.max(0, Number(crossWindow.loaded_turns ?? crossWindow.total_loaded_turns) || 0);
    const crossWindowDelivered = Math.max(0, Number(crossWindow.delivered_to_model_turns ?? crossWindow.total_delivered_turns) || 0);
    const crossWindowAttempted = Math.max(0, Number(crossWindow.attempted_delivered_turns) || 0);
    const crossWindowStatus = crossWindow.mode === 'off'
      ? crossWindow.status
      : `${crossWindow.status} · 请求 ${crossWindowRequested}轮 · 读取 ${crossWindowLoaded}轮 · ${crossWindow.status === '递送失败' ? `尝试 ${crossWindowAttempted}轮` : `递给 ${crossWindowDelivered}轮`}`;
    const soilDetail = [
      sourceNote(soil.description),
      deskText(soil.current_text, '当前整理'),
      soil.hand_seeds?.length ? `<div class="desk-mini-list"><b>当前活跃线索</b>${soil.hand_seeds.map((item) => `<p>${escapeHtml(item)}</p>`).join('')}</div>` : '',
      `<p><b>待确认候选：</b>${escapeHtml(soil.pocket_candidates_status || (Number(soil.pocket_candidates_count || 0) ? '待确认' : '未递入'))} · ${Number(soil.pocket_candidates_count || 0)} 条 · 未递给正文</p>`,
      deskText(soil.context, '实际递给模型'),
      !soil.context && !soil.current_text && !soil.hand_seeds?.length ? emptyNote() : '',
    ].join('');
    const workbenchDetail = [
      sourceNote(workbench.description),
      toolsLine(labels.core || '常用工具', workbench.core_tools),
      toolsLine(labels.side || '小工具', workbench.side_tools),
      toolsLine(labels.model_visible_tools || '模型可见工具', workbench.model_visible_tools),
      toolsLine(labels.backend_tools || '后端可用工具', workbench.backend_tools),
      `<p><b>工作台提示：</b>${workbench.prompt_delivered ? '已递给' : '未递给'}</p>`,
      workbench.prompt ? deskText(workbench.prompt, '工作台提示') : '',
      workbench.furniture?.length ? `<p><b>本轮动用：</b>${escapeHtml(workbench.furniture.join('、'))}</p>` : '',
      toolResultDetails(workbench.tool_results),
      !workbench.prompt_delivered && !workbench.furniture?.length && !workbench.tool_results?.length ? emptyNote() : '',
    ].join('');
    return {
      title: '本轮上下文预览', subtitle: slip.comfort || '只看这一轮实际递给模型的内容', className: 'desk-slip-panel',
      body: `<section class="desk-slip-list">
        ${deskRow(current.label || '当前消息', current.status, [sourceNote(current.description), deskText(current.content), current.content ? '' : emptyNote()].join(''))}
        ${deskRow(recent.label || '最近上下文', recentStatus, [sourceNote(recent.description), recentDeskDetails(recent.messages)].join(''))}
        ${deskRow(contextBudget.label || '上下文预算', budgetStatus, [
          paragraph('本轮估算 token：', contextBudget.estimated_tokens),
          paragraph('comfort ceiling：', contextBudget.comfort_ceiling),
          paragraph('裁剪：', contextBudget.trimmed ? `是 · ${Number(contextBudget.trimmed_count || 0)} 处` : '否'),
          paragraph('保留来源：', Array.isArray(contextBudget.sources_preserved) ? contextBudget.sources_preserved.join('、') : ''),
          paragraph('全局摘录注入：', contextBudget.global_excerpt || globalExcerpt.injection || 'empty'),
          contextBudget.exceeds_comfort_ceiling ? '<p class="desk-slip-note">当前组包超过 comfort ceiling；海岸没有静默截断全局摘录。</p>' : '',
        ].join(''))}
        ${deskRow(custom.label || '核心自定义', customStatus, [sourceNote(custom.description), custom.content ? deskText(custom.content) : emptyNote()].join(''))}
        ${deskRow(globalExcerpt.label || '全局摘录', excerptStatus, [sourceNote(globalExcerpt.description), globalExcerpt.content ? deskText(globalExcerpt.content) : emptyNote()].join(''))}
        ${deskRow(soil.label || '整理当前对话的纸条', soil.status, soilDetail)}
        ${deskRow(memory.label || '相关记忆', memoryStatus, [sourceNote(memory.description), memoryDeskDetails(memory.items)].join(''))}
        ${deskRow(worldbook.label || '世界书', worldbookStatus, [sourceNote(worldbook.description), worldbookDeskDetails(worldbook.entries)].join(''))}
        ${deskRow(dogtalk.label || '人类思考链', dogtalk.status, [sourceNote(dogtalk.description), dogtalk.delivered ? deskText(dogtalk.context) : emptyNote()].join(''))}
        ${deskRow(crossWindow.label || '跨窗口读取', crossWindowStatus, crossWindowDeskDetails(crossWindow))}
        ${attachments ? deskRow('本轮附件', `上传 ${Number(attachments.uploaded || 0)} · 递给 ${Number(attachments.delivered_to_model || 0)}`, attachmentDeskDetails(attachments)) : ''}
        ${webSearch ? deskRow('本轮搜索', webSearch.available === false
          ? '不可用'
          : webSearch.used ? `已搜索 · ${Number(webSearch.requests || 0)} 次 · ${Number(webSearch.results_count || 0)} 来源` : '可用 · 本轮未调用', webSearchDeskDetails(webSearch)) : ''}
        ${deskRow(workbench.label || '工作台 / 工具回执', workbench.status, workbenchDetail)}
        ${deskRow(external.label || '外部入口消息', external.status, [sourceNote(external.description), deskText(external.content || '本轮没有递入外部材料。')].join(''))}
        ${modelEchoRow(state.modelEcho)}
      </section>`,
    };
  }

  async function loadWorldbook() {
    const data = await requestJson(API.worldbook);
    state.worldbook = data.entries || [];
    return state.worldbook;
  }
  async function worldbookView() {
    await loadWorldbook();
    const entries = state.worldbook.length
      ? state.worldbook.map((entry) => `<article class="worldbook-entry ${entry.enabled ? '' : 'is-disabled'}"><button type="button" data-action="desk:edit-worldbook" data-id="${escapeAttribute(entry.id)}"><span><strong>${escapeHtml(entry.title)}</strong><small>${escapeHtml(entry.keywords.join(' · ') || '常驻词条')}</small></span><i>${escapeHtml(scopeLabel(entry.scope))}</i></button><p>${escapeHtml(entry.content)}</p></article>`).join('')
      : '<div class="feature-card"><p class="feature-empty">这里还没有词条。以后聊到某个海岸名词时，再整理进来。</p></div>';
    return {
      title: '词典', subtitle: '专有名词按关键词出现，不和记忆库混放', className: 'worldbook-panel',
      headerAction: '<button class="feature-head-action" type="button" data-action="desk:new-worldbook">＋ 词条</button>',
      body: `<section class="worldbook-test"><label>试一句<input id="worldbookTestInput" placeholder="聊到哪个海岸名词，就试哪个"></label><button type="button" data-action="desk:test-worldbook">测试命中</button><div id="worldbookTestResult"></div></section><div class="worldbook-list">${entries}</div>`,
    };
  }
  function worldbookEditor({ id } = {}) {
    const entry = state.worldbook.find((item) => item.id === id) || {};
    const scopes = ['owner', 'visitor', 'both', 'mailbox', 'lighthouse', 'radio', 'official_mcp', 'daily'];
    return {
      title: entry.id ? '编辑词典词条' : '新增词典词条', subtitle: '内容只会在关键词命中时成为一张干净纸条', className: 'worldbook-editor-panel',
      body: `<form class="form-stack" data-submit="desk:save-worldbook" data-id="${escapeAttribute(entry.id || '')}">
        <label>标题<input name="title" required maxlength="160" value="${escapeAttribute(entry.title || '')}"></label>
        <label>内容<textarea name="content" rows="7" required maxlength="12000">${escapeHtml(entry.content || '')}</textarea></label>
        <label>关键词（每行一个）<textarea name="keywords" rows="5">${escapeHtml((entry.keywords || []).join('\n'))}</textarea></label>
        <label>房间范围<select name="scope">${scopes.map((scope) => `<option value="${scope}" ${entry.scope === scope ? 'selected' : ''}>${escapeHtml(scopeLabel(scope))}</option>`).join('')}</select></label>
        <label>匹配顺序<input type="number" name="priority" min="-1000" max="1000" value="${Number(entry.priority || 0)}"></label>
        <label class="desk-check"><input type="checkbox" name="enabled" ${entry.enabled !== false ? 'checked' : ''}><span>启用</span></label>
        <label class="desk-check"><input type="checkbox" name="use_regex" ${entry.use_regex ? 'checked' : ''}><span>关键词按正则处理</span></label>
        <label class="desk-check"><input type="checkbox" name="visitor_safe" ${entry.visitor_safe ? 'checked' : ''}><span>可安全用于访客房间</span></label>
        <button class="primary-wide" type="submit">保存词条</button>${entry.id ? '<button class="danger-row desk-delete-word" type="button" data-action="desk:delete-worldbook">停用词条</button>' : ''}
      </form>`,
    };
  }

  router.register('desk-slip', deskView);
  router.register('desk-worldbook', worldbookView);
  router.register('desk-worldbook-editor', worldbookEditor);

  async function saveWorldbook(form) {
    const data = new FormData(form);
    const id = form.dataset.id;
    await requestJson(id ? `${API.worldbook}/${encodeURIComponent(id)}` : API.worldbook, {
      method: id ? 'PATCH' : 'POST',
      body: JSON.stringify({
        title: data.get('title'), content: data.get('content'),
        keywords: String(data.get('keywords') || '').split(/\n+/).map((item) => item.trim()).filter(Boolean),
        scope: data.get('scope'), priority: Number(data.get('priority') || 0), enabled: data.get('enabled') === 'on',
        use_regex: data.get('use_regex') === 'on', visitor_safe: data.get('visitor_safe') === 'on',
      }),
    });
    toast('词典已经更新。');
    await loadWorldbook();
    return router.open('desk-worldbook', {}, { replace: true });
  }
  async function handleAction(name, target) {
    if (name === 'open') return router.open('desk-slip');
    if (name === 'worldbook') return router.open('desk-worldbook');
    if (name === 'new-worldbook') return router.open('desk-worldbook-editor');
    if (name === 'edit-worldbook') return router.open('desk-worldbook-editor', { id: target.dataset.id });
    if (name === 'test-worldbook') {
      const input = q('#worldbookTestInput')?.value || '';
      const data = await requestJson(API.worldbookTest, { method: 'POST', body: JSON.stringify({ input, surface: 'main_chat' }) });
      const result = q('#worldbookTestResult');
      if (result) result.innerHTML = data.matches.length ? data.matches.map((entry) => `<span>${escapeHtml(entry.title)}</span>`).join('') : '<small>没有命中词条。</small>';
      return;
    }
    if (name === 'delete-worldbook') {
      const id = target.closest('form')?.dataset.id;
      if (!id) return;
      await requestJson(`${API.worldbook}/${encodeURIComponent(id)}`, { method: 'DELETE' });
      toast('词条已经停用。');
      await loadWorldbook();
      return router.open('desk-worldbook', {}, { replace: true });
    }
  }
  function handleSubmit(name, form) { if (name === 'save-worldbook') return saveWorldbook(form); }
  function captureSlip(slip) { state.slip = slip && typeof slip === 'object' ? slip : null; renderStatus(); }
  async function captureModelEcho(history = {}, conversationId = '') {
    const revision = ++modelEchoRevision;
    const assistant = currentAssistant(history);
    const source = String(assistant?.generation_source || '');
    if (!conversationId || !assistant?.id || !['chat', 'landing'].includes(source)) {
      state.modelEcho = emptyModelEcho();
      return state.modelEcho;
    }
    state.modelEcho = { ...emptyModelEcho(), status_label: '读取中', message_id: assistant.id, conversation_id: conversationId };
    try {
      const echo = await readModelMetadataStatus(conversationId, assistant.id);
      if (revision !== modelEchoRevision) return state.modelEcho;
      state.modelEcho = {
        ...echo,
        message_id: assistant.id,
        conversation_id: conversationId,
      };
    } catch {
      if (revision !== modelEchoRevision) return state.modelEcho;
      state.modelEcho = {
        ...emptyModelEcho(),
        status_label: '读取失败',
        message_id: assistant.id,
        conversation_id: conversationId,
      };
    }
    return state.modelEcho;
  }
  function onConversationChanged(history = {}, conversationId = '') {
    state.slip = currentDeskSlip(history);
    state.modelEcho = emptyModelEcho();
    renderStatus();
    captureModelEcho(history, conversationId).catch(() => undefined);
  }
  function handlerFor(context) {
    const handlerName = HANDLER_NAMES[context.eventType];
    if (handlerName === 'handleAction') return handleAction;
    if (handlerName === 'handleSubmit') return handleSubmit;
    return null;
  }
  function ownsEvent(_event, context) {
    if (context.namespace !== 'desk' || !handlerFor(context)) return false;
    return { preventDefault: context.eventType === 'click' || context.eventType === 'submit' };
  }
  function handleEvent(event, context) { return handlerFor(context)?.(context.name, context.target, event); }
  function ownsRoute(route) { return DESK_ROUTES.has(route?.name || ''); }
  function mount() { renderStatus(); }
  function refresh() { renderStatus(); }
  function destroy() { modelEchoRevision += 1; state.slip = null; state.modelEcho = emptyModelEcho(); renderStatus(); }

  return Object.freeze({ id: 'desk', priority: 60, mountOrder: 50, ownsRoute, ownsEvent, handleEvent, mount, refresh, destroy, handleAction, handleSubmit, captureSlip, captureModelEcho, onConversationChanged, renderStatus, open: () => router.open('desk-slip') });
}
