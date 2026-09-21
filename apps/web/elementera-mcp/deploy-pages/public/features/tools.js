import { escapeAttribute, escapeHtml } from '../core/dom.js';

const TOOLS_ROUTES = new Set(['basic-settings']);
const RECENT_TURNS_DEFAULT = 8;
const CONTEXT_BUDGET_DEFAULT = 6000;
const CONTEXT_BUDGET_MIN = 1800;

export function createTools({ storage, router, toast, memory }) {
  const choices = Object.freeze({
    outputLength: [['auto', '自然'], ['short', '偏短'], ['long', '长信']],
    creativity: [['stable', '稳定'], ['balanced', '自然'], ['expansive', '发散']],
    streamingEnabled: [[false, '关闭'], [true, '开启']],
    worldbookEnabled: [[false, '关闭'], [true, '开启']],
  });

  function choiceRow(name, title, note = '') {
    const settings = storage.read().runControl;
    const current = ['streamingEnabled', 'worldbookEnabled'].includes(name) ? Boolean(settings[name]) : settings[name];
    const options = choices[name].map(([value, label]) => `<label class="choice-pill"><input type="radio" name="${name}" data-input="tools:setting" value="${escapeAttribute(value)}" ${String(current) === String(value) ? 'checked' : ''}><span>${escapeHtml(label)}</span></label>`).join('');
    return `<div class="control-item"><h3>${escapeHtml(title)}</h3><div class="choice-list">${options}</div>${note ? `<p>${escapeHtml(note)}</p>` : ''}</div>`;
  }

  function numberRow(name, title, min, max, step, note, changeName = '') {
    const value = storage.read().runControl[name];
    const maxAttr = Number.isFinite(max) ? ` max="${max}"` : '';
    const change = changeName ? ` data-change="tools:${escapeAttribute(changeName)}"` : '';
    return `<label class="control-item number-item"><h3>${escapeHtml(title)}</h3><input type="number" name="${name}" data-input="tools:setting"${change} min="${min}"${maxAttr} step="${step}" inputmode="numeric" value="${escapeAttribute(value)}"><p>${escapeHtml(note)}</p></label>`;
  }

  function noteRow(title, note) {
    return `<div class="control-item"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(note)}</p></div>`;
  }

  function group(title, body) {
    return `<section class="feature-group"><h2>${escapeHtml(title)}</h2><div class="feature-card control-card">${body}</div></section>`;
  }

  function basicSettingsView() {
    return {
      title: '基本设置',
      subtitle: '回答长度、流式输出、记忆召回与世界书',
      className: 'run-control',
      body: `<p class="feature-note">最近聊天轮数与上下文 token budget 都保存在本机；海岸提供推荐值，但不设置人为上限。</p>
        ${group('上下文舒服区间', numberRow('recentTurns', '最近聊天轮数', 1, null, 1, '默认 8；常用可试 8 / 12 / 20。没有应用层上限，实际可递入量取决于当前窗口历史、token budget 与模型上下文窗口。', 'recent-turns') + numberRow('contextBudget', '上下文 token budget', CONTEXT_BUDGET_MIN, null, 100, '默认 6000；推荐从 6000 / 12000 / 20000 起调。没有应用层上限；最终仍受模型与 provider 的真实 context window 限制。', 'context-budget'))}
        ${group('输出偏好', choiceRow('outputLength', '回答长度', '“偏短”最多 700 tokens；“自然”和“长信”使用下方上限。') + numberRow('maxOutputTokens', '最大输出 token', 64, 65536, 64, '这是单次回复允许生成的最高值，不代表每次一定用满；自动标题固定为 40。') + choiceRow('creativity', '表达倾向'))}
        ${group('生成方式', choiceRow('streamingEnabled', '流式输出', '开启后普通聊天走真实流式输出；登岛信继续使用稳定 JSON 路径。'))}
        ${group('整理当前对话的纸条与记忆', numberRow('soilBudget', '当前对话纸条最多字数', 300, 4000, 100, '过长时只做普通截断。') + noteRow('当前对话纸条整理频率', '每个完成轮次自动整理一次。') + numberRow('seedCooldownTurns', '线索冷却轮数', 0, 8, 1, '同一条已召回记忆在冷却轮次内不重复递入。') + numberRow('memoryLimit', '本轮记忆召回上限', 0, 12, 1, '还会由舒服区间继续裁纸。'))}
        ${group('词典', choiceRow('worldbookEnabled', '世界书 / 词典') + numberRow('worldbookLimit', '每轮最多词条', 0, 6, 1, '没有命中时不会递空块。'))}
        ${group('应急与查看', '<button class="danger-row" type="button" data-action="tools:clear-soil"><strong>清空当前对话纸条</strong><small>不会删除聊天、种子或记忆。</small></button><button class="feature-row" type="button" data-action="tools:open-pockets"><span><strong>打开待确认区</strong><small>确认待入库内容的去向。</small></span><span>›</span></button><button class="feature-row" type="button" data-action="tools:vector-status"><span><strong>查看向量状态</strong><small>检查 Workers AI 与记忆检索连接。</small></span><span>›</span></button>')}`,
    };
  }

  router.register('basic-settings', basicSettingsView);

  function handleAction(name) {
    if (name === 'basic-settings') return router.open('basic-settings');
    if (name === 'clear-soil') return memory.clearSoil().then((cleared) => {
      if (cleared) toast('当前整理当前对话的纸条已清空。');
    });
    if (name === 'open-pockets') return memory.openPockets();
    if (name === 'vector-status') return memory.showVectorStatus();
  }

  function handleInput(name, target) {
    if (name !== 'setting') return;
    const activeFields = new Set([
      'recentTurns', 'contextBudget', 'outputLength', 'maxOutputTokens', 'creativity',
      'streamingEnabled', 'soilBudget', 'seedCooldownTurns', 'worldbookEnabled',
      'worldbookLimit', 'memoryLimit',
    ]);
    if (!activeFields.has(target.name) || ['recentTurns', 'contextBudget'].includes(target.name)) return;
    const numeric = [
      'maxOutputTokens', 'soilBudget',
      'seedCooldownTurns', 'worldbookLimit', 'memoryLimit',
    ].includes(target.name);
    storage.update((state) => {
      if (['streamingEnabled', 'worldbookEnabled'].includes(target.name)) state.runControl[target.name] = target.value === 'true';
      else state.runControl[target.name] = numeric ? Number(target.value) : target.value;
    });
  }

  function positiveInteger(value, fallback, min = 1) {
    const number = Number(value);
    return Number.isInteger(number) && number >= min ? number : fallback;
  }

  function commitNumber(target, {
    field,
    fallback,
    min,
    label,
    unit = '',
  }) {
    const stored = positiveInteger(storage.read().runControl[field], fallback, min);
    const raw = target.value.trim();
    const value = raw === '' ? fallback : Number(raw);
    if (!Number.isSafeInteger(value) || value < min) {
      target.value = String(stored);
      toast(`${label}需要是大于等于 ${min} 的整数。`);
      return;
    }
    storage.update((state) => { state.runControl[field] = value; });
    target.value = String(value);
    toast(`这台设备的${label}已设为 ${value}${unit}。`);
  }

  function handleChange(name, target) {
    if (name === 'recent-turns') {
      commitNumber(target, {
        field: 'recentTurns', fallback: RECENT_TURNS_DEFAULT, min: 1, label: '最近聊天轮数', unit: ' 轮',
      });
      return;
    }
    if (name === 'context-budget') {
      commitNumber(target, {
        field: 'contextBudget', fallback: CONTEXT_BUDGET_DEFAULT, min: CONTEXT_BUDGET_MIN, label: '上下文 token budget', unit: ' tokens',
      });
    }
  }

  function ownsRoute(route) {
    return TOOLS_ROUTES.has(route?.name || '');
  }

  function ownsEvent(_event, context) {
    if (context.namespace !== 'tools') return false;
    if (context.eventType === 'click') return { preventDefault: true };
    if (context.eventType === 'input' || context.eventType === 'change') return true;
    return false;
  }

  function handleEvent(event, context) {
    if (context.eventType === 'click') return handleAction(context.name, context.target, event);
    if (context.eventType === 'input') return handleInput(context.name, context.target, event);
    if (context.eventType === 'change') return handleChange(context.name, context.target, event);
  }

  function mount() {}
  function refresh() {}
  function destroy() {}

  return Object.freeze({
    id: 'tools',
    priority: 45,
    mountOrder: 45,
    ownsRoute,
    ownsEvent,
    handleEvent,
    mount,
    refresh,
    destroy,
    handleAction,
    handleInput,
    handleChange,
    getSettings: () => storage.read().runControl,
  });
}
