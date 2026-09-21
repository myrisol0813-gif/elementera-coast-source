import { q } from '../../core/dom.js';
import { dateKey, lines } from './daily-format.js';

function commentStageLabel(error) {
  const stage = String(error?.details?.stage || '');
  return ({
    get_moment: '读取当前动态',
    list_moments: '读取朋友圈时间线',
    read_custom_instructions: '读取自定义指令',
    model_stream: '模型请求',
    normalize_comment: '整理评论',
  })[stage] || '';
}

function edgeDiagnostic(error) {
  const details = error?.details && typeof error.details === 'object' ? error.details : {};
  const build = String(details.backend_build || '').trim();
  const ray = String(details.cf_ray || '').trim();
  const contentType = String(details.content_type || '').split(';')[0].trim();
  console.warn('[daily-model-partner-comment-edge]', {
    status: error?.status || 0,
    backend_build: build || 'missing',
    cf_ray: ray || 'missing',
    server: details.server || '',
    content_type: contentType || 'missing',
    non_json_response: details.non_json_response === true,
  });
  if (build) return `后端 ${build}${ray ? ` · Ray ${ray}` : ''}`;
  return `未收到 Daily 后端版本标记${ray ? ` · Ray ${ray}` : ''}`;
}

function modelPartnerCommentError(error) {
  if (error?.type === 'missing_comment_model') return '先去主页选择一个聊天模型。';
  if (error?.type === 'empty_model_comment') return '另一位屋主这次没有生成可写入的评论。';
  if (error?.status === 502 && error?.type === 'request_failed') {
    return `另一位屋主留言失败：502（${edgeDiagnostic(error)}）。`;
  }
  const stage = commentStageLabel(error);
  return `另一位屋主留言失败${stage ? `（${stage}阶段）` : ''}：${error?.message || '服务器没有完成回复。'}`;
}

