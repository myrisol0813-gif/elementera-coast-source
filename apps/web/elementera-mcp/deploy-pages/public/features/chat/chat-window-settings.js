import { escapeAttribute, escapeHtml, q } from '../../core/dom.js';
import { normalizeContextSettings } from '../chat-state.js';

const WEB_REALITY_FIELDS = Object.freeze([
  ['date', '日期', '今天是哪一天'],
  ['time', '时间', '当前本地时间'],
  ['calendar', '未来 7 天日历', '读取未来 7 天的重要日期'],
]);



const REPLY_BUDGET_FIELDS=Object.freeze([
  ['reply_sequence_max_messages','单组回复上限',1,20],
  ['reply_sequence_tool_budget','累计工具调用预算',0,128],
  ['reply_sequence_token_budget','累计 token 预算',1,1000000],
]);
function replyBudgetRow(settings,[key,title,min,max],locked){
  return `<div class="window-context-copy" style="padding:8px 12px"><label><strong>${escapeHtml(title)}</strong><input type="number" inputmode="numeric" min="${min}" max="${max}" step="1" data-reply-budget="${key}" placeholder="继承基本设置" value="${escapeAttribute(settings[key]??'')}" ${locked?'disabled':''}></label><small>${min}—${max}；留空继承</small></div>`;
}

function switchRow({ field = '', title, note, checked = false, enabled = true, action, extra = '' }) {
  const attrs = [
    'type="button"',
    'class="window-context-row"',
    action ? `data-action="${escapeAttribute(action)}"` : '',
    field ? `data-field="${escapeAttribute(field)}"` : '',
    `aria-pressed="${checked ? 'true' : 'false'}"`,
    enabled ? '' : 'disabled',
  ].filter(Boolean).join(' ');
  return `<button ${attrs}>
    <span class="window-context-copy">
      <strong>${escapeHtml(title)}</strong>
      <small>${escapeHtml(note)}</small>
    </span>
    ${extra}
    <span class="window-context-switch ${checked ? 'is-on' : ''}" aria-hidden="true"><span></span></span>
  </button>`;
}

