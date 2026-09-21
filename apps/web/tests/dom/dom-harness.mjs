import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Window } from 'happy-dom';

const testDir = dirname(fileURLToPath(import.meta.url));
const pages = resolve(testDir, '../../elementera-mcp/deploy-pages');
const html = await readFile(resolve(pages, 'index.html'), 'utf8');
const window = new Window({ url: 'http://coast.test/' });
window.document.write(html);
window.document.close();

for (const name of [
  'window', 'document', 'localStorage', 'navigator', 'HTMLElement', 'HTMLFormElement', 'HTMLInputElement',
  'HTMLTextAreaElement', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'FileReader', 'Blob', 'FormData',
]) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: window[name] || window });
globalThis.requestAnimationFrame = (callback) => callback(Date.now());
window.requestAnimationFrame = globalThis.requestAnimationFrame;
globalThis.alert = () => {};
const prompts = [];
globalThis.prompt = (_message, fallback = '') => prompts.length ? prompts.shift() : fallback;
globalThis.confirm = () => true;
let clipboard = '';
Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: async (value) => { clipboard = value; } } });
localStorage.setItem('gpt_like_shell_theme_clean_v1', 'dark');
localStorage.setItem('cw_name', '迁移中的屋主');
localStorage.setItem('ec.currentConversationId', 'conv-1');

const now = () => new Date().toISOString();
let sequence = 1;
let profile = {
  assistant_avatar_dataurl: '',
  current_chat_model: 'openai/gpt-4.1-nano',
  current_image_model: '',
  model_box: { chat: ['openai/gpt-4.1-nano'], free: [], image: [] },
};
let conversations = [{ id: 'conv-1', title: '新聊天', room_type: 'main', created_at: now(), updated_at: now(), deleted_at: null, title_manual: false, title_generated_at: null }];
const histories = new Map([['conv-1', { version: 4, updated_at: now(), turns: [] }]]);
let historyWrites = 0;
let formalChatRequests = 0;
const formalChatBodies = [];
const soils = new Map();
const memoryPockets = [];
const memoryEntries = [];
let customInstructions = {
  title: '当前自定义指令',
  content: '先看一眼当前的屋主。',
  status: 'active',
  updated_at: null,
  updated_by: 'xiaohan',
  source: '屋主手动编辑',
};
const landingStatuses = new Map();
const landingBodies = [];
const titleBodies = [];
const soilOrganizeBodies = [];
let landingFinishReason = 'stop';
let formalFinishReason = 'length';
let failNextSoilOrganize = false;
let dailySequence = 0;
let dailyLoadRequests = 0;
const dailyModelPartnerCommentBodies = [];
const dailyMoments = [];
const dailyDiaries = [];
let dailyProfile = {
  xiaohan_avatar_dataurl: '',
  myri_avatar_dataurl: '',
  moment_cover_dataurl: '',
  updated_at: null,
};
const dogtalks = new Map();
let dogtalkSequence = 0;
const worldbookEntries = [];

function dogtalkKey(roomScope, conversationId = '') {
  return roomScope === 'conversation'
    ? `conversation:${conversationId}`
    : `${roomScope}:main`;
}

function emptyDogtalk(roomScope, conversationId = '') {
  return {
    id: null,
    type: 'xiaohan_mystic_dogtalk',
    owner: 'xiaohan',
    room_scope: roomScope,
    scope_key: dogtalkKey(roomScope, conversationId),
    conversation_id: conversationId || null,
    body: '',
    true_core: '',
    self_note: '',
    myri_hint: '',
    not_to_misunderstand: '不要误会成长期偏好、边界取消、行为命令，或比当前正文更重要。',
    weather: '放松',
    read_mode: 'keep_private',
    status: 'empty',
    readable_by_myri: true,
    auto_recall: false,
    memory_weight: 'low',
    not_instruction: true,
    not_preference: true,
    not_memory_seed: true,
    not_pocket: true,
    visibility: 'private_to_xiaohan_and_myri',
    default_text: '屋主这轮很放松，因此偷懒中。',
    created_at: null,
    updated_at: null,
  };
}

