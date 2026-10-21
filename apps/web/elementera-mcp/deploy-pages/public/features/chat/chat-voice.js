import { API, requestJson } from '../../core/api.js';
import { escapeHtml, escapeAttribute } from '../../core/dom.js';
import { activeBranch } from '../chat-state.js';

export function createChatVoice({ runtime, toast, renderMessages }) {
  const clips = new Map();
  runtime.voiceClips = clips;
  const loaded = new Set();

  async function load(conversationId, { force = false } = {}) {
    if (!conversationId || (loaded.has(conversationId) && !force)) return;
    try {
      const result = await requestJson(`${API.voiceClips}?conversation_id=${encodeURIComponent(conversationId)}`);
      clips.set(conversationId, result.clips || []);
      runtime.voiceLimits = result.limits || runtime.voiceLimits;
      loaded.add(conversationId);
      if (runtime.currentId === conversationId) renderMessages(conversationId);
    } catch (error) {
      console.warn('[coast-voice:load]', error?.type || 'request_failed');
      if (runtime.currentId === conversationId) toast('语音留存暂时无法读取。');
    }
  }

  function select(target) {
    const conversationId = runtime.currentId;
    const article = target.closest('[data-message-id]');
    const messageId = article?.dataset.messageId || '';
    const turnId = article?.dataset.turn || '';
    const turn = runtime.histories.get(conversationId)?.turns?.find(item => item.id === turnId);
    const assistant = turn ? activeBranch(turn).assistant : null;
    if (!assistant || assistant.id !== messageId || !assistant.content.trim()) return toast('这条消息没有可以朗读的正文。');
    const paragraphs = assistant.content.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
    if (!paragraphs.length) return toast('这条消息没有可以朗读的段落。');

    const limit = runtime.voiceLimits?.text_chars || 2400;
    const maxParagraphs = runtime.voiceLimits?.paragraphs_per_clip || 40;
    const clipsPerMessage = runtime.voiceLimits?.clips_per_message || 12;
    const dialog = document.createElement('dialog');
    dialog.className = 'coast-voice-dialog';
    dialog.innerHTML = `<section class="coast-voice-dialog-body">
      <h2>从这条消息留下声音</h2>
      <p>请选择段落。使用自托管环境配置的 ElevenLabs 声线，会消耗服务额度；单次最多 ${limit} 字、${maxParagraphs} 段，同一消息最多保留 ${clipsPerMessage} 段语音。</p>
      <div class="coast-voice-segments">${paragraphs.map((p,i)=>`<label><input type="checkbox" value="${i}"><span>${escapeHtml(p)}</span></label>`).join('')}</div>
      <div class="coast-voice-dialog-actions">
        <button type="button" data-voice-cancel>取消</button>
        <button type="button" data-voice-generate>确认生成</button>
      </div>
      <p class="coast-voice-dialog-error" aria-live="polite"></p>
    </section>`;
    document.body.append(dialog);
    const close = () => { dialog.close?.(); dialog.remove(); };
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    dialog.querySelector('[data-voice-cancel]').addEventListener('click', close);
    dialog.querySelector('[data-voice-generate]').addEventListener('click', async (event) => {
      const indices = [...dialog.querySelectorAll('input:checked')].map(node => Number(node.value));
      const text = indices.map(i => paragraphs[i]).join('\n\n');
      const error = dialog.querySelector('.coast-voice-dialog-error');
      if (!indices.length || indices.length > maxParagraphs || text.length > limit) {
        error.textContent = !indices.length ? '请先勾选至少一段。' : indices.length > maxParagraphs ? `每次最多选择 ${maxParagraphs} 段。` : `选中内容超过 ${limit} 字，请减少段落。`;
        return;
      }
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = '正在生成并保存…';
      error.textContent = '';
      try {
        const result = await requestJson(API.voiceClips, {
          method: 'POST', body: JSON.stringify({
            conversation_id: conversationId, message_id: messageId, paragraph_indices: indices,
          }),
        });
        clips.set(conversationId, [...(clips.get(conversationId) || []), result.clip]);
        loaded.add(conversationId);
        close();
        if (runtime.currentId === conversationId) renderMessages(conversationId);
        toast('语音已经保存在这条消息里。');
      } catch (failure) {
        error.textContent = failure?.message || '语音生成或保存失败，请检查额度与保存记录。';
      } finally {
        button.disabled = false;
        button.textContent = '确认生成';
      }
    });
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  return Object.freeze({ load, select });
}
