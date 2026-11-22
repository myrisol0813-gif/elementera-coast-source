import { API, requestJson } from '../core/api.js';
import { escapeAttribute, escapeHtml, q } from '../core/dom.js';

const MEDIA_TYPES = Object.freeze([
  ['all', '全部'], ['image', '影像'], ['audio', '声音'], ['file', '文件'],
]);
const SAVED_TYPES = Object.freeze([
  ['all', '全部'], ['text', '文字'], ['image', '影像'], ['audio', '声音'], ['file', '其他'],
]);

function option(value, label, current) {
  return '<option value="' + escapeAttribute(value) + '"' +
    (value === current ? ' selected' : '') + '>' + escapeHtml(label) + '</option>';
}

function itemSource(item) {
  if (item.kind === 'audio') return '/api/voice/clips/' + encodeURIComponent(item.source_id || item.id) + '/audio';
  if (item.kind === 'image' || item.kind === 'file') {
    return '/api/chat/attachments/' + encodeURIComponent(item.source_id || item.id) +
      '?conversation_id=' + encodeURIComponent(item.conversation_id) + '&inline=1';
  }
  return '';
}

function mediaPreview(item) {
  const url = itemSource(item);
  if (item.kind === 'image') return '<img class="coast-vault-image" loading="lazy" src="' +
    escapeAttribute(url) + '" alt="' + escapeAttribute(item.name || '保存的图片') + '">';
  if (item.kind === 'audio') return '<audio controls preload="none" src="' +
    escapeAttribute(url) + '"></audio>';
  if (item.kind === 'file') return '<a class="coast-vault-file" href="' +
    escapeAttribute(url) + '" target="_blank" rel="noopener noreferrer">查看原文件</a>';
  return '';
}