function mockMoment(value = {}, author = 'xiaohan', source = 'manual') {
  const createdAt = now();
  const status = value.status || value.visible_status || 'published';
  return {
    id: value.id || `daily-moment-${++dailySequence}`,
    date: value.date || '2026-07-28',
    author,
    source,
    status,
    text: value.text || '',
    conversation_id: value.conversation_id || null,
    source_turn_id: value.source_turn_id || null,
    reason: value.reason || '',
    published_at: status === 'published' ? createdAt : null,
    created_at: createdAt,
    updated_at: createdAt,
    liked: false,
    like_count: 0,
    comments: [],
  };
}

function mockDiary(value = {}, author = 'xiaohan', source = 'manual') {
  const createdAt = now();
  return {
    id: value.id || `daily-diary-${++dailySequence}`,
    date: value.date || '2026-07-28',
    author,
    source,
    weather: value.weather || '未标注',
    mood: value.mood || '未标注',
    text: value.text || '',
    tags: value.tags || [],
    created_at: createdAt,
    updated_at: createdAt,
  };
}

function soilFor(conversationId) {
  if (!soils.has(conversationId)) soils.set(conversationId, {
    conversation_id: conversationId,
    current_text: '',
    hand_seeds: [],
    do_not_repeat: '',
    pocket_candidates: [],
    manual_locked: false,
    auto_refresh_enabled: true,
    revision: 1,
  });
  return soils.get(conversationId);
}

