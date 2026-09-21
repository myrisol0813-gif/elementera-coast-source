import { API, ApiError, requestJson } from '../core/api.js';
import { parseSseEventBlock } from '../core/stream-format.js';

function milliseconds(value) {
  const number = Date.parse(String(value || ''));
  return Number.isFinite(number) ? number : Date.now();
}

function usage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = {};
  for (const field of ['prompt_tokens', 'completion_tokens', 'reasoning_tokens', 'cached_tokens', 'total_tokens']) {
    const number = Number(value[field]);
    if (value[field] != null && Number.isFinite(number) && number >= 0) result[field] = Math.trunc(number);
  }
  return Object.keys(result).length ? result : null;
}

function moment(value = {}) {
  return {
    id: value.id,
    date: value.date,
    author: value.author,
    source: value.source,
    status: value.status || 'published',
    text: value.text || '',
    conversationId: value.conversation_id || null,
    sourceTurnId: value.source_turn_id || null,
    surface: value.surface || '',
    modelLabel: value.model_label || null,
    modelNickname: value.model_nickname || null,
    symbol: value.symbol || '',
    displayAuthor: value.display_author || '',
    createdAt: milliseconds(value.created_at),
    updatedAt: milliseconds(value.updated_at),
    liked: Boolean(value.liked),
    likeCount: Number(value.like_count || 0),
    comments: (Array.isArray(value.comments) ? value.comments : []).map((commentValue) => ({
      id: commentValue.id,
      who: commentValue.author === 'owner' ? '屋主' : '另一位屋主',
      author: commentValue.author,
      text: commentValue.text || '',
      modelId: commentValue.model_id || null,
      usage: usage(commentValue.usage),
      createdAt: milliseconds(commentValue.created_at),
    })),
  };
}

function diary(value = {}) {
  return {
    id: value.id,
    date: value.date,
    author: value.author,
    source: value.source,
    weather: value.weather || '未标注',
    mood: value.mood || '未标注',
    text: value.text || '',
    tags: Array.isArray(value.tags) ? value.tags : [],
    conversationId: value.conversation_id || null,
    sourceTurnId: value.source_turn_id || null,
    surface: value.surface || '',
    modelLabel: value.model_label || null,
    modelNickname: value.model_nickname || null,
    symbol: value.symbol || '',
    displayAuthor: value.display_author || '',
    createdAt: milliseconds(value.created_at),
    updatedAt: milliseconds(value.updated_at),
  };
}

function profile(value = {}) {
  const name = String(value.model_partner_display_name || '另一位屋主').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 80) || '另一位屋主';
  return {
    ownerAvatarDataurl: typeof value.owner_avatar_dataurl === 'string' ? value.owner_avatar_dataurl : '',
    modelPartnerAvatarDataurl: typeof value.model_partner_avatar_dataurl === 'string' ? value.model_partner_avatar_dataurl : '',
    momentCoverDataurl: typeof value.moment_cover_dataurl === 'string' ? value.moment_cover_dataurl : '',
    modelPartnerDisplayName: name,
    updatedAt: value.updated_at || null,
  };
}

function responseDiagnostic(response) {
  return {
    backend_build: response.headers.get('x-coast-daily-comment-build') || '',
    cf_ray: response.headers.get('cf-ray') || '',
    server: response.headers.get('server') || '',
    content_type: response.headers.get('content-type') || '',
  };
}

function parseCommentStream(raw) {
  let result = null;
  let streamError = null;
  for (const block of String(raw || '').split(/\r?\n\r?\n/)) {
    if (!block.trim()) continue;
    const parsed = parseSseEventBlock(block);
    if (!parsed) continue;
    if (parsed.event === 'result') result = parsed.data || null;
    if (parsed.event === 'error') streamError = parsed.data || null;
  }
  return { result, streamError };
}

