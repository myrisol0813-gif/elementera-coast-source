import { API, requestJson } from '../../core/api.js';
import { activeBranch, selectedAssistantMessage } from '../chat-state.js';

function textNode(tag, value, className = '') {
  const element = document.createElement(tag);
  element.textContent = value;
  element.className = className;
  return element;
}

function mediaChoices(variant, role, voices) {
  const records = [];
  if (variant.content?.trim()) records.push({
    kind: 'text', id: variant.id, title: role === 'user' ? '用户文字' : '助手文字',
    paragraphs: variant.content.split(/\n\s*\n/),
  });
  for (const attachment of variant.attachments || []) {
    if (!attachment?.id) continue;
    records.push({
      kind: attachment.type === 'image' ? 'image' : 'file', id: attachment.id,
      title: attachment.name || '聊天附件',
    });
  }
  for (const clip of voices) {
    if (!clip?.id) continue;
    records.push({ kind: 'audio', id: clip.id, title: '语音 · ' + String(clip.text || '').slice(0, 90) });
  }
  return records;
}

export function createChatTreasures({ runtime, currentHistory, toast, renderMessages }) {
  async function getSaved(conversationId, turnId) {
    const collected = [];
    let cursor = '';
    for (let page = 0; page < 6; page += 1) {
      const url = API.vaultTreasures + '?conversation_id=' + encodeURIComponent(conversationId)
        + '&turn_id=' + encodeURIComponent(turnId)
        + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
      const response = await requestJson(url);
      collected.push(...(response.items || []));
      cursor = response.next_cursor || '';
      if (!cursor) return collected;
    }
    throw new Error('同一轮收藏数量超过查看上限，请到拾潮中整理。');
  }

  // Server treasure rows, not the retired favorite boolean, are authoritative.
  // Called on conversation load and after confirmed saves/removals. No automatic
  // background writes or model context injection.
  async function refreshIndex(conversationId) {
    if (!conversationId) return;
    const rows = [];
    let cursor = '';
    for (let page = 0; page < 250; page += 1) {
      const query = API.vaultTreasures + '?conversation_id=' + encodeURIComponent(conversationId)
        + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
      const result = await requestJson(query);
      rows.push(...(result.items || []));
      cursor = result.next_cursor || '';
      if (!cursor) break;
    }
    if (cursor) throw new Error('当前窗口的珍藏索引超过读取上限。');
    const messageIds = new Set(rows.map((item) => item.message_id).filter(Boolean));
    const userMediaTurns = new Set(rows.filter((item) =>
      item.kind === 'image' || item.kind === 'file').map((item) => item.turn_id).filter(Boolean));
    runtime.treasureIndicators.set(conversationId, { messageIds, userMediaTurns });
    // Update only the visible hearts, never force a whole chat re-render or
    // scroll the user away from the original source message.
    if (runtime.currentId === conversationId) {
      for (const article of document.querySelectorAll('.message[data-message-id][data-turn]')) {
        const button = article.querySelector('[data-action="chat:favorite"]');
        if (!button) continue;
        const id = article.dataset.messageId || '';
        const saved = messageIds.has(id) || (article.classList.contains('user')
          && userMediaTurns.has(article.dataset.turn || ''));
        const oldHeart = article.classList.contains('assistant')
          && article.dataset.legacyFavorite === 'true';
        button.classList.toggle('is-active', saved || oldHeart);
        button.classList.toggle('is-legacy', oldHeart && !saved);
        button.setAttribute('aria-pressed', String(saved || oldHeart));
        const title = oldHeart && !saved ? '旧红心 · 待迁入拾潮' : '收藏';
        button.title = title;
        button.setAttribute('aria-label', title);
      }
    }
  }

  async function open(target) {
    const article = target.closest('.message[data-message-id][data-turn]');
    if (!article) return toast('找不到这条消息的来源。');
    const conversationId = runtime.currentId;
    const turnId = article.dataset.turn;
    const messageId = article.dataset.messageId;
    const visibleHistory = runtime.searchPreview?.get(conversationId) || currentHistory();
    const turn = visibleHistory.turns.find((item) => item.id === turnId);
    const branch = turn ? activeBranch(turn) : null;
    const role = article.classList.contains('user') ? 'user' : 'assistant';
    const variant = role === 'user' ? branch?.user : (turn ? selectedAssistantMessage(turn,messageId) : null);
    if (!variant || variant.id !== messageId) return toast('原消息版本已经改变，请重新打开。');
    const voices = (runtime.voiceClips?.get(conversationId) || []).filter((clip) =>
      clip.message_id === messageId || (!clip.message_id && role === 'assistant' && branch?.assistant?.id===messageId && clip.turn_id === turnId));
    const choices = mediaChoices(variant, role, voices);
    if (!choices.length) return toast('这条消息暂时没有可收藏的内容。');

    let saved;
    try { saved = await getSaved(conversationId, turnId); }
    catch (error) { return toast('读取珍藏状态失败：' + error.message); }
    const bySource = new Map(saved.map((item) => [item.kind + ':' + item.source_id, item]));

    const dialog = document.createElement('dialog');
    dialog.className = 'coast-treasure-dialog';
    dialog.append(textNode('h2', '拾入潮间'));
    dialog.append(textNode('p', '勾选想珍藏的部分。媒体即使不点红心，也会保留在基本文件库中。', 'coast-treasure-intro'));
    const list = document.createElement('div');
    list.className = 'coast-treasure-choices';
    const controls = [];
    for (const choice of choices) {
      const existing = bySource.get(choice.kind + ':' + choice.id);
      const row = document.createElement('section');
      row.className = 'coast-treasure-choice';
      const title = document.createElement('label');
      const tick = document.createElement('input');
      tick.type = 'checkbox';
      tick.checked = !!existing || saved.length === 0;
      title.append(tick, document.createTextNode(' ' + choice.title));
      row.append(title);
      const paragraphs = [];
      if (choice.paragraphs?.length > 1) {
        const sublist = document.createElement('div');
        sublist.className = 'coast-treasure-paragraphs';
        const selected = existing?.paragraph_indices || [];
        choice.paragraphs.forEach((text, index) => {
          const entry = document.createElement('label');
          const select = document.createElement('input');
          select.type = 'checkbox';
          select.checked = !existing || !selected.length || selected.includes(index);
          entry.append(select, document.createTextNode(text.slice(0, 160)));
          sublist.append(entry);
          paragraphs.push(select);
        });
        tick.addEventListener('change', () => {
          if (tick.checked && !paragraphs.some((select) => select.checked)) {
            paragraphs.forEach((select) => { select.checked = true; });
          }
        });
        sublist.addEventListener('change', () => {
          tick.checked = paragraphs.some((select) => select.checked);
        });
        row.append(sublist);
      }
      list.append(row);
      controls.push({ choice, tick, paragraphs, existing });
    }
    dialog.append(list);

    const memoLabel = textNode('label', '备注（支持关键词搜索）', 'coast-treasure-memo-label');
    const memo = document.createElement('textarea');
    memo.rows = 2;
    memo.maxLength = 1200;
    memo.placeholder = '给选中的收藏写一句备注，可留空';
    memo.value = saved.find((item) => item.notes)?.notes || '';
    memoLabel.append(memo);
    dialog.append(memoLabel);
    const error = textNode('p', '', 'coast-treasure-error');
    error.setAttribute('aria-live', 'polite');
    dialog.append(error);
    const buttons = document.createElement('div');
    buttons.className = 'coast-treasure-actions';
    const cancel = textNode('button', '返回');
    cancel.type = 'button';
    const confirmButton = textNode('button', '保存选择');
    confirmButton.type = 'button';
    buttons.append(cancel, confirmButton);
    dialog.append(buttons);
    const close = () => { if (dialog.open) dialog.close(); dialog.remove(); };
    cancel.addEventListener('click', close);
    dialog.addEventListener('close', () => dialog.remove(), { once: true });

    confirmButton.addEventListener('click', async () => {
      const selected = controls.filter((entry) => entry.tick.checked);
      const hadSaved = controls.some((entry) => !!entry.existing);
      if (!selected.length && !hadSaved) {
        error.textContent = '请至少勾选一项。';
        return;
      }
      if (!selected.length && !confirm('取消这条消息在拾潮的全部收藏？原媒体不受影响。')) return;
      const changes = [];
      for (const entry of selected) {
        const indices = entry.paragraphs.flatMap((box, index) => box.checked ? [index] : []);
        if (entry.paragraphs.length && !indices.length) {
          error.textContent = '请选择要珍藏的文字段落。';
          return;
        }
        const paragraph_indices = entry.paragraphs.length && indices.length < entry.paragraphs.length ? indices : [];
        const unchanged = entry.existing &&
          JSON.stringify(entry.existing.paragraph_indices || []) === JSON.stringify(paragraph_indices) &&
          (!memo.value.trim() || memo.value.trim() === entry.existing.notes);
        if (unchanged) continue;
        changes.push({ method: 'POST', url: API.vaultTreasures, body: {
          kind: entry.choice.kind, conversation_id: conversationId, source_id: entry.choice.id,
          ...(paragraph_indices.length ? { paragraph_indices } : {}),
          notes: memo.value.trim() || entry.existing?.notes || '',
        } });
      }
      for (const entry of controls) {
        if (entry.existing && !entry.tick.checked) {
          changes.push({ method: 'DELETE', url: API.vaultTreasures + '/' + encodeURIComponent(entry.existing.id) });
        }
      }
      confirmButton.disabled = true;
      error.textContent = '正在保存收藏…';
      try {
        for (const change of changes) {
          await requestJson(change.url, {
            method: change.method,
            ...(change.body ? { body: JSON.stringify(change.body) } : {}),
          });
        }
        await refreshIndex(conversationId);
        close();
        toast(changes.length ? '已更新拾潮收藏，原媒体不受影响。' : '收藏内容没有变化。');
      } catch (failure) {
        error.textContent = '有操作可能已保存，请重新打开核对：' + (failure.message || '请求失败');
      } finally { confirmButton.disabled = false; }
    });

    document.body.append(dialog);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  return Object.freeze({ open, refreshIndex });
}