export function createDailyActions({
  state,
  client,
  router,
  toast,
  startLoad,
  persistCache,
  replaceMoment,
  replaceDiary,
  profile,
}) {
  async function deleteWith(request, apply, message) {
    try {
      const deleted = await request();
      if (!deleted) throw new Error('服务器没有确认删除。');
      apply();
      persistCache();
      toast(message);
      return router.refresh();
    } catch (error) {
      console.warn('[daily-delete]', error);
      toast(`删除失败：${error?.message || '服务器没有完成删除。'}`, 3600);
    }
  }

  async function saveMoment(target) {
    if (state.savingMoment) return;
    const id = target.dataset.id || '';
    const text = q('#momentText')?.value.trim() || '';
    if (!text) return toast('先写一点正文。');
    const value = { date: q('#momentDate')?.value || dateKey(), text, status: 'published' };
    state.savingMoment = true;
    target.disabled = true;
    try {
      const savedMoment = id ? await client.patchMoment(id, value) : await client.createMoment(value);
      if (id) {
        replaceMoment(savedMoment);
        toast('碳硅圈已经改好。');
      } else {
        state.moments = [savedMoment, ...state.moments];
        persistCache();
        try {
          const generated = await client.modelPartnerCommentMoment(savedMoment.id, { mode: 'instant' });
          replaceMoment(generated.moment);
          toast('碳硅圈已经写下，另一位屋主也留了一句。');
        } catch (error) {
          console.warn('[daily-instant-comment]', error);
          const message = modelPartnerCommentError(error);
          toast(message.startsWith('另一位屋主留言失败') ? `碳硅圈已经写下，但 ${message}` : message, 4200);
        }
      }
      return router.open('moments', {}, { replace: true });
    } finally {
      state.savingMoment = false;
      target.disabled = false;
    }
  }

  async function commentAsModelPartner(id) {
    if (!id || state.commentingMomentIds.has(id)) return;
    state.commentingMomentIds.add(id);
    await router.refresh({ preserveScroll: true });
    try {
      const generated = await client.modelPartnerCommentMoment(id, { mode: 'instant' });
      replaceMoment(generated.moment);
      toast('另一位屋主已经在下面留了一句。');
    } catch (error) {
      console.warn('[daily-model-partner-comment]', error);
      toast(modelPartnerCommentError(error), 4200);
    } finally {
      state.commentingMomentIds.delete(id);
      await router.refresh({ preserveScroll: true });
    }
  }

  async function editModelPartnerDisplayName() {
    const current = profile.modelPartnerDisplayName();
    const next = globalThis.prompt?.('另一位屋主在碳硅圈里的显示名称', current);
    if (next == null) return;
    try {
      await profile.saveModelPartnerDisplayName(next);
    } catch {
      // saveModelPartnerDisplayName already surfaced a readable error.
    }
  }

  async function saveDiary(target) {
    const id = target.dataset.id || '';
    const text = q('#diaryText')?.value.trim() || '';
    if (!text) return toast('先写一点日记正文。');
    const value = {
      date: q('#diaryDate')?.value || dateKey(),
      weather: q('#diaryWeather')?.value.trim() || '未标注',
      mood: q('#diaryMood')?.value.trim() || '未标注',
      text,
      tags: lines(q('#diaryTags')?.value).slice(0, 20),
    };
    const savedDiary = id ? await client.patchDiary(id, value) : await client.createDiary(value);
    if (id) replaceDiary(savedDiary);
    else {
      state.diaries = [savedDiary, ...state.diaries];
      persistCache();
    }
    toast(id ? '日记已经改好。' : '日记已经写下。');
    return router.open('diary', {}, { replace: true });
  }

  async function handleAction(name, target) {
    if (name === 'home') { void startLoad(true); return router.open('daily-home'); }
    if (name === 'reload') { state.loaded = false; await startLoad(true); return router.refresh(); }
    if (name === 'moments') { void startLoad(true); return router.open('moments'); }
    if (name === 'moments-compose') return router.open('moments-compose');
    if (name === 'edit-moment') return router.open('moments-compose', { id: target.dataset.id || '' });
    if (name === 'save-moment') return saveMoment(target);
    if (name === 'delete-moment') {
      const id = target.dataset.id;
      if (!id) return;
      return deleteWith(
        () => client.deleteMoment(id),
        () => { state.moments = state.moments.filter((entry) => entry.id !== id); },
        '这条碳硅圈已经删除。',
      );
    }
    if (name === 'toggle-moment') {
      const id = target.dataset.id;
      if (state.expandedMoments.has(id)) state.expandedMoments.delete(id);
      else state.expandedMoments.add(id);
      return router.refresh({ preserveScroll: true });
    }
    if (name === 'like') {
      const entry = state.moments.find((item) => item.id === target.dataset.id);
      if (!entry) return;
      replaceMoment(await client.setMomentLike(entry.id, !entry.liked));
      return router.refresh({ preserveScroll: true });
    }
    if (name === 'comment') {
      state.commentTarget = state.commentTarget === target.dataset.id ? '' : target.dataset.id;
      return router.refresh({ preserveScroll: true });
    }
    if (name === 'model-partner-comment') return commentAsModelPartner(target.dataset.id || '');
    if (name === 'edit-model-partner-name') return editModelPartnerDisplayName();
    if (name === 'send-comment') {
      const text = q('#momentCommentInput')?.value.trim() || '';
      if (!text) return toast('先写一句评论。');
      replaceMoment(await client.commentMoment(target.dataset.id, text));
      state.commentTarget = '';
      return router.refresh({ preserveScroll: true });
    }
    if (name === 'delete-comment') {
      const id = target.dataset.id;
      const commentId = target.dataset.commentId;
      if (!id || !commentId) return;
      replaceMoment(await client.deleteMomentComment(id, commentId));
      return router.refresh({ preserveScroll: true });
    }
    if (name === 'avatar') return profile.chooseProfileImage('owner_avatar_dataurl');
    if (name === 'model-partner-avatar') return profile.chooseProfileImage('model_partner_avatar_dataurl');
    if (name === 'cover') return profile.chooseProfileImage('moment_cover_dataurl');
    if (name === 'diary') { void startLoad(true); return router.open('diary'); }
    if (name === 'diary-compose') return router.open('diary-compose');
    if (name === 'edit-diary') return router.open('diary-compose', { id: target.dataset.id || '' });
    if (name === 'save-diary') return saveDiary(target);
    if (name === 'delete-diary') {
      const id = target.dataset.id;
      if (!id) return;
      return deleteWith(
        () => client.deleteDiary(id),
        () => { state.diaries = state.diaries.filter((entry) => entry.id !== id); },
        '这页日记已经删除。',
      );
    }
    if (name === 'pets') return router.open('daily-placeholder', { title: '宠物系统' });
    if (name === 'widgets') return router.open('daily-placeholder', { title: '未来小组件' });
  }

  return Object.freeze({ handleAction, saveMoment, saveDiary });
}
