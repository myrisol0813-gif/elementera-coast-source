const STATE_KEY = 'elementera.local.v1';
const CURRENT_CONVERSATION_KEY = 'elementera.currentConversation';

const OLD_KEYS = Object.freeze({
  theme: 'gpt_like_shell_theme_clean_v1',
  avatar: 'gpt_like_assistant_avatar_dataurl_v1',
  userBubble: 'wolf_user_bubble_v092',
  accent: 'wolf_accent_v092',
  ownerAvatar: 'coast_avatar_owner_v099',
  ownerName: 'cw_name',
  ownerNote: 'cw_note',
  modelPartnerName: 'cs_name',
  modelPartnerPortrait: 'cs_portrait',
  modelPartnerNote: 'cs_note',
  systemDraft: 'cs_system',
  radio: 'coast_radio_rooms_v095',
  lighthouse: 'coast_lighthouse_rooms_v096',
  runControl: 'elementera.runControlSettings',
  currentConversation: 'ec.currentConversationId',
  olderConversation: 'coast_main_active_v097',
  mainWindows: 'coast_main_windows_v097',
  legacyMessages: 'gpt_like_test_window_messages_clean_v1',
  legacyMainState: 'ec.mainChat.turns.v2',
  lighthouseDraft: 'coast_lighthouse_draft_v095',
  dailyStatus: 'coast_daily_status_v095',
  modelBox: 'ec.modelBox.v1',
  currentChatModel: 'ec.currentChatModel',
  currentImageModel: 'ec.currentImageModel',
  oldModelLabel: 'wolf_model_v092',
  modelCatalog: 'ec.modelCatalog.cache',
});

function defaultRoom(kind) {
  const letter = kind === 'lighthouse';
  return {
    active: letter ? 'letter-default' : 'radio-default',
    rooms: [{
      id: letter ? 'letter-default' : 'radio-default',
      title: letter ? 'MCP 对话区' : '共通聊天室',
      messages: [],
      updatedAt: Date.now(),
    }],
  };
}

const ACTIVE_RUN_CONTROL_DEFAULTS = Object.freeze({
  recentTurns: 8,
  contextBudget: 6000,
  outputLength: 'auto',
  maxOutputTokens: 8000,
  creativity: 'balanced',
  streamingEnabled: false,
  soilBudget: 1800,
  seedCooldownTurns: 2,
  worldbookEnabled: true,
  worldbookLimit: 6,
  memoryLimit: 8,
});


function defaultDaily() {
  return {
    cache: { moments: [], diaries: [], syncedAt: 0 },
    momentCover: '',
  };
}

function defaults() {
  return {
    version: 2,
    preferences: {
      theme: 'light',
      userBubble: '',
      accent: '',
      ownerName: '屋主',
      ownerSignature: '屋主',
    },
    rooms: {
      radio: defaultRoom('radio'),
      lighthouse: defaultRoom('lighthouse'),
    },
    runControl: { ...ACTIVE_RUN_CONTROL_DEFAULTS },
    daily: defaultDaily(),
    letters: {},
    migration: { pending: false, profile: null },
  };
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value || '') ?? fallback;
  } catch {
    return fallback;
  }
}

function cleanText(value, limit = 12000) {
  return String(value || '').slice(0, limit);
}

function cleanId(value, fallback = '') {
  return String(value || fallback || '').replace(/[^\w:.-]/g, '_').slice(0, 160);
}

function normalizeRoom(value, kind) {
  const fallback = defaultRoom(kind);
  const rooms = Array.isArray(value?.rooms)
    ? value.rooms.filter((room) => room && typeof room.id === 'string').map((room) => ({
      id: room.id.slice(0, 160),
      title: String(room.title || (kind === 'lighthouse' ? 'MCP 对话区' : '共通聊天室')).slice(0, 80),
      messages: Array.isArray(room.messages)
        ? room.messages
          .filter((message) => message && typeof message.text === 'string')
          .slice(-200)
          .map((message) => ({
            from: String(message.from || '屋主').slice(0, 40),
            text: message.text.slice(0, 12000),
            at: Number(message.at || Date.now()),
          }))
        : [],
      updatedAt: Number(room.updatedAt || Date.now()),
    })) : [];
  if (!rooms.length) return fallback;
  const active = rooms.some((room) => room.id === value?.active) ? value.active : rooms[0].id;
  return { rooms, active };
}

function normalizeRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
}

function normalizeDailyCache(value) {
  const cache = value && typeof value === 'object' ? value : {};
  return {
    moments: (Array.isArray(cache.moments) ? cache.moments : []).slice(0, 300).map((moment) => ({
      id: cleanId(moment.id, `moment-${Number(moment.createdAt || Date.now())}`),
      date: String(moment.date || '').slice(0, 10),
      author: ['owner', 'model_partner', 'api', 'mcp'].includes(moment.author) ? moment.author : 'owner',
      source: ['manual', 'chat_tool', 'daily_summary'].includes(moment.source) ? moment.source : 'manual',
      status: ['draft', 'candidate', 'published'].includes(moment.status) ? moment.status : 'published',
      text: cleanText(moment.text),
      location: String(moment.location || '').slice(0, 120),
      reason: cleanText(moment.reason, 1000),
      createdAt: Number(moment.createdAt || Date.now()),
      updatedAt: Number(moment.updatedAt || moment.createdAt || Date.now()),
      publishedAt: moment.publishedAt ? Number(moment.publishedAt) : null,
      liked: Boolean(moment.liked),
      likeCount: Math.max(0, Number(moment.likeCount || 0)),
      comments: (Array.isArray(moment.comments) ? moment.comments : []).slice(-80).map((comment) => ({
        id: cleanId(comment.id, `comment-${Number(comment.createdAt || Date.now())}`),
        who: String(comment.who || '屋主').slice(0, 40),
        author: ['owner', 'model_partner', 'api', 'mcp'].includes(comment.author) ? comment.author : 'owner',
        text: cleanText(comment.text, 2000),
        modelId: String(comment.modelId || '').slice(0, 180),
        createdAt: Number(comment.createdAt || Date.now()),
      })),
    })),
    diaries: (Array.isArray(cache.diaries) ? cache.diaries : []).slice(0, 300).map((entry) => ({
      id: cleanId(entry.id, `diary-${Number(entry.updatedAt || Date.now())}`),
      date: String(entry.date || '').slice(0, 10),
      author: ['owner', 'model_partner', 'api', 'mcp'].includes(entry.author) ? entry.author : 'owner',
      source: ['manual', 'daily_summary'].includes(entry.source) ? entry.source : 'manual',
      weather: String(entry.weather || '未标注').slice(0, 80),
      mood: String(entry.mood || '未标注').slice(0, 120),
      text: cleanText(entry.text),
      createdAt: Number(entry.createdAt || entry.updatedAt || Date.now()),
      updatedAt: Number(entry.updatedAt || Date.now()),
    })),
    syncedAt: Math.max(0, Number(cache.syncedAt || 0)),
  };
}

function normalizeDaily(value) {
  const daily = value && typeof value === 'object' ? value : {};
  const cache = daily.cache && typeof daily.cache === 'object' ? daily.cache : {};
  return { cache: normalizeDailyCache(cache), momentCover: String(daily.momentCover || '') };
}

function normalize(value) {
  const base = defaults();
  return {
    version: 2,
    preferences: {
      theme: String(value?.preferences?.theme || base.preferences.theme),
      userBubble: String(value?.preferences?.userBubble || ''),
      accent: String(value?.preferences?.accent || ''),
      ownerName: String(value?.preferences?.ownerName || base.preferences.ownerName).slice(0, 80),
      ownerSignature: String(value?.preferences?.ownerSignature || value?.preferences?.ownerName || base.preferences.ownerSignature).slice(0, 80),
    },
    rooms: {
      radio: normalizeRoom(value?.rooms?.radio, 'radio'),
      lighthouse: normalizeRoom(value?.rooms?.lighthouse, 'lighthouse'),
    },
    runControl: Object.fromEntries(Object.keys(base.runControl).map((key) => [
      key,
      value?.runControl?.[key] ?? base.runControl[key],
    ])),
    daily: normalizeDaily(value?.daily),
    letters: value?.letters && typeof value.letters === 'object' ? value.letters : {},
    migration: {
      pending: Boolean(value?.migration?.pending),
      profile: value?.migration?.profile && typeof value.migration.profile === 'object' ? value.migration.profile : null,
    },
  };
}