async function requestModelPartnerComment(url, value) {
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
  const diagnostic = responseDiagnostic(response);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const error = data?.error;
    throw new ApiError(
      typeof error === 'string' ? error : error?.message || `请求失败（${response.status}）`,
      {
        type: error?.type || 'request_failed',
        status: response.status,
        details: { ...(error && typeof error === 'object' ? error : {}), ...diagnostic },
      },
    );
  }
  if (!response.body) {
    throw new ApiError('浏览器没有收到可读取的留言流。', {
      type: 'stream_unavailable',
      status: 502,
      details: diagnostic,
    });
  }
  const raw = await response.text();
  const { result, streamError } = parseCommentStream(raw);
  if (streamError) {
    throw new ApiError(streamError.message || '另一位屋主留言生成失败。', {
      type: streamError.type || 'request_failed',
      status: Number(streamError.status) || 500,
      details: {
        ...(streamError.details && typeof streamError.details === 'object' ? streamError.details : {}),
        ...diagnostic,
      },
    });
  }
  if (!result?.ok) {
    throw new ApiError('另一位屋主留言流提前结束。', {
      type: 'stream_incomplete',
      status: 502,
      details: diagnostic,
    });
  }
  return { ...result, diagnostic };
}

export function createDailyClient() {
  async function load() {
    const [momentsData, diariesData, profileData] = await Promise.all([
      requestJson(API.dailyMoments),
      requestJson(API.dailyDiaries),
      requestJson(API.dailyProfile),
    ]);
    return {
      moments: (momentsData.moments || []).map(moment),
      diaries: (diariesData.diaries || []).map(diary),
      profile: profile(profileData.profile || {}),
    };
  }

  async function saveProfile(value = {}) {
    const data = await requestJson(API.dailyProfile, { method: 'PUT', body: JSON.stringify({ profile: value }) });
    return profile(data.profile || {});
  }
  async function createMoment(value) {
    const data = await requestJson(API.dailyMoments, { method: 'POST', body: JSON.stringify(value) });
    return moment(data.moment);
  }
  async function patchMoment(id, value) {
    const data = await requestJson(`${API.dailyMoments}/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(value) });
    return moment(data.moment);
  }
  async function deleteMoment(id) {
    const data = await requestJson(`${API.dailyMoments}/${encodeURIComponent(id)}`, { method: 'DELETE' });
    return Boolean(data.deleted);
  }
  async function commentMoment(id, text, commentId = '') {
    const data = await requestJson(`${API.dailyMoments}/${encodeURIComponent(id)}/comments`, { method: 'POST', body: JSON.stringify({ id: commentId || undefined, text }) });
    return moment(data.moment);
  }
  async function deleteMomentComment(id, commentId) {
    const data = await requestJson(`${API.dailyMoments}/${encodeURIComponent(id)}/comments/${encodeURIComponent(commentId)}`, { method: 'DELETE' });
    return moment(data.moment);
  }
  async function modelPartnerCommentMoment(id, value = {}) {
    const data = await requestModelPartnerComment(`${API.dailyMoments}/${encodeURIComponent(id)}/model-partner-comment`, value);
    return { moment: moment(data.moment), comment: data.comment || null, model: data.model || value.model || '', diagnostic: data.diagnostic || null };
  }
  async function setMomentLike(id, liked) {
    const data = await requestJson(`${API.dailyMoments}/${encodeURIComponent(id)}/like`, { method: liked ? 'PUT' : 'DELETE' });
    return moment(data.moment);
  }
  async function createDiary(value) {
    const data = await requestJson(API.dailyDiaries, { method: 'POST', body: JSON.stringify(value) });
    return diary(data.diary);
  }
  async function patchDiary(id, value) {
    const data = await requestJson(`${API.dailyDiaries}/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(value) });
    return diary(data.diary);
  }
  async function deleteDiary(id) {
    const data = await requestJson(`${API.dailyDiaries}/${encodeURIComponent(id)}`, { method: 'DELETE' });
    return Boolean(data.deleted);
  }

  return Object.freeze({ load, saveProfile, createMoment, patchMoment, deleteMoment, commentMoment, deleteMomentComment, modelPartnerCommentMoment, setMomentLike, createDiary, patchDiary, deleteDiary });
}
