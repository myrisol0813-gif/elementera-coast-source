const STATE_KEY = 'elementera.source.local.v1';
const CURRENT_CONVERSATION_KEY = 'elementera.source.currentConversation';
const ACTORS = new Set(['owner', 'assistant']);

const RUN_CONTROL_DEFAULTS = Object.freeze({
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

function defaultRoom(id, title) {
  return { id, title, messages: [], updatedAt: Date.now() };
}

function defaults() {
  return {
    version: 1,
    preferences: {
      theme: 'light',
      userBubble: '',
      accent: '',
      ownerName: 'Owner',
      assistantName: 'Assistant',
    },
    rooms: {
      main: defaultRoom('main', 'Main Chat'),
      relay: defaultRoom('relay', 'Relay Room'),
      bridge: defaultRoom('bridge', 'Chat Bridge'),
    },
    runControl: { ...RUN_CONTROL_DEFAULTS },
    letters: {},
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

function normalizeMessage(value = {}) {
  const actor = ACTORS.has(value.actor) ? value.actor : 'owner';
  const text = cleanText(value.text ?? value.content);
  if (!text) return null;
  return {
    id: cleanId(value.id, `message-${Date.now()}`),
    actor,
    text,
    at: Math.max(0, Number(value.at || Date.now())),
  };
}

function normalizeRoom(value, fallback) {
  const room = value && typeof value === 'object' ? value : fallback;
  return {
    id: fallback.id,
    title: String(room.title || fallback.title).slice(0, 80),
    messages: (Array.isArray(room.messages) ? room.messages : [])
      .map(normalizeMessage)
      .filter(Boolean)
      .slice(-200),
    updatedAt: Math.max(0, Number(room.updatedAt || Date.now())),
  };
}

function normalize(value) {
  const base = defaults();
  return {
    version: 1,
    preferences: {
      theme: String(value?.preferences?.theme || base.preferences.theme),
      userBubble: String(value?.preferences?.userBubble || ''),
      accent: String(value?.preferences?.accent || ''),
      ownerName: String(value?.preferences?.ownerName || base.preferences.ownerName).slice(0, 80),
      assistantName: String(value?.preferences?.assistantName || base.preferences.assistantName).slice(0, 80),
    },
    rooms: {
      main: normalizeRoom(value?.rooms?.main, base.rooms.main),
      relay: normalizeRoom(value?.rooms?.relay, base.rooms.relay),
      bridge: normalizeRoom(value?.rooms?.bridge, base.rooms.bridge),
    },
    runControl: Object.fromEntries(Object.keys(base.runControl).map((key) => [
      key,
      value?.runControl?.[key] ?? base.runControl[key],
    ])),
    letters: value?.letters && typeof value.letters === 'object' ? value.letters : {},
  };
}

function readState() {
  try {
    return normalize(parseJson(localStorage.getItem(STATE_KEY), defaults()));
  } catch {
    return defaults();
  }
}

export function createStorage() {
  let state = readState();

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
    getCurrentConversation() {
      return localStorage.getItem(CURRENT_CONVERSATION_KEY) || 'main';
    },
    setCurrentConversation(value) {
      localStorage.setItem(CURRENT_CONVERSATION_KEY, cleanId(value, 'main'));
    },
  });
}