function oldValue(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

const LEGACY_STARTER_MESSAGES = new Set([
  '这是唯一保留的 GPT-like 测试窗口。\n\n这个窗口会把对话保存在本机浏览器里；刷新页面、从侧边栏点回来，内容都会继续在这里。',
  '我们先把这个壳调到像移动端 ChatGPT。',
  '好。接下来主要检查输入栏高度、按钮位置、消息是否保存，以及主题是否舒服。',
]);

function cleanLegacyMessages(value) {
  return (Array.isArray(value) ? value : [])
    .filter((message) => message && ['user', 'assistant'].includes(message.role) && typeof message.content === 'string')
    .filter((message) => !LEGACY_STARTER_MESSAGES.has(message.content))
    .slice(-200)
    .map((message) => ({ role: message.role, content: message.content }));
}

function collectMigrationConversations() {
  const items = new Map();
  const activeId = oldValue(OLD_KEYS.currentConversation) || oldValue(OLD_KEYS.olderConversation) || 'main';
  const upsert = (id, patch = {}) => {
    const clean = String(id || activeId || 'main').replace(/[^\w:.-]/g, '_').slice(0, 160) || 'main';
    const current = items.get(clean) || { id: clean, title: '新聊天', messages: [], state: null };
    if (patch.title) current.title = String(patch.title).slice(0, 80);
    if (patch.messages?.length) current.messages = cleanLegacyMessages(patch.messages);
    if (patch.state?.turns) current.state = patch.state;
    items.set(clean, current);
  };

  const windows = parseJson(oldValue(OLD_KEYS.mainWindows), []);
  for (const window of Array.isArray(windows) ? windows : []) {
    if (window?.id) upsert(window.id, { title: window.title, messages: window.messages });
  }

  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index) || '';
    const prefix = key.startsWith('ec.chat.state.v3.')
      ? 'ec.chat.state.v3.'
      : key.startsWith('ec.mainChat.turns.v2.')
        ? 'ec.mainChat.turns.v2.'
        : '';
    if (!prefix) continue;
    const id = key.slice(prefix.length);
    const state = parseJson(oldValue(key), null);
    if (id && state?.turns) upsert(id, { state });
  }

  const singleState = parseJson(oldValue(OLD_KEYS.legacyMainState), null);
  if (singleState?.turns) upsert(activeId, { state: singleState });
  const messages = cleanLegacyMessages(parseJson(oldValue(OLD_KEYS.legacyMessages), []));
  if (messages.length) upsert(activeId, { messages });
  return [...items.values()];
}

function extractOldLetters(target) {
  const grouped = new Map();
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index) || '';
    if (!key.startsWith('coast_lovebook_v119::') && !key.startsWith('coast_island_letter_v118::')) continue;
    const parts = key.split('::');
    if (parts[0] === 'coast_island_letter_v118' && parts.length >= 3) {
      const windowId = parts[1];
      const model = parts.slice(2).join('::').replace(/^ChatGPT\s+/, '').replace(/\s*›\s*$/, '');
      const compound = `${windowId}::${model}`;
      const item = grouped.get(compound) || {};
      item.islandText = oldValue(key) || '';
      grouped.set(compound, item);
    }
    if (parts[0] === 'coast_lovebook_v119' && parts.length >= 4) {
      const windowId = parts[1];
      const name = parts.at(-1);
      const model = parts.slice(2, -1).join('::').replace(/^ChatGPT\s+/, '').replace(/\s*›\s*$/, '');
      const compound = `${windowId}::${model}`;
      const item = grouped.get(compound) || {};
      item[name] = oldValue(key) || '';
      grouped.set(compound, item);
    }
  }
  for (const [key, value] of grouped) target[key] = value;
}