export function createCoastVault({ router, chat, toast }) {
  let items = [];
  let current = { mode: 'basic', kind: 'all', q: '', cursor: '' };

  function params(extra = {}) {
    return { ...current, ...extra, cursor: extra.cursor || '' };
  }

  function itemCard(item, index) {
    const saved = current.mode === 'treasures';
    const name = saved
      ? (item.kind === 'text' ? '文字摘录' : item.kind === 'audio' ? '语音收藏' : '媒体收藏')
      : item.name || '媒体';
    const primary = saved ? item.excerpt || '' : item.source_text || '';
    const storageHint = item.kind === 'text'
      ? '' : '<small class="coast-vault-hint">原文件可用性取决于当前服务端来源，取消红心不会删除原件。</small>';
    const action = saved
      ? '<button data-action="vault:remove" data-index="' + index + '" type="button">取消珍藏</button>'
      : item.favorited
        ? '<span class="coast-vault-mark">♥ 已在拾潮</span>'
        : '<button data-action="vault:save" data-index="' + index + '" type="button">♡ 拾入潮间</button>';
    const note = saved
      ? '<input class="coast-vault-note" maxlength="1200" value="' +
        escapeAttribute(item.notes || '') + '" placeholder="收藏备注，可按关键词查找">' +
        '<button data-action="vault:note" data-index="' + index + '" type="button">保存备注</button>'
      : '<input class="coast-vault-note" maxlength="1200" placeholder="备注，可留空">';
    return '<article class="coast-vault-card" data-vault-index="' + index + '">' +
      '<div class="coast-vault-meta"><strong>' + escapeHtml(name) + '</strong><small>' +
      escapeHtml(item.kind === 'audio' ? '声音' : item.kind === 'image' ? '影像' :
        item.kind === 'file' ? '其他文件' : '文字') + '</small></div>' +
      (saved ? mediaPreview(item) : (item.kind !== 'file' ? mediaPreview({
        ...item, source_id: item.id,
      }) : mediaPreview({ ...item, source_id: item.id }))) +
      (primary ? '<p class="coast-vault-excerpt">' + escapeHtml(primary.slice(0, 500)) + '</p>' : '') +
      storageHint + '<div class="coast-vault-actions">' + note + action +
      '<button data-action="vault:source" data-index="' + index +
      '" type="button">回到来源</button></div></article>';
  }

  async function view(raw = {}) {
    const mode = raw.mode === 'treasures' ? 'treasures' : 'basic';
    const choices = mode === 'treasures' ? SAVED_TYPES : MEDIA_TYPES;
    const kind = choices.some(pair => pair[0] === raw.kind) ? raw.kind : 'all';
    const qText = String(raw.q || '').slice(0, 100);
    const cursor = String(raw.cursor || '');
    current = { mode, kind, q: qText, cursor };
    const api = mode === 'treasures' ? API.vaultTreasures : API.vaultMedia;
    const query = '?kind=' + encodeURIComponent(kind) + '&q=' +
      encodeURIComponent(qText) + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
    let message = '', next = null;
    try {
      const result = await requestJson(api + query);
      items = result.items || [];
      next = result.next_cursor || null;
    } catch (error) {
      items = [];
      message = '读取失败：' + (error.message || '请检查网络连接');
    }
    const modeBar =
      '<nav class="coast-vault-modes">' +
      '<button type="button" data-action="vault:mode" data-mode="basic"' +
      (mode === 'basic' ? ' aria-current="page"' : '') + '>基本文件库</button>' +
      '<button type="button" data-action="vault:mode" data-mode="treasures"' +
      (mode === 'treasures' ? ' aria-current="page"' : '') + '>拾潮 · 珍藏</button></nav>';
    const searchForm =
      '<form data-submit="vault:search" class="coast-vault-search">' +
      '<label>类型 <select name="kind">' +
      choices.map(pair => option(pair[0], pair[1], kind)).join('') + '</select></label>' +
      '<input type="search" name="q" maxlength="100" value="' +
      escapeAttribute(qText) + '" placeholder="搜索文件、语音正文或收藏备注">' +
      '<button type="submit">搜索</button></form>';
    const itemsHtml = items.length ? '<div class="coast-vault-grid">' +
      items.map(itemCard).join('') + '</div>'
      : '<p class="coast-vault-empty">' +
        escapeHtml(message || (mode === 'basic' ? '还没有能够读取的已保存媒体。' : '还没有主动珍藏的内容。')) + '</p>';
    return {
      title: '海岸文件库',
      subtitle: mode === 'basic' ? '自动归集真实媒体 · 不收录聊天文字' : '拾潮 · 只收录你主动珍藏的东西',
      className: 'daily-panel coast-vault-panel',
      body: modeBar + searchForm + itemsHtml + (next
        ? '<button type="button" class="coast-vault-next" data-action="vault:more" data-cursor="' +
          escapeAttribute(next) + '">下一页</button>' : '') +
        '<p class="coast-vault-hint">媒体库收录当前可访问的海岸附件和已生成语音；原来不存在或已经失效的文件无法凭索引恢复。</p>',
    };
  }

  function card(index) {
    return q('[data-vault-index="' + index + '"]');
  }

  async function handle(name, target) {
    if (name === 'open') return router.open('vault-home', { mode: 'basic' });
    if (name === 'mode') return router.open('vault-home', { mode: target.dataset.mode }, { replace: true });
    if (name === 'more') return router.open('vault-home', params({ cursor: target.dataset.cursor }), { replace: true });
    const index = Number(target.dataset.index);
    const item = items[index];
    if (!item) return;
    if (name === 'source') {
      await router.close();
      const hit = {
        kind: item.message_id ? 'message' : 'conversation',
        conversation_id: item.conversation_id, turn_id: item.turn_id,
        message_id: item.message_id, role: item.role || (item.kind === 'audio' ? 'assistant' : 'user'),
      };
      if (!await chat.openSearchResult(hit)) toast('来源可能已删除或不可访问。');
      return;
    }
    if (name === 'save') {
      const notes = card(index)?.querySelector('.coast-vault-note')?.value || '';
      await requestJson(API.vaultTreasures, {
        method: 'POST', body: JSON.stringify({
          kind: item.kind, conversation_id: item.conversation_id,
          source_id: item.id, notes,
        }),
      });
      toast('已拾入潮间。');
      return router.refresh({ preserveScroll: true });
    }
    if (name === 'note') {
      const notes = card(index)?.querySelector('.coast-vault-note')?.value || '';
      await requestJson(API.vaultTreasures + '/' + encodeURIComponent(item.id), {
        method: 'PATCH', body: JSON.stringify({ notes }),
      });
      toast('珍藏备注已保存。');
      return;
    }
    if (name === 'remove') {
      if (!confirm('取消这条珍藏？原来的语音、图片、文件和聊天不会被删除。')) return;
      await requestJson(API.vaultTreasures + '/' + encodeURIComponent(item.id), { method: 'DELETE' });
      toast('已取消珍藏，原资料仍在。');
      return router.refresh({ preserveScroll: true });
    }
  }

  router.register('vault-home', view);

  return Object.freeze({
    id: 'vault', priority: 72, mountOrder: 80,
    ownsEvent(_event, context) {
      if (context.namespace !== 'vault') return false;
      return { preventDefault: context.eventType === 'click' || context.eventType === 'submit' };
    },
    handleEvent(_event, context) {
      if (context.eventType === 'submit' && context.name === 'search') {
        const form = context.target;
        return router.open('vault-home', params({
          kind: form.elements.namedItem('kind')?.value || 'all',
          q: form.elements.namedItem('q')?.value || '',
        }), { replace: true });
      }
      if (context.eventType === 'click') return handle(context.name, context.target);
    },
    mount() {},
    refresh() {},
    destroy() { items = []; },
  });
}
