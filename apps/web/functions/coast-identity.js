const ACTORS = new Set(['owner', 'assistant']);
const SURFACES = new Set(['web_manual', 'source_api', 'official_mcp']);
const SURFACE_SYMBOLS = Object.freeze({
  web_manual: '',
  source_api: '✦',
  official_mcp: '≋',
});

function clip(value, max) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function officialDisplayName(modelLabel, modelNickname = '') {
  let core = clip(modelLabel, 120)
    .replace(/^chatgpt[\s:—-]*/i, '')
    .replace(/^gpt[\s:—-]*/i, '');
  if (!core) throw new TypeError('official_mcp requires model_label');
  const nickname = clip(modelNickname, 60);
  if (nickname && !core.toLocaleLowerCase('en-US').includes(nickname.toLocaleLowerCase('en-US'))) {
    core = `${core} ${nickname}`;
  }
  return `Assistant-${core}≋`;
}

export function officialMcpIdentity(value = {}) {
  const modelLabel = clip(value.model_label ?? value.modelLabel, 120);
  const modelNickname = clip(value.model_nickname ?? value.modelNickname, 60);
  return Object.freeze({
    actor: 'assistant',
    surface: 'official_mcp',
    model_label: modelLabel,
    model_nickname: modelNickname || null,
    symbol: SURFACE_SYMBOLS.official_mcp,
    display_author: officialDisplayName(modelLabel, modelNickname),
  });
}

export function apiAssistantIdentity(value = {}) {
  const modelLabel = clip(value.model_label ?? value.modelLabel, 180);
  if (!modelLabel) throw new TypeError('source_api requires model_label');
  return Object.freeze({
    actor: 'assistant',
    surface: 'source_api',
    model_label: modelLabel,
    model_nickname: clip(value.model_nickname ?? value.modelNickname, 60) || null,
    symbol: SURFACE_SYMBOLS.source_api,
    display_author: 'Assistant',
  });
}

export function ownerIdentity() {
  return Object.freeze({
    actor: 'owner',
    surface: 'web_manual',
    model_label: null,
    model_nickname: null,
    symbol: SURFACE_SYMBOLS.web_manual,
    display_author: 'Owner',
  });
}

export function validateCoastIdentity(value = {}) {
  const actor = clip(value.actor, 24);
  const surface = clip(value.surface, 32);
  const symbol = String(value.symbol ?? '');
  const displayAuthor = clip(value.display_author, 180);
  if (!ACTORS.has(actor) || !SURFACES.has(surface)) throw new TypeError('invalid source identity');
  if (SURFACE_SYMBOLS[surface] !== symbol) throw new TypeError('surface symbol mismatch');
  if (surface === 'web_manual' && actor !== 'owner') throw new TypeError('web_manual must be owner');
  if (surface !== 'web_manual' && actor !== 'assistant') throw new TypeError(`${surface} must be assistant`);
  if (surface === 'official_mcp' && (!value.model_label || !displayAuthor.startsWith('Assistant-') || !displayAuthor.endsWith('≋'))) {
    throw new TypeError('invalid official_mcp signature');
  }
  if (surface === 'source_api' && (!value.model_label || symbol !== '✦')) {
    throw new TypeError('invalid source_api signature');
  }
  if (!displayAuthor) throw new TypeError('display_author is required');
  return {
    actor,
    surface,
    model_label: clip(value.model_label, 180) || null,
    model_nickname: clip(value.model_nickname, 60) || null,
    symbol,
    display_author: displayAuthor,
  };
}
