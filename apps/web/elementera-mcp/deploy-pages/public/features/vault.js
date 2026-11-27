import { API, requestJson } from '../core/api.js';
import { escapeAttribute, escapeHtml, q } from '../core/dom.js';

const MEDIA_TYPES = Object.freeze([
  ['all', '全部'], ['image', '影像'], ['audio', '声音'], ['file', '文件'],
]);
const SAVED_TYPES = Object.freeze([
  ['all', '全部'], ['writing', '文字'], ['image', '影像'], ['audio', '声音'], ['other', '其他'],
]);

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

  function stickerCard(item,index){
    const image=item.available?mediaPreview({...item,kind:'image',source_id:item.attachment_id}):'<p>原件不可访问</p>';
    return '<article class="coast-vault-card" data-vault-index="'+index+'">'+image
      +'<textarea class="coast-sticker-description" rows="3" maxlength="500" aria-label="素材说明">'+escapeHtml(item.description)+'</textarea>'
      +'<small>'+escapeHtml(item.author==='assistant'?'模型添加':'屋主添加')+' · '+(item.enabled?'已启用':'已停用')+'</small>'
      +'<div class="coast-vault-actions"><button type="button" data-action="vault:sticker-save" data-index="'+index+'">保存说明</button>'
      +'<button type="button" data-action="vault:sticker-toggle" data-index="'+index+'">'+(item.enabled?'停用':'启用')+'</button>'
      +'<button type="button" data-action="vault:sticker-remove" data-index="'+index+'">移除</button></div></article>';
  }

  function itemCard(item, index) {
    const saved = current.mode === 'treasures';
    const audio = item.kind === 'audio';
    const image = item.kind === 'image';
    const originalName = saved ? item.excerpt || '' : item.name || '';
    const name = image
      ? (item.display_name || originalName || '海岸影像')
      : saved ? (item.kind === 'text' ? '文字摘录' : item.kind === 'soil'
        ? '原位纸条' : audio ? '语音收藏' : '媒体收藏')
        : item.name || (audio ? '已生成语音' : '媒体');
    const primary = saved ? item.excerpt || '' : item.source_text || '';
    const favoriteId = saved ? item.id : item.treasure_id;
    const alreadySaved = saved || Boolean(item.favorited);
    const notes = item.notes || '';
    const noteInput = '<textarea class="coast-vault-note" maxlength="1200" rows="3"'
      + ' aria-label="珍藏备注" placeholder="写一点想留下的话…">'
      + escapeHtml(notes) + '</textarea>';
    const noteAction = alreadySaved ? '保存备注' : '拾入潮间并保存';
    const noteSummary = notes
      ? '<div class="coast-vault-note-preview"><button type="button"'
        + ' class="coast-vault-note-toggle" data-action="vault:note-expand" data-index="' + index
        + '" aria-expanded="false"><span class="coast-vault-note-text">' + escapeHtml(notes)
        + '</span>' + (notes.length > 48 || notes.includes('\n')
          ? '<span class="coast-vault-note-chevron" aria-hidden="true">⌄</span>' : '')
        + '</button><button type="button" class="coast-vault-note-edit"'
        + ' data-action="vault:note-edit" data-index="' + index + '">修改</button></div>'
      : '<button class="coast-vault-add-note" type="button"'
        + ' data-action="vault:note-edit" data-index="' + index + '">添加备注…</button>';
    const note = '<div class="coast-vault-annotation">' + noteSummary
      + '<div class="coast-vault-note-editor coast-vault-note-line" hidden>'
      + noteInput
      + '<div class="coast-vault-note-buttons"><button type="button" data-action="vault:note-save"'
      + ' data-index="' + index + '">' + noteAction + '</button>'
      + '<button type="button" data-action="vault:note-cancel" data-index="' + index
      + '">取消</button></div></div></div>';
    const removeAction = alreadySaved && favoriteId
      ? '<button data-action="vault:remove" data-index="' + index
        + '" type="button">取消珍藏</button>' : '';
    const saveAction = alreadySaved ? '' : '<button data-action="vault:save" data-index="'
      + index + '" type="button">拾入潮间</button>';
    if (image) {
      return '<article class="coast-vault-card coast-vault-image-card" data-vault-index="' + index + '">'
        + '<button type="button" class="coast-vault-photo" data-action="vault:image-open"'
        + ' data-index="' + index + '" aria-label="打开图片大图">'
        + mediaPreview(item) + '</button>'
        + '<div class="coast-vault-caption"><strong title="' + escapeAttribute(name) + '">'
        + escapeHtml(name) + '</strong></div>'
        + note
        + '<dialog class="coast-vault-image-dialog" aria-label="图片查看器">'
        + '<div class="coast-vault-image-toolbar"><button type="button"'
        + ' data-action="vault:image-close" data-index="' + index + '">关闭</button>'
        + '<details class="coast-vault-image-menu"><summary aria-label="图片操作">···</summary>'
        + '<div class="coast-vault-image-menu-items">'
        + '<button type="button" data-action="vault:rename-open" data-index="' + index
        + '">修改名称</button>' + saveAction + removeAction
        + '<button type="button" data-action="vault:sticker-add" data-index="' + index + '">加入表情包</button>'
        + '<a download href="' + escapeAttribute(itemSource(item)) + '">下载原图</a>'
        + '<button type="button" data-action="vault:source" data-index="' + index
        + '">回到来源</button></div></details></div>'
        + '<img src="' + escapeAttribute(itemSource(item)) + '" alt="'
        + escapeAttribute(name) + '" class="coast-vault-large-image">'
        + '<div class="coast-vault-image-fullname">' + escapeHtml(name) + '</div>'
        + '<div class="coast-vault-rename-form" hidden><label>展示名称'
        + '<input class="coast-vault-display-name" maxlength="80" value="'
        + escapeAttribute(item.display_name || '') + '" placeholder="留空则恢复原文件名"></label>'
        + '<div class="coast-vault-rename-actions"><button type="button"'
        + ' data-action="vault:rename-save" data-index="' + index + '">保存名称</button>'
        + '<button type="button" data-action="vault:rename-cancel" data-index="' + index
        + '">返回</button></div></div>'
        + '<small>原文件名：' + escapeHtml(originalName || '未知') + '</small>'
        + '</dialog></article>';
    }
    const title = '<div class="coast-vault-meta"><strong>' + escapeHtml(name)
      + '</strong><small>' + escapeHtml(audio ? '声音' : item.kind === 'file'
        ? '文件' : item.kind === 'soil' ? '历史纸条' : '文字') + '</small></div>';
    if (audio) {
      return '<article class="coast-vault-card coast-vault-audio" data-vault-index="' + index + '">'
        + '<div class="coast-vault-player">' + mediaPreview(item)
        + '<button type="button" class="coast-vault-expand" data-action="vault:expand"'
        + ' data-index="' + index + '" aria-expanded="false" aria-label="展开语音原文">'
        + '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button></div>'
        + note
        + '<div class="coast-vault-audio-detail" hidden>'
        + '<p class="coast-vault-transcript-label">语音原文</p>'
        + '<div class="coast-vault-transcript">' + (primary
          ? escapeHtml(primary) : '此条语音暂无可读取的原文。') + '</div>'
        + '<div class="coast-vault-tools"><a href="'
        + escapeAttribute(itemSource(item)) + '" download>下载语音</a>'
        + '<button data-action="vault:source" data-index="' + index
        + '" type="button">回到来源</button>'
        + '<button data-action="vault:copy" data-index="' + index
        + '" type="button"' + (primary ? '' : ' disabled') + '>复制全文</button>'
        + saveAction + removeAction + '</div></div></article>';
    }
    return '<article class="coast-vault-card" data-vault-index="' + index + '">'
      + title + mediaPreview(item)
      + (item.kind === 'file' ? '' : primary ? '<p class="coast-vault-excerpt">'
        + escapeHtml(primary.slice(0, 500)) + '</p>' : '')
      + note
      + '<div class="coast-vault-actions">' + saveAction + removeAction
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
    const mode = ['treasures','stickers'].includes(raw.mode) ? raw.mode : 'basic';
    const choices = mode === 'treasures' ? SAVED_TYPES : MEDIA_TYPES;
    const kind = choices.some(pair => pair[0] === raw.kind) ? raw.kind : 'all';
    const qText = String(raw.q || '').slice(0, 100);
    const cursor = String(raw.cursor || '');
    current = { mode, kind, q: qText, cursor };
    const api = mode === 'stickers' ? '/api/coast-vault/stickers' : mode === 'treasures' ? API.vaultTreasures : API.vaultMedia;
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
      + (mode === 'treasures' ? ' aria-current="page"' : '') + '>收藏</button>'
      + '<button type="button" data-action="vault:mode" data-mode="stickers"'+(mode==='stickers'?' aria-current="page"':'')+'>表情包</button></nav>';
    const searchForm = '<form data-submit="vault:search" class="coast-vault-search">'
      + '<span class="coast-vault-search-title">检索</span>'
      + '<div class="coast-vault-query-row"><input type="search" name="q" maxlength="100" value="'
      + escapeAttribute(qText) + '" placeholder="搜索文件、语音或备注">'
      + '<button type="submit">搜索</button></div>'
      + '<div class="coast-vault-kinds" aria-label="筛选类别">'
      + (mode==='stickers'?[]:choices).map(([value, title]) => '<button type="button" data-action="vault:kind"'
        + ' data-kind="' + escapeAttribute(value) + '"'
        + (kind === value ? ' aria-current="true"' : '')
        + '>' + escapeHtml(title) + '</button>').join('')
      + '</div></form>';
    const itemsHtml = items.length ? (mode==='stickers'?'<section class="coast-vault-grid coast-vault-images">'+items.map(stickerCard).join('')+'</section>':groupedCards(mode === 'treasures'))
      : '<p class="coast-vault-empty">'
        + escapeHtml(message || (mode === 'basic' ? '还没有能够读取的已保存媒体。'
          : '还没有符合条件的收藏记录。')) + '</p>';
    const upload=mode==='stickers'?'<form class="feature-card coast-sticker-upload" data-submit="vault:sticker-upload"><label>添加图片<input type="file" name="file" accept="image/png,image/jpeg,image/webp" required></label><label>素材说明<textarea name="description" rows="2" maxlength="500" required></textarea></label><button type="submit">加入表情包</button></form>':'';
    const migration = mode === 'treasures'
      ? '<p class="coast-vault-hint"><button type="button" class="coast-vault-next"'
        + ' data-action="vault:legacy">检查旧红心 · 确认后迁入收藏</button>'
        + ' 只增补旧助手红心，不删除旧标记或覆盖新备注；请先完成完整 JSON 备份。</p>'
      : '';
    return {
      title: '文件库',
      subtitle: mode==='stickers'?'从文件库图片菜单添加素材，独立管理说明与发送权限':mode === 'basic' ? '自动归集真实媒体 · 不收录聊天文字' : '收藏 · 只收录你主动珍藏的东西',
      className: 'daily-panel coast-vault-panel',
      body: modeBar + searchForm + upload + migration + itemsHtml + (next
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
        toast('没有检测到需要扫描的旧助手红心；已有收藏不受影响。');
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
    if (name === 'kind') return router.open('vault-home', params({ kind: target.dataset.kind }), { replace: true });
    if (name === 'expand') {
      const button = target.closest('.coast-vault-expand');
      const detail = button?.closest('.coast-vault-audio')?.querySelector('.coast-vault-audio-detail');
      if (!detail) return;
      detail.hidden = !detail.hidden;
      button.setAttribute('aria-expanded', String(!detail.hidden));
      button.setAttribute('aria-label', detail.hidden ? '展开语音原文' : '收起语音原文');
      return;
    }
    if (name === 'more') return router.open('vault-home', params({ cursor: target.dataset.cursor }), { replace: true });
    const index = Number(target.dataset.index);
    const item = items[index];
    if (!item) return;
    if(name==='sticker-add'){
      const description=window.prompt('写一句供模型选择时参考的表情包说明。','');
      if(!description?.trim())return;
      await requestJson('/api/coast-vault/stickers',{method:'POST',body:JSON.stringify({conversation_id:item.conversation_id,attachment_id:item.source_id||item.id,description})});
      toast('已登记表情包，原图不变。');return;
    }
    if(['sticker-save','sticker-toggle','sticker-remove'].includes(name)){
      const url='/api/coast-vault/stickers/'+encodeURIComponent(item.id);
      if(name==='sticker-remove'){
        if(!confirm('移除该表情包索引？原图片与已发送的聊天记录均保留。'))return;
        await requestJson(url,{method:'DELETE'});
      }else{
        const patch=name==='sticker-save'?{description:card(index)?.querySelector('.coast-sticker-description')?.value||''}:{enabled:!item.enabled};
        await requestJson(url,{method:'PATCH',body:JSON.stringify(patch)});
      }
      return router.refresh({preserveScroll:true});
    }
    if (name === 'image-open' || name === 'image-close') {
      const dialog = card(index)?.querySelector('.coast-vault-image-dialog');
      if (!dialog) return;
      if (name === 'image-open') dialog.showModal();
      else dialog.close();
      return;
    }
    if (name === 'rename-open' || name === 'rename-cancel') {
      const root = card(index);
      const editor = root?.querySelector('.coast-vault-rename-form');
      if (!editor) return;
      editor.hidden = name !== 'rename-open';
      if (!editor.hidden) {
        root.querySelector('.coast-vault-image-menu')?.removeAttribute('open');
        root.querySelector('.coast-vault-display-name')?.focus();
      }
      return;
    }
    if (name === 'rename-save') {
      const display_name = card(index)?.querySelector('.coast-vault-display-name')?.value || '';
      try {
        await requestJson('/api/coast-vault/media-labels', {
          method: 'PATCH', body: JSON.stringify({
            kind: 'image', conversation_id: item.conversation_id,
            source_id: item.source_id || item.id, display_name,
          }),
        });
        toast('图片显示名称已保存，原始文件没有改变。');
        return router.refresh({ preserveScroll: true });
      } catch (error) {
        return toast('修改名称失败：' + (error.message || '请稍后重试'));
      }
    }
    if (name === 'note-expand') {
      const toggle = card(index)?.querySelector('.coast-vault-note-toggle');
      if (!toggle) return;
      const expanded = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!expanded));
      toggle.closest('.coast-vault-note-preview')?.classList.toggle('is-expanded', !expanded);
      return;
    }
    if (name === 'note-edit' || name === 'note-cancel') {
      const editor = card(index)?.querySelector('.coast-vault-note-editor');
      if (!editor) return;
      editor.hidden = name === 'note-cancel';
      if (!editor.hidden) editor.querySelector('textarea')?.focus();
      return;
    }
    if (name === 'note-save') {
      const notes = card(index)?.querySelector('.coast-vault-note')?.value || '';
      try {
        const favoriteId = current.mode === 'treasures' ? item.id : item.treasure_id;
        if (favoriteId) {
          await requestJson(API.vaultTreasures + '/' + encodeURIComponent(favoriteId), {
            method: 'PATCH', body: JSON.stringify({ notes }),
          });
          toast('备注已保存。');
        } else {
          await requestJson(API.vaultTreasures, {
            method: 'POST', body: JSON.stringify({
              kind: item.kind, conversation_id: item.conversation_id,
              source_id: item.id, notes,
            }),
          });
          toast('备注已保存，并已拾入潮间。');
        }
        return router.refresh({ preserveScroll: true });
      } catch (error) {
        return toast('保存备注失败：' + (error.message || '请稍后重试'));
      }
    }
    if (name === 'copy') {
      const content = current.mode === 'treasures' ? item.excerpt || '' : item.source_text || '';
      if (!content) return toast('这条语音暂无可复制的原文。');
      try {
        await navigator.clipboard.writeText(content);
        toast('已复制语音原文。');
      } catch {
        toast('复制失败，请长按原文选择复制。');
      }
      return;
    }
    if (name === 'source') {
      const mediaId=item.source_id||item.id;
      if(['audio','image'].includes(item.kind)&&/^(att|voice)_dream_/.test(mediaId)){
        return router.open('dream-tide-activity',{conversationId:item.conversation_id,mediaId});
      }
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
    if (name === 'remove') {
      if (!confirm('取消这条珍藏？原来的语音、图片、文件和聊天不会被删除。')) return;
      const favoriteId = current.mode === 'treasures' ? item.id : item.treasure_id;
      if (!favoriteId) return toast('未找到对应的珍藏记录，请刷新后再试。');
      await requestJson(API.vaultTreasures + '/' + encodeURIComponent(favoriteId), { method: 'DELETE' });
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
    async handleEvent(_event, context) {
      if(context.eventType==='submit'&&context.name==='sticker-upload'){
        const form=context.target,file=form.elements.namedItem('file')?.files?.[0],description=form.elements.namedItem('description')?.value?.trim();
        if(form.dataset.busy==='1')return;
        if(!file||!description)return toast('请选择图片并填写素材说明。');
        if(file.size>8*1024*1024||!['image/png','image/jpeg','image/webp'].includes(file.type))return toast('请选择8 MiB以内的 PNG、JPEG 或 WebP。');
        form.dataset.busy='1';const button=form.querySelector('button[type=submit]');if(button)button.disabled=true;
        try{await requestJson('/api/coast-vault/stickers/upload',{method:'POST',body:file,headers:{'Content-Type':file.type,'X-Sticker-Name':encodeURIComponent(file.name),'X-Sticker-Description':encodeURIComponent(description)}});
          toast('表情包已保存。');return router.refresh({preserveScroll:true});
        }catch(error){toast('上传未确认完成：'+(error.message||'请刷新目录核对。'));}
        finally{delete form.dataset.busy;if(button)button.disabled=false;}
        return;
      }
      if (context.eventType === 'submit' && context.name === 'search') {
        const form = context.target;
        return router.open('vault-home', params({
          kind: current.kind,
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