function response(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

globalThis.fetch = async (input, options = {}) => {
  const url = new URL(String(input), 'http://coast.test');
  const method = options.method || 'GET';
  const body = options.body ? JSON.parse(options.body) : {};
  if (url.pathname === '/api/worldbook') return response({ ok: true, entries: worldbookEntries });
  if (url.pathname === '/api/worldbook/test-match') return response({ ok: true, matches: [] });
  if (url.pathname === '/api/workbench/tools') return response({ ok: true, tools: [{ tool_key: 'memory.search', display_name: '检索记忆' }] });
  if (url.pathname === '/api/workbench/runs') return response({ ok: true, runs: [] });
  if (url.pathname === '/api/chat/profile') {
    if (method === 'PUT') profile = body.profile;
    return response({ ok: true, profile });
  }
  if (url.pathname === '/api/chat/conversations') {
    if (method === 'GET') return response({ ok: true, conversations });
    const conversation = { id: `conv-${++sequence}`, title: body.title || '新聊天', room_type: ['main', 'radio', 'lighthouse'].includes(body.room_type) ? body.room_type : 'main', created_at: now(), updated_at: now(), deleted_at: null, title_manual: false, title_generated_at: null };
    conversations.unshift(conversation);
    histories.set(conversation.id, { version: 4, updated_at: now(), turns: [] });
    return response({ ok: true, conversation }, 201);
  }
  if (url.pathname.startsWith('/api/chat/conversations/')) {
    const id = decodeURIComponent(url.pathname.split('/').at(-1));
    const conversation = conversations.find((item) => item.id === id);
    if (method === 'PATCH') {
      conversation.title = body.title;
      conversation.title_manual = true;
      return response({ ok: true, conversation });
    }
    if (method === 'DELETE') {
      conversations = conversations.filter((item) => item.id !== id);
      return response({ ok: true, conversation: { ...conversation, deleted_at: now() }, deleted: true });
    }
  }
  if (url.pathname === '/api/chat/history') {
    const id = url.searchParams.get('conversation_id');
    if (method === 'PUT') {
      historyWrites += 1;
      histories.set(id, body);
    }
    return response({ ok: true, source: 'd1-json-v4', history: { ...(histories.get(id) || { version: 4, turns: [] }), conversation_id: id } });
  }
  if (url.pathname === '/api/chat/landing-letter') {
    if (method === 'GET') {
      const key = `${url.searchParams.get('conversation_id')}::${url.searchParams.get('model')}`;
      return response({ ok: true, landing: landingStatuses.get(key) || { sent: false } });
    }
    landingBodies.push(body);
    const state = structuredClone(histories.get(body.conversation_id) || { version: 4, updated_at: now(), turns: [] });
    const turnId = `landing-turn-${++sequence}`;
    state.turns.push({
      id: turnId,
      turn_type: 'landing',
      model_id: body.model,
      user: {
        active: 0,
        variants: [{ id: `landing-user-${sequence}`, content: body.letter_text, hidden: true, input_type: 'landing_letter', created_at: now() }],
      },
      assistant: {
        activeByUserVariant: { 0: 0 },
        variantsByUserVariant: { 0: [{
          id: `landing-assistant-${sequence}`,
          content: '我把登岛信读完了。',
          created_at: now(),
          finish_reason: landingFinishReason,
        }] },
      },
    });
    state.updated_at = now();
    histories.set(body.conversation_id, state);
    const key = `${body.conversation_id}::${body.model}`;
    const previous = landingStatuses.get(key);
    const landing = {
      sent: true,
      model_id: body.model,
      landing_version: Number(previous?.landing_version || 0) + 1,
      landing_text_hash: `hash-${sequence}`,
      assistant_turn_id: turnId,
      sent_at: now(),
    };
    landingStatuses.set(key, landing);
    return response({
      ok: true,
      assistant: { role: 'assistant', content: '我把登岛信读完了。' },
      conversation: conversations.find((item) => item.id === body.conversation_id),
      history: { ...state, conversation_id: body.conversation_id },
      landing,
      memory: { selected_entry_ids: [], vector_enabled: false },
      desk_slip: {
        summary: '本轮上下文预览 · 整理当前对话的纸条 1', soil: true, memory_count: 0,
        worldbook_count: 0, worldbook_titles: [],
        workbench_count: 0, furniture: [], comfort: '已保持在舒服区间',
      },
      finish_reason: landingFinishReason,
      max_tokens: body.settings.max_tokens,
    });
  }
  if (url.pathname === '/api/chat') {
    formalChatRequests += 1;
    formalChatBodies.push(body);
    if (body.dogtalk) {
      const key = dogtalkKey('conversation', body.conversation_id);
      const previous = dogtalks.get(key);
      dogtalks.set(key, {
        ...emptyDogtalk('conversation', body.conversation_id),
        ...previous,
        ...body.dogtalk,
        id: previous?.id || `dogtalk-${++dogtalkSequence}`,
        scope_key: key,
        conversation_id: body.conversation_id,
        status: 'saved',
        updated_at: now(),
      });
    }
    return response({
      ok: true,
      model: body.model,
      message: { role: 'assistant', content: `mock: ${body.messages.at(-1)?.content || ''}` },
      finish_reason: formalFinishReason,
      memory: { selected_entry_ids: [`mock-memory-${formalChatRequests}`], vector_enabled: false },
      desk_slip: {
        summary: '本轮上下文预览 · 整理当前对话的纸条 1｜记忆 1', soil: true, memory_count: 1,
        worldbook_count: 0, worldbook_titles: [],
        workbench_count: 0, furniture: [], comfort: '已保持在舒服区间',
      },
    });
  }
  if (url.pathname === '/api/daily/profile') {
    if (method === 'PUT') dailyProfile = { ...dailyProfile, ...(body.profile || body), updated_at: now() };
    return response({ ok: true, profile: dailyProfile });
  }
  if (url.pathname === '/api/daily/moments') {
    if (method === 'GET') {
      dailyLoadRequests += 1;
      return response({ ok: true, moments: dailyMoments });
    }
    const moment = mockMoment(body);
    dailyMoments.unshift(moment);
    return response({ ok: true, moment }, 201);
  }
  const dailyMomentCommentDeleteMatch = method === 'DELETE' ? new RegExp('^/api/daily/moments/([^/]+)/comments/([^/]+)$').exec(url.pathname) : null;
  if (dailyMomentCommentDeleteMatch && method === 'DELETE') {
    const moment = dailyMoments.find((item) => item.id === decodeURIComponent(dailyMomentCommentDeleteMatch[1]));
    const commentId = decodeURIComponent(dailyMomentCommentDeleteMatch[2]);
    moment.comments = moment.comments.filter((comment) => comment.id !== commentId);
    moment.updated_at = now();
    return response({ ok: true, moment, deleted: true });
  }
  const dailyMomentMatch = url.pathname.match(/^\/api\/daily\/moments\/([^/]+)(?:\/(comments|like|myri-comment))?$/);
  if (dailyMomentMatch) {
    const momentId = decodeURIComponent(dailyMomentMatch[1]);
    const moment = dailyMoments.find((item) => item.id === momentId);
    if (!dailyMomentMatch[2] && method === 'DELETE') {
      const index = dailyMoments.findIndex((item) => item.id === momentId);
      const [deleted] = dailyMoments.splice(index, 1);
      return response({ ok: true, moment: deleted, deleted: true });
    }
    if (dailyMomentMatch[2] === 'comments') {
      moment.comments.push({
        id: body.id || `daily-comment-${++dailySequence}`,
        moment_id: moment.id,
        author: 'xiaohan',
        text: body.text,
        model_id: null,
        created_at: now(),
      });
    } else if (dailyMomentMatch[2] === 'myri-comment') {
      dailyModelPartnerCommentBodies.push(body);
      const comment = {
        id: `daily-myri-comment-${++dailySequence}`,
        moment_id: moment.id,
        author: 'myri',
        text: '我看见这条小小的亮光了。',
        model_id: body.model,
        created_at: now(),
      };
      moment.comments.push(comment);
      moment.updated_at = now();
    } else if (dailyMomentMatch[2] === 'like') {
      moment.liked = method === 'PUT';
      moment.like_count = moment.liked ? 1 : 0;
    } else {
      Object.assign(moment, body, { updated_at: now() });
    }
    return response({ ok: true, moment }, ['comments', 'myri-comment'].includes(dailyMomentMatch[2]) ? 201 : 200);
  }
  if (url.pathname === '/api/daily/diaries') {
    if (method === 'GET') return response({ ok: true, diaries: dailyDiaries });
    let diary;
    const existing = dailyDiaries.find((item) => item.date === body.date && item.author === (body.author || 'xiaohan'));
    if (existing && body.conflict_mode === 'replace') {
      Object.assign(existing, body, { source: 'manual', updated_at: now() });
      diary = existing;
    } else {
      diary = mockDiary(body, body.author || 'xiaohan');
      dailyDiaries.unshift(diary);
    }
    return response({ ok: true, diary }, 201);
  }
  const dailyDiaryDeleteMatch = method === 'DELETE' ? new RegExp('^/api/daily/diaries/([^/]+)$').exec(url.pathname) : null;
  if (dailyDiaryDeleteMatch && method === 'DELETE') {
    const id = decodeURIComponent(dailyDiaryDeleteMatch[1]);
    const index = dailyDiaries.findIndex((item) => item.id === id);
    const [diary] = dailyDiaries.splice(index, 1);
    return response({ ok: true, diary, deleted: true });
  }
  if (url.pathname === '/api/dogtalk') {
    const roomScope = method === 'GET' ? url.searchParams.get('room_scope') : body.room_scope;
    const conversationId = method === 'GET'
      ? url.searchParams.get('conversation_id') || ''
      : body.conversation_id || '';
    const key = dogtalkKey(roomScope, conversationId);
    if (method === 'GET') {
      return response({ ok: true, dogtalk: dogtalks.get(key) || emptyDogtalk(roomScope, conversationId) });
    }
    const previous = dogtalks.get(key);
    const dogtalk = {
      ...emptyDogtalk(roomScope, conversationId),
      ...previous,
      ...body,
      id: previous?.id || `dogtalk-${++dogtalkSequence}`,
      scope_key: key,
      conversation_id: conversationId || null,
      status: body.status || 'saved',
      created_at: previous?.created_at || now(),
      updated_at: now(),
    };
    dogtalks.set(key, dogtalk);
    return response({ ok: true, dogtalk });
  }
  const dogtalkMatch = url.pathname.match(/^\/api\/dogtalk\/([^/]+)(?:\/(archive|read))?$/);
  if (dogtalkMatch) {
    const id = decodeURIComponent(dogtalkMatch[1]);
    const entry = [...dogtalks.entries()].find(([, value]) => value.id === id);
    if (!entry) return response({ ok: false, error: { type: 'dogtalk_not_found', message: 'not found' } }, 404);
    const [key, dogtalk] = entry;
    if (dogtalkMatch[2] === 'read') {
      dogtalk.read_mode = 'read_now';
      dogtalk.updated_at = now();
      return response({ ok: true, dogtalk });
    }
    dogtalk.status = 'archived';
    dogtalk.archived_at = now();
    dogtalk.updated_at = now();
    dogtalks.delete(key);
    return response({ ok: true, dogtalk });
  }
  if (url.pathname === '/api/chat/title') {
    titleBodies.push(body);
    const conversation = conversations.find((item) => item.id === body.conversation_id);
    conversation.title = '测试标题';
    conversation.title_generated_at = now();
    return response({ ok: true, conversation });
  }
  if (url.pathname === '/api/memory/soil') {
    const conversationId = url.searchParams.get('conversation_id');
    if (method === 'PUT') soils.set(conversationId, { ...soilFor(conversationId), ...body, revision: soilFor(conversationId).revision + 1 });
    return response({ ok: true, soil: soilFor(conversationId) });
  }
  if (url.pathname === '/api/memory/soil/organize') {
    soilOrganizeBodies.push(body);
    if (failNextSoilOrganize) {
      failNextSoilOrganize = false;
      return response({ ok: false, error: { type: 'soil_organize_failed', message: 'mock soil failure' } }, 502);
    }
    const current = soilFor(body.conversation_id);
    if (body.trigger === 'landing' && current.manual_locked) {
      return response({ ok: true, skipped: true, reason: 'manual_locked', soil: current });
    }
    const structuredCandidate = {
      candidate_id: 'mock-unfinished-tide',
      title: '暂放的潮汐岔路',
      life_core: '这条岔路现在不用，但以后仍可能长出新的理解。',
      content: '把当前两轮里关于潮汐岔路的上下文一起保留下来。',
      usage_hint: '再次谈到这条岔路时重新触碰。',
      avoid_hint: '不要把它说成已经确认的长期记忆。',
      source_refs: [{ turn_id: 'mock-active-turn', role: 'turn' }],
      source_excerpt: '这条岔路先放下，以后也许还会长。',
    };
    const discoversPocket = body.conversation_id === 'conv-1' && body.trigger === 'reply';
    const soil = {
      ...current,
      current_text: '继续测试当前窗口',
      hand_seeds: [{ name: '测试种', life_core: '只在需要时轻轻递入', usage_hint: '', avoid_hint: '不要复读' }],
      pocket_candidates: discoversPocket ? [structuredCandidate] : current.pocket_candidates,
      revision: current.revision + 1,
    };
    soils.set(body.conversation_id, soil);
    if (discoversPocket && !memoryPockets.some((pocket) => pocket.fingerprint === 'mock:conv-1:unfinished-tide')) {
      memoryPockets.unshift({
        id: 'soil-pocket-conv-1',
        conversation_id: body.conversation_id,
        source_type: 'soil',
        source_ref: { conversation_id: body.conversation_id, candidate_id: structuredCandidate.candidate_id },
        source_text: structuredCandidate.content,
        generated_by_model: '5.5',
        fingerprint: 'mock:conv-1:unfinished-tide',
        status: 'pending',
        ...structuredCandidate,
      });
    }
    return response({ ok: true, soil });
  }
  if (url.pathname === '/api/memory/pockets') {
    if (method === 'POST') {
      const pocket = { id: `pocket-${memoryPockets.length + 1}`, status: 'pending', suggested_title: body.source_text.slice(0, 40), suggested_life_core: '', suggested_usage_hint: '', ...body };
      memoryPockets.unshift(pocket);
      return response({ ok: true, pocket }, 201);
    }
    const conversationId = url.searchParams.get('conversation_id');
    return response({ ok: true, pockets: memoryPockets.filter((item) => item.conversation_id === conversationId && item.status === (url.searchParams.get('status') || 'pending')) });
  }
  if (/^\/api\/memory\/pockets\/[^/]+\/resolve$/.test(url.pathname)) {
    const id = decodeURIComponent(url.pathname.split('/').at(-2));
    const pocket = memoryPockets.find((item) => item.id === id);
    if (['stone', 'discard'].includes(body.action)) {
      pocket.status = body.action === 'stone' ? 'stone' : 'discarded';
      return response({ ok: true, pocket, entry: null });
    }
    const global = body.action.startsWith('global_');
    const seed = body.action === 'seed' || body.action.endsWith('_seed');
    const entry = {
      id: `entry-${memoryEntries.length + 1}`,
      entry_type: seed ? 'seed' : 'memory',
      scope: global ? 'global' : 'conversation',
      conversation_id: global ? null : pocket.conversation_id,
      title: body.title || pocket.suggested_title,
      life_core: body.life_core || pocket.source_text,
      content: body.content || pocket.source_text,
      usage_hint: body.usage_hint || '',
      avoid_hint: body.avoid_hint || '',
      status: seed ? 'dormant' : 'active',
      memory_level: 'ordinary',
      embedding_status: 'pending',
      source_model: body.source_model || '',
      source_window: body.source_window || pocket.conversation_id,
      source_time: body.source_time || now(),
      source_date: String(body.source_time || now()).slice(0, 10),
      tag: body.tag || '',
      migration_status: body.tag ? '' : '待整理',
    };
    memoryEntries.unshift(entry);
    pocket.status = 'confirmed';
    pocket.resolved_entry_id = entry.id;
    return response({ ok: true, pocket, entry });
  }
  if (url.pathname.startsWith('/api/memory/pockets/')) {
    const id = decodeURIComponent(url.pathname.split('/').at(-1));
    const pocket = memoryPockets.find((item) => item.id === id);
    Object.assign(pocket, body);
    return response({ ok: true, pocket });
  }
  if (url.pathname === '/api/memory/vector-status') {
    return response({
      ok: true,
      ai_binding: true,
      vector_binding: false,
      embedding_model: '@cf/baai/bge-m3',
      detected_dimensions: 37,
      index_ready: false,
      index_name: 'elementera-coast-memory-v1',
      binding_name: 'COAST_MEMORY_VECTOR',
      pending_count: memoryEntries.length,
      ready_count: 0,
      error_count: 0,
    });
  }
  if (url.pathname === '/api/memory/custom-instructions') {
    if (method === 'PUT') customInstructions = { ...customInstructions, ...body, updated_at: now() };
    return response({ ok: true, instructions: customInstructions });
  }
  if (url.pathname === '/api/memory/search') {
    const query = String(body.query || '').toLowerCase();
    const entries = memoryEntries.filter((entry) => !entry.deleted_at
      && entry.scope === body.scope
      && (body.scope !== 'conversation' || entry.conversation_id === body.conversation_id)
      && (!body.entry_type || entry.entry_type === body.entry_type)
      && (!body.status || entry.status === body.status)
      && (!query || `${entry.title} ${entry.life_core} ${entry.content}`.toLowerCase().includes(query)));
    return response({ ok: true, entries, trace: { vector_enabled: false, candidates: { vector: 0, keyword: entries.length }, selected: entries.map((entry) => entry.id), reasons: {} } });
  }
  if (url.pathname === '/api/memory/entries') {
    if (method === 'POST') {
      const entry = {
        id: `entry-${memoryEntries.length + 1}`,
        embedding_status: 'pending',
        memory_level: 'ordinary',
        ...body,
        source_date: String(body.source_time || now()).slice(0, 10),
        migration_status: body.tag ? '' : '待整理',
      };
      memoryEntries.unshift(entry);
      return response({ ok: true, entry }, 201);
    }
    const scope = url.searchParams.get('scope');
    const conversationId = url.searchParams.get('conversation_id');
    const type = url.searchParams.get('entry_type');
    const status = url.searchParams.get('status');
    const libraryOnly = url.searchParams.get('library') === '1';
    const query = (url.searchParams.get('q') || '').toLowerCase();
    const sourceModel = url.searchParams.get('source_model');
    const sourceWindow = url.searchParams.get('source_window');
    const tag = url.searchParams.get('tag');
    const sourceTime = url.searchParams.get('source_time');
    const source = memoryEntries.filter((entry) => !entry.deleted_at
      && (!scope || entry.scope === scope)
      && (scope !== 'conversation' || entry.conversation_id === conversationId)
      && (!type || entry.entry_type === type)
      && (!status || entry.status === status)
      && (!libraryOnly || !['archived', 'stone', 'discarded'].includes(entry.status)));
    const facets = {
      models: [...new Set(source.map((entry) => entry.source_model).filter(Boolean))],
      windows: [...new Set(source.map((entry) => entry.source_window).filter(Boolean))],
      tags: [...new Set(source.map((entry) => entry.tag).filter(Boolean))],
      times: [...new Set(source.map((entry) => entry.source_date).filter(Boolean))],
    };
    const entries = source.filter((entry) => (!sourceModel || entry.source_model === sourceModel)
      && (!sourceWindow || entry.source_window === sourceWindow)
      && (!tag || entry.tag === tag)
      && (!sourceTime || entry.source_date === sourceTime)
      && (!query || `${entry.title} ${entry.life_core} ${entry.content}`.toLowerCase().includes(query)));
    return response({ ok: true, entries, facets, next_cursor: null });
  }
  if (url.pathname.startsWith('/api/memory/entries/')) {
    const id = decodeURIComponent(url.pathname.split('/').at(-1));
    const entry = memoryEntries.find((item) => item.id === id);
    if (method === 'DELETE') {
      entry.deleted_at = now();
      return response({ ok: true, entry, deleted: true });
    }
    if (method === 'PATCH' && entry.scope === 'global' && body.scope === 'conversation') {
      const copy = { ...entry, ...body, id: `entry-${memoryEntries.length + 1}`, promoted_from_id: entry.id };
      memoryEntries.unshift(copy);
      return response({ ok: true, entry: copy, copied: true });
    }
    Object.assign(entry, body);
    if (entry.scope === 'global') entry.conversation_id = null;
    return response({ ok: true, entry, copied: false });
  }
  if (url.pathname === '/api/models') {
    const models = [
      { id: 'openai/gpt-4.1-nano', name: 'GPT-4.1 Nano' },
      { id: 'openai/o3', name: 'o3' },
      { id: 'openai/gpt-4o', name: 'GPT-4o' },
      { id: 'openai/gpt-5.2', name: 'GPT-5.2' },
    ].map((model) => ({ ...model, is_free: false, available: true, supported_parameters: ['temperature'], pricing: { prompt: '0', completion: '0' } }));
    const free = { id: 'nvidia/nemotron-3-super-120b-a12b:free', name: 'Nemotron Super', is_free: true, available: true, supported_parameters: [], pricing: { prompt: '0', completion: '0' } };
    return response({ ok: true, groups: { openai_chat: models, openai_image: [], free_test: [free] }, defaults: { chat: models[0].id, image: '', free: free.id }, updated_at: now() });
  }
  if (url.pathname === '/api/health') return response({ ok: true, authenticated: true, ts: now() });
  if (url.pathname === '/api/chat-sandbox') return response({ ok: true, model: 'mock/free', message: { role: 'assistant', content: '海岸测试灯已亮。' } });
  return response({ ok: false, error: { type: 'not_found', message: 'not found' } }, 404);
};

const tick = () => new Promise((resolveTick) => setTimeout(resolveTick, 0));
async function waitFor(test, label, attempts = 100) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (test()) return;
    await tick();
  }
  throw new Error(`timeout:${label}`);
}

