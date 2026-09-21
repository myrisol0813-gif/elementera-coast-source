import { API, requestJson } from '../core/api.js';
import { escapeHtml, q } from '../core/dom.js';
import { defaultIslandLetter } from '../content/island-letter.js';

const LETTER_ROUTES = new Set(['island-letter']);
const RETIRED_LOVEBOOK_PREFIX = 'coast_lovebook_v119::';

export function createLetters({ storage, chat, models, router, toast }) {
  const landingStatuses = new Map();

  function cleanStoredLetters() {
    storage.update((state) => {
      const source = state.letters && typeof state.letters === 'object' ? state.letters : {};
      state.letters = Object.fromEntries(Object.entries(source).map(([key, record]) => [
        key,
        { islandText: String(record?.islandText || '').slice(0, 12000) },
      ]));
    });
    const local = globalThis.localStorage;
    if (!local) return;
    const retired = [];
    for (let index = 0; index < local.length; index += 1) {
      const key = local.key(index) || '';
      if (key.startsWith(RETIRED_LOVEBOOK_PREFIX)) retired.push(key);
    }
    for (const key of retired) local.removeItem(key);
  }

  cleanStoredLetters();

  function context() {
    const conversationId = chat.getCurrentConversationId() || 'main';
    const modelId = chat.getProfile().current_chat_model || 'openai/gpt-4.1-nano';
    const modelName = models.modelName(modelId) || modelId;
    return { conversationId, modelId, modelName, key: `${conversationId}::${modelId}` };
  }

  function value() {
    const current = context();
    const stored = storage.read().letters[current.key] || {};
    return {
      ...current,
      islandText: stored.islandText || defaultIslandLetter(current.modelName),
    };
  }

  function write(patch = {}) {
    const current = value();
    storage.update((state) => {
      state.letters[current.key] = {
        islandText: Object.prototype.hasOwnProperty.call(patch, 'islandText')
          ? String(patch.islandText || '').slice(0, 12000)
          : current.islandText,
      };
    });
  }

  function islandView() {
    const letter = value();
    const sent = landingStatuses.get(letter.key)?.sent === true;
    return {
      title: '登岛信',
      subtitle: `${letter.modelName} · 当前窗口独立保存`,
      className: 'letters-panel',
      body: `<p class="feature-note">这不是记忆库。当前窗口与当前模型独立保存；递出后，当前模型会在这个窗口里读信并回复。</p>
        <textarea id="islandLetterText" class="letter-text" rows="22">${escapeHtml(letter.islandText)}</textarea>
        <div class="button-row"><button type="button" data-action="letters:send-island">${sent ? '重新递出登岛信' : '递出登岛信'}</button><button type="button" data-action="letters:save-island">保存</button><button type="button" data-action="letters:reset-island">恢复默认</button></div>`,
    };
  }

  router.register('island-letter', islandView);

  async function open() {
    const letter = value();
    const data = await requestJson(`${API.landingLetter}?conversation_id=${encodeURIComponent(letter.conversationId)}&model=${encodeURIComponent(letter.modelId)}`);
    landingStatuses.set(letter.key, data.landing || { sent: false });
    await router.open('island-letter');
  }

  async function handleAction(name) {
    if (name === 'open') return open();
    if (name === 'save-island') {
      write({ islandText: q('#islandLetterText')?.value || '' });
      return toast('已保存登岛信');
    }
    if (name === 'send-island') {
      const letter = value();
      const islandText = q('#islandLetterText')?.value || letter.islandText;
      write({ islandText });
      if (!islandText.trim()) return toast('请先写好登岛信。');
      if (landingStatuses.get(letter.key)?.sent
        && !confirm('这会开启一个新的读信回复，不会删除旧聊天。')) return;
      const data = await chat.sendLandingLetter({
        conversationId: letter.conversationId,
        modelId: letter.modelId,
        letterText: islandText,
      });
      landingStatuses.set(letter.key, data.landing || { sent: true });
      await router.close();
      if (data.soil_refresh?.ok === false) {
        return toast('登岛信已递出，但整理当前对话的纸条整理失败，可以稍后手动整理。', 3200);
      }
      if (data.soil_refresh?.reason === 'manual_locked') {
        return toast('登岛信已递出；整理当前对话的纸条已手动锁定，保留原有内容。', 2800);
      }
      if (data.finish_reason === 'length') {
        return toast('登岛信已递出，但模型或供应商达到自身长度上限；可以点“重新生成”再读一次。', 3200);
      }
      return toast('登岛信已经递到手里。');
    }
    if (name === 'reset-island') {
      const letter = value();
      write({ islandText: defaultIslandLetter(letter.modelName) });
      toast('已恢复默认登岛信');
      return router.refresh();
    }
  }

  function ownsRoute(route) {
    return LETTER_ROUTES.has(route?.name || '');
  }

  function ownsEvent(_event, contextValue) {
    return contextValue.eventType === 'click' && contextValue.namespace === 'letters'
      ? { preventDefault: true }
      : false;
  }

  function handleEvent(event, contextValue) {
    return handleAction(contextValue.name, contextValue.target, event);
  }

  function mount() {}
  function refresh() {}
  function destroy() {}

  return Object.freeze({
    id: 'letters',
    priority: 40,
    mountOrder: 40,
    ownsRoute,
    ownsEvent,
    handleEvent,
    mount,
    refresh,
    destroy,
    handleAction,
  });
}