export function createChatWindowSettings({
  runtime,
  currentHistory,
  setHistory,
  saveHistory,
  renderConversationList,
  renderMessages,
  toast,
}) {
  let root = null;

  function activeConversation() {
    return runtime.conversations.find((item) => item.id === runtime.currentId) || null;
  }

  function isUnavailableConversation() {
    return activeConversation()?.source === 'rikkahub';
  }

  function render() {
    if (!root) return;
    const state = currentHistory();
    const settings = normalizeContextSettings(state.context_settings);
    const locked = isUnavailableConversation();
    const fields = new Set(settings.reality_fields);
    const mediaLocked=locked||!['main','radio'].includes(activeConversation()?.room_type);
    const plan=String(runtime.profile?.current_chat_model||'').startsWith('chatgpt-plan:');
    const replyLocked=mediaLocked||Boolean(runtime.generation||runtime.finalizing||runtime.pendingComposerSend)||plan&&!settings.reply_sequence_enabled;

    const rows = WEB_REALITY_FIELDS.map(([field, title, note]) => switchRow({
      field,
      title,
      note,
      checked: fields.has(field),
      enabled: !locked,
      action: !locked ? 'chat:window-reality-field' : '',
    })).join('');

    root.innerHTML = `
      <button class="window-context-backdrop" type="button" data-action="chat:window-settings-close" aria-label="关闭窗口设置"></button>
      <section class="window-context-sheet" role="dialog" aria-modal="true" aria-labelledby="windowContextTitle">
        <header class="window-context-header">
          <div>
            <h2 id="windowContextTitle">这个窗口</h2>
            <p>只改变当前聊天窗口。屏幕显示的时间不等于模型自动知道时间。</p>
          </div>
          <button class="window-context-close" type="button" data-action="chat:window-settings-close" aria-label="关闭">×</button>
        </header>
        <div class="window-context-scroll">
          <section class="window-context-card">
            ${switchRow({
              title: '现实上下文',
              note: settings.reality_enabled ? '当前窗口按下方选择读取现实信息' : '关闭时不自动递入现实信息',
              checked: settings.reality_enabled,
              enabled: !locked,
              action: !locked ? 'chat:window-reality-master' : '',
            })}
            <div class="window-context-fields ${settings.reality_enabled ? '' : 'is-muted'}">
              ${rows}
            </div>
          </section>

          <section class="window-context-card">
            ${switchRow({
              title: '短句模式',
              note: '独立于现实上下文。普通闲聊优先简短接话，深话题仍可自然变长。',
              checked: settings.short_reply_mode,
              enabled: !locked,
              action: !locked ? 'chat:window-short-mode' : '',
            })}
            <button class="window-context-link" type="button" data-action="chat:window-soil-open" ${locked ? 'disabled' : ''}>
              <span><strong>整理当前对话的纸条</strong><small>打开当前窗口的总结与记忆候选。</small></span><span>›</span>
            </button>
          </section>

          <section class="window-context-card">
            ${activeConversation()?.room_type==='main'?switchRow({title:'允许回读自主活动',note:'普通聊天可按需阅读本窗口自主手记与活动摘要；不启动唤醒。',checked:settings.dream_readback_enabled,enabled:!locked,action:!locked?'chat:window-dream-readback':''}):''}
            ${switchRow({title:'允许发送表情包',note:'模型可自主查找和发送已启用的素材，不调用生图 API。',checked:settings.sticker_send_enabled,enabled:!mediaLocked,action:!mediaLocked?'chat:window-sticker-send':''})}
            ${switchRow({title:'允许添加表情包',note:'模型可登记自己在本窗口生成并保存的图片。',checked:settings.sticker_add_enabled,enabled:!mediaLocked,action:!mediaLocked?'chat:window-sticker-add':''})}
          </section>
          <section class="window-context-card">
            ${switchRow({title:'真实连续回复（实验）',note:plan?'网页不能直接调用设备上的 GPT 套餐；请选择普通 API 模型。':'模型可主动追加独立回复；达到额度或缺少用量时停止。',checked:settings.reply_sequence_enabled,enabled:!replyLocked,action:!replyLocked?'chat:window-reply-toggle':''})}
            ${REPLY_BUDGET_FIELDS.map(field=>replyBudgetRow(settings,field,mediaLocked)).join('')}
            <button class="window-context-link" type="button" data-action="chat:window-reply-budget-save" ${mediaLocked?'disabled':''}><span><strong>保存本窗口预算</strong><small>留空的项目继承基本设置。</small></span><span>›</span></button>
          </section>
          <section class="window-context-card">
            <button class="window-context-link" type="button" data-action="chat:window-dream-tide" ${locked||activeConversation()?.room_type!=='main'?'disabled':''}>
              <span><strong>自主唤醒</strong><small>仅本窗口 · 唤醒设置、自主手记与活动记录</small></span><span>›</span>
            </button>
          </section>
          <section class="window-context-card window-context-note">
            <strong>PWA 与 Native 的边界</strong>
            <p>PWA 只递入日期、时间和未来 7 天日历，保持轻量，不在聊天前等待天气或设备信息。完整现实上下文仍由 Native 提供。</p>
          </section>

          <button class="window-context-letter" type="button" data-action="chat:window-letter-open">新居信</button>
        </div>
      </section>`;
  }

  function open() {
    if (!root) root = q('#windowContextOverlay');
    if (!root) return;
    render();
    root.hidden = false;
  }

  function close() {
    if (root) root.hidden = true;
  }

  async function writeSettings(nextSettings) {
    if (!runtime.currentId || isUnavailableConversation()) return;
    const cid=runtime.currentId;
    const previous = currentHistory();
    const next = { ...previous, context_settings: normalizeContextSettings(nextSettings) };
    setHistory(runtime.currentId, next);
    renderConversationList();
    renderMessages(runtime.currentId);
    render();
    try {
      await saveHistory(cid, next);
    } catch (error) {
      setHistory(cid, previous);
      renderConversationList();
      if(runtime.currentId===cid)renderMessages(cid);
      render();
      toast(`窗口设置保存失败：${error.message}`);
    }
  }

  async function handleAction(name, target) {
    if (name === 'window-settings') return open();
    if (name === 'window-settings-close') return close();
    if (name === 'window-soil-open') {
      close();
      return runtime.memory?.handleAction?.('soil-open', { dataset: { conversationId: runtime.currentId } });
    }
    if (name === 'window-dream-tide') {
      if(isUnavailableConversation()||activeConversation()?.room_type!=='main'||!runtime.currentId)return;
      const cid=runtime.currentId;
      close();
      return runtime.dreamTide?.open(cid);
    }
    if (name === 'window-letter-open') {
      close();
      return runtime.letters?.handleAction?.('open');
    }

    const state = currentHistory();
    const settings = normalizeContextSettings(state.context_settings);

    if(name==='window-reply-toggle'){
      if(isUnavailableConversation()||!['main','radio'].includes(activeConversation()?.room_type))return;
      if(runtime.generation||runtime.finalizing||runtime.pendingComposerSend)return toast('请先结束当前回复，再修改开关。');
      if(!settings.reply_sequence_enabled&&String(runtime.profile?.current_chat_model||'').startsWith('chatgpt-plan:'))return toast('网页暂不支持设备 GPT 套餐执行。');
      return writeSettings({...settings,reply_sequence_enabled:!settings.reply_sequence_enabled});
    }
    if(name==='window-reply-budget-save'){
      if(isUnavailableConversation()||!['main','radio'].includes(activeConversation()?.room_type))return;
      if(runtime.generation||runtime.finalizing||runtime.pendingComposerSend)return toast('请先结束当前回复，再修改预算。');
      const next={...settings};
      for(const [key,title,min,max] of REPLY_BUDGET_FIELDS){
        const field=root?.querySelector(`[data-reply-budget="${key}"]`);
        if(!field)return;
        const raw=field.value.trim(),value=Number(raw);
        if(field.validity?.badInput||raw&&(!Number.isSafeInteger(value)||value<min||value>max))return toast(`${title}请输入 ${min}—${max} 的整数，原设置保留。`);
        if(!raw)delete next[key];else next[key]=value;
      }
      return writeSettings(next);
    }
    if (name === 'window-reality-master') {
      return writeSettings({ ...settings, reality_enabled: !settings.reality_enabled });
    }
    if(name==='window-dream-readback'){
      if(isUnavailableConversation()||activeConversation()?.room_type!=='main')return;
      return writeSettings({...settings,dream_readback_enabled:!settings.dream_readback_enabled});
    }
    if(name==='window-sticker-send')return writeSettings({...settings,sticker_send_enabled:!settings.sticker_send_enabled});
    if(name==='window-sticker-add')return writeSettings({...settings,sticker_add_enabled:!settings.sticker_add_enabled});
    if (name === 'window-short-mode') {
      return writeSettings({ ...settings, short_reply_mode: !settings.short_reply_mode });
    }
    if (name === 'window-reality-field') {
      const field = String(target.dataset.field || '');
      const allowed = WEB_REALITY_FIELDS.some(([key]) => key === field);
      if (!allowed) return;
      const fields = new Set(settings.reality_fields);
      if (fields.has(field)) fields.delete(field); else fields.add(field);
      return writeSettings({ ...settings, reality_fields: [...fields] });
    }
  }

  return Object.freeze({ open, close, render, handleAction });
}
