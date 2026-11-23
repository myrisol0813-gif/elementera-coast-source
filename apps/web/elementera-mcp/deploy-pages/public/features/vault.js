import { API, requestJson } from '../core/api.js';
import { escapeAttribute, escapeHtml, q } from '../core/dom.js';

const MEDIA_TYPES = Object.freeze([
  ['all', '全部'], ['image', '影像'], ['audio', '声音'], ['file', '文件'],
]);
const SAVED_TYPES = Object.freeze([
  ['all', '全部'], ['writing', '文字'], ['image', '影像'], ['audio', '声音'], ['other', '其他'],
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
  let legacyBusy = false;

  function params(extra = {}) {
    return { ...current, ...extra, cursor: extra.cursor || '' };
  }

  function itemCard(item, index) {
    const saved = current.mode === 'treasures';
    const audio = item.kind === 'audio';
    const name = saved
      ? (item.kind === 'text' ? '文字摘录' : item.kind === 'soil' ? '原位思维壤'
        : audio ? '语音收藏' : '媒体收藏')
      : item.name || (audio ? '已生成语音' : '媒体');
    const primary = saved ? item.excerpt || '' : item.source_text || '';
    const favoriteId = saved ? item.id : item.treasure_id;
    const alreadySaved = saved || Boolean(item.favorited);
    const noteInput = '<input class="coast-vault-note" maxlength="1200" value="'
      + escapeAttribute(saved ? item.notes || '' : '')
      + '" aria-label="珍藏备注" placeholder="备注，可留空">';
    const smallAction = alreadySaved
      ? '<button data-action="vault:note" data-index="' + index
        + '" type="button"' + (favoriteId ? '' : ' disabled') + '>保存备注</button>'
      : '<button data-action="vault:save" data-index="' + index
        + '" type="button">拾入潮间</button>';
    const removeAction = alreadySaved && favoriteId
      ? '<button data-action="vault:remove" data-index="' + index
        + '" type="button">取消珍藏</button>' : '';
    const storageHint = item.kind === 'text' ? ''
      : '<small class="coast-vault-hint">取消珍藏不会删除原文件或原聊天。</small>';
    const title = '<div class="coast-vault-meta"><strong>' + escapeHtml(name)
      + '</strong><small>' + escapeHtml(audio ? '声音' : item.kind === 'image' ? '影像'
        : item.kind === 'file' ? '文件' : item.kind === 'soil' ? '旧思维壤' : '文字')
      + '</small></div>';
    if (audio) {
      return '<article class="coast-vault-card coast-vault-audio" data-vault-index="' + index + '">'
        + '<div class="coast-vault-player">' + mediaPreview(item)
        + '<button type="button" class="coast-vault-expand" data-action="vault:expand"'
        + ' data-index="' + index + '" aria-expanded="false" aria-label="展开语音原文">'
        + '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button></div>'
        + '<div class="coast-vault-audio-detail" hidden>'
        + '<p class="coast-vault-transcript-label">语音原文</p>'
        + '<div class="coast-vault-transcript">' + (primary
          ? escapeHtml(primary) : '此条语音暂无可读取的原文。') + '</div>'
        + '<div class="coast-vault-note-line">' + noteInput + smallAction + '</div>'
        + '<div class="coast-vault-tools"><a href="'
        + escapeAttribute(itemSource(item)) + '" download>下载语音</a>'
        + '<button data-action="vault:source" data-index="' + index
        + '" type="button">回到来源</button>'
        + '<button data-action="vault:copy" data-index="' + index
        + '" type="button"' + (primary ? '' : ' disabled') + '>复制全文</button>'
        + removeAction + '</div>' + storageHint + '</div></article>';
    }
    const note = saved
      ? '<div class="coast-vault-note-line">' + noteInput + smallAction + '</div>'
      : '<div class="coast-vault-note-line">' + noteInput
        + (alreadySaved ? '<span class="coast-vault-mark">已珍藏</span>'
          : smallAction) + '</div>';
    return '<article class="coast-vault-card" data-vault-index="' + index + '">'
      + title + mediaPreview(item)
      + (primary ? '<p class="coast-vault-excerpt">'
        + escapeHtml(primary.slice(0, 500)) + '</p>' : '')
      + storageHint + note
      + '<div class="coast-vault-actions">' + removeAction
      + '<button data-action="vault:source" data-index="' + index
      + '" type="button">回到来源</button></div></article>';
  }

  function sectionOf(item, saved) {
    if (item.kind === 'image') return 'image';
    if (item.kind === 'audio') return 'audio';
    if (item.kind === 'text' || item.kind === 'soil') return 'writing';
    return saved ? 'other' : 'file';
  }

  function groupedCards(saved) {
    const groups = saved
      ? [['writing', '文字'], ['image', '影像'], ['audio', '声音'], ['other', '其他']]
      : [['image', '影像'], ['audio', '声音'], ['file', '文件']];
    const indexed = items.map((item, index) => ({ item, index }));
    return groups.map(([key, title]) => {
      const sectionItems = indexed.filter(({ item }) => sectionOf(item, saved) === key);
      if (!sectionItems.length) return '';
      return '<section class="coast-vault-section"><header><strong>'
        + title + '</strong><small>' + sectionItems.length + ' 项</small></header>'
        + '<div class="coast-vault-grid'
        + (key === 'image' ? ' coast-vault-images' : '') + '">'
        + sectionItems.map(({ item, index }) => itemCard(item, index)).join('')
        + '</div></section>';
    }).join('');
  }

  async function view(raw = {}) {
    const mode = raw.mode === 'treasures' ? 'treasures' : 'basic';
    const choices = mode === 'treasures' ? SAVED_TYPES : MEDIA_TYPES;
    const kind = choices.some(pair => pair[0] === raw.kind) ? raw.kind : 'all';
    const qText = String(raw.q || '').slice(0, 100);
    const cursor = String(raw.cursor || '');
    current = { mode, kind, q: qText, cursor };
    const api = mode === 'treasures' ? API.vaultTreasures : API.vaultMedia;
    const remoteKind = kind === 'writing' || kind === 'other' ? 'all' : kind;
    const query = '?kind=' + encodeURIComponent(remoteKind) + '&q=' +
      encodeURIComponent(qText) + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
    let message = '', next = null;
    try {
      const result = await requestJson(api + query);
      const received = result.items || [];
      items = kind === 'writing' ? received.filter(item => sectionOf(item, true) === 'writing')
        : kind === 'other' ? received.filter(item => sectionOf(item, true) === 'other') : received;
      next = result.next_cursor || null;
    } catch (error) {
      items = [];
      message = '读取失败：' + (error.message || '请检查网络连接');
    }
    const modeBar = '<nav class="coast-vault-modes">'
      + '<button type="button" data-action="vault:mode" data-mode="basic"'
      + (mode === 'basic' ? ' aria-current="page"' : '') + '>基本文件库</button>'
      + '<button type="button" data-action="vault:mode" data-mode="treasures"'
      + (mode === 'treasures' ? ' aria-current="page"' : '') + '>拾潮</button></nav>';
    const searchForm = '<form data-submit="vault:search" class="coast-vault-search">'
      + '<span class="coast-vault-search-title">检索</span>'
      + '<div class="coast-vault-query-row"><input type="search" name="q" maxlength="100" value="'
      + escapeAttribute(qText) + '" placeholder="搜索文件、语音或备注">'
      + '<button type="submit">搜索</button></div>'
      + '<div class="coast-vault-kinds" aria-label="筛选类别">'
      + choices.map(([value, title]) => '<button type="button" data-action="vault:kind"'
        + ' data-kind="' + escapeAttribute(value) + '"'
        + (kind === value ? ' aria-current="true"' : '')
        + '>' + escapeHtml(title) + '</button>').join('')
      + '</div></form>';
    const itemsHtml = items.length ? groupedCards(mode === 'treasures')
      : '<p class="coast-vault-empty">'
        + escapeHtml(message || (mode === 'basic' ? '还没有能够读取的已保存媒体。'
          : '还没有符合条件的拾潮记录。')) + '</p>';
    const migration = mode === 'treasures'
      ? '<p class="coast-vault-hint"><button type="button" class="coast-vault-next"'
        + ' data-action="vault:legacy">检查旧红心 · 确认后迁入拾潮</button>'
        + ' 只增补旧助手红心，不删除旧标记或覆盖新备注；请先完成完整 JSON 备份。</p>'
      : '';
    return {
      title: '海岸文件库',
      subtitle: mode === 'basic' ? '自动归集真实媒体 · 不收录聊天文字' : '拾潮 · 只收录你主动珍藏的东西',
      className: 'daily-panel coast-vault-panel',
      body: modeBar + searchForm + migration + itemsHtml + (next
        ? '<button type="button" class="coast-vault-next" data-action="vault:more" data-cursor="' +
          escapeAttribute(next) + '">下一页</button>' : '') +
        '<p class="coast-vault-hint">媒体库收录当前可访问的海岸附件和已生成语音；原来不存在或已经失效的文件无法凭索引恢复。</p>',
    };
  }

  function card(index) {
    return q('[data-vault-index="' + index + '"]');
  }

  async function transferLegacyHearts() {
    if (legacyBusy) return;
    legacyBusy = true;
    try {
      const inspect = async (apply = false) => {
        let cursor = '', count = 0, added = 0, oversized = 0, exhausted = false;
        for (let page = 0; page < 1000; page += 1) {
          const result = apply
            ? await requestJson(API.vaultLegacyHearts, {
              method: 'POST',
              body: JSON.stringify({ confirm: true, cursor: cursor || 0 }),
            })
            : await requestJson(API.vaultLegacyHearts
              + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''));
          count += Number(result.recognized) || 0;
          added += Number(result.inserted) || 0;
          oversized += Number(result.oversized) || 0;
          cursor = result.next_cursor || '';
          if (!cursor) { exhausted = true; break; }
        }
        if (!exhausted) throw new Error('旧收藏过多，本次尚未遍历完整索引。');
        return { count, added, oversized };
      };
      const preview = await inspect(false);
      if (!preview.count) {
        toast('没有检测到需要扫描的旧助手红心；已有拾潮收藏不受影响。');
        return;
      }
      // Real D1 writes must only follow an explicit owner-triggered preview
      // and confirmation. There are no automatic migrations on startup.
      if (!confirm('预览：发现 ' + preview.count
        + ' 个旧助手红心，其中 ' + preview.oversized
        + ' 个因原文超长不会自动迁移，也不会被截断；它们仍完整留在旧聊天里。'
        + ' 本次只补充可完整保存的收藏，不清除旧标记，也不覆盖既有备注。继续吗？')) return;
      if (!confirm('请先在设置中完成全局 JSON 导出备份。确认你已保存备份，并要执行旧红心迁移？')) return;
      const migrated = await inspect(true);
      toast('旧红心迁移完成：识别 ' + migrated.count
        + ' 条，本次新增 ' + migrated.added
        + ' 条；超长原文 ' + migrated.oversized + ' 条保留待手动整理，没有截断旧聊天。');
      await router.refresh({ preserveScroll: true });
    } catch (error) {
      toast('旧红心迁移未完整结束，可重新检查并安全重试：' + (error.message || '网络失败'));
    } finally {
      legacyBusy = false;
    }
  }

  async function handle(name, target) {
    if (name === 'legacy') return transferLegacyHearts();
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