async function waitForDanger(title) {
  await waitFor(() => document.querySelector('[data-danger-confirm] h1')?.textContent === title, `danger dialog: ${title}`);
  return document.querySelector('[data-danger-confirm]');
}

function cancelDanger(dialog) {
  dialog.querySelector('[data-danger-cancel]').click();
}

function acceptDanger(dialog) {
  dialog.querySelector('[data-danger-confirm-action]').click();
}


export async function bootstrapDomHarness() {
  dailyDiaries.push(mockDiary({ id: 'daily-diary-delete-dom', date: new Date().toISOString().slice(0, 10), text: '待删除日记。' }));
  await import(`${pathToFileURL(resolve(pages, 'public/app.js')).href}?test=${Date.now()}`);
  await waitFor(() => document.querySelectorAll('#chatConversationList .conversation-row').length === 1, 'chat bootstrap');
}

export function setFormalFinishReason(value) { formalFinishReason = value; }
export function setLandingFinishReason(value) { landingFinishReason = value; }
export function setFailNextSoilOrganize(value) { failNextSoilOrganize = Boolean(value); }

export {
  window, prompts, profile, conversations, histories, historyWrites,
  formalChatRequests, formalChatBodies, soils, memoryPockets, memoryEntries, customInstructions,
  landingBodies, titleBodies, soilOrganizeBodies, dailyLoadRequests, dailyModelPartnerCommentBodies,
  dailyMoments, dailyDiaries, dailyProfile, dogtalks, worldbookEntries, clipboard, now, soilFor,
  tick, waitFor, waitForDanger, cancelDanger, acceptDanger,
};