function buildMigration() {
  const state = defaults();
  const stored = oldValue(STATE_KEY);
  if (stored) {
    const restored = normalize(parseJson(stored, state));
    return {
      state: restored,
      profile: restored.migration.profile,
      conversations: restored.migration.pending ? collectMigrationConversations() : [],
      pending: restored.migration.pending,
    };
  }

  state.preferences.theme = oldValue(OLD_KEYS.theme) || state.preferences.theme;
  state.preferences.userBubble = oldValue(OLD_KEYS.userBubble) || '';
  state.preferences.accent = oldValue(OLD_KEYS.accent) || '';
  state.preferences.ownerName = oldValue(OLD_KEYS.ownerName) || state.preferences.ownerName;
  state.preferences.ownerSignature = state.preferences.ownerName;
  state.rooms.radio = normalizeRoom(parseJson(oldValue(OLD_KEYS.radio), null), 'radio');
  state.rooms.lighthouse = normalizeRoom(parseJson(oldValue(OLD_KEYS.lighthouse), null), 'lighthouse');
  const lighthouseDraft = String(parseJson(oldValue(OLD_KEYS.lighthouseDraft), {})?.text || '').trim();
  if (lighthouseDraft) {
    const room = state.rooms.lighthouse.rooms[0];
    if (!room.messages.some((message) => message.text === lighthouseDraft)) {
      room.messages.push({ from: '屋主', text: lighthouseDraft.slice(0, 12000), at: Date.now() });
    }
  }
  state.runControl = { ...state.runControl, ...parseJson(oldValue(OLD_KEYS.runControl), {}) };
  extractOldLetters(state.letters);

  const modelBox = parseJson(oldValue(OLD_KEYS.modelBox), { chat: [], free: [], image: [] });
  const profile = {
    assistant_avatar_dataurl: oldValue(OLD_KEYS.avatar) || '',
    current_chat_model: oldValue(OLD_KEYS.currentChatModel) || '',
    current_image_model: oldValue(OLD_KEYS.currentImageModel) || '',
    model_box: modelBox,
  };
  state.migration = { pending: true, profile };
  return { state: normalize(state), profile, conversations: collectMigrationConversations(), pending: true };
}

function retiredKeys() {
  const keys = new Set(Object.values(OLD_KEYS));
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index) || '';
    if (/^(coast_lovebook_v119::|coast_island_letter_v118::|ec\.chat\.state\.v3\.|ec\.mainChat\.turns\.v2|gpt_like_test_window_messages_clean_v1)/.test(key)) keys.add(key);
  }
  return [...keys];
}

export function createStorage() {
  const migration = buildMigration();
  let state = migration.state;
  localStorage.setItem(STATE_KEY, JSON.stringify(state));

  function save() {
    state = normalize(state);
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
    return state;
  }

  return Object.freeze({
    read: () => state,
    update(mutator) {
      mutator(state);
      return save();
    },
    migrationProfile: migration.profile,
    migrationConversations: migration.conversations,
    migrationPending: migration.pending,
    completeMigration() {
      if (!migration.pending) return;
      state.migration = { pending: false, profile: null };
      save();
      for (const key of retiredKeys()) localStorage.removeItem(key);
      migration.pending = false;
      migration.profile = null;
    },
    getCurrentConversation() {
      return oldValue(CURRENT_CONVERSATION_KEY)
        || oldValue(OLD_KEYS.currentConversation)
        || oldValue(OLD_KEYS.olderConversation)
        || '';
    },
    setCurrentConversation(value) {
      localStorage.setItem(CURRENT_CONVERSATION_KEY, String(value || ''));
    },
  });
}
