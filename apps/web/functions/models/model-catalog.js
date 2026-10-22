import { CATALOG_TTL_MS, OPENROUTER_MODELS_URL } from './model-constants.js';
import { ModelRequestError } from './model-validation.js';

export function openRouterKey(env) {
  return env.OPENROUTER_API_KEY;
}

function outputModalities(model) {
  const value = model?.architecture?.output_modalities;
  if (Array.isArray(value)) return value.map((item) => String(item).toLowerCase());
  if (typeof value === 'string') return [value.toLowerCase()];
  return [];
}

function hasOutput(model, modality) {
  return outputModalities(model).includes(modality);
}

function priceIsZero(value) {
  if (value === 0 || value === '0') return true;
  const number = Number(value);
  return Number.isFinite(number) && number === 0;
}

function isFreeModel(model) {
  const pricing = model?.pricing || {};
  return String(model?.id || '').includes(':free')
    || (priceIsZero(pricing.prompt) && priceIsZero(pricing.completion));
}

function modelText(model) {
  return `${model?.id || ''} ${model?.name || ''}`.toLowerCase();
}

function isOpenAiChat(model) {
  const id = String(model?.id || '');
  if (!id.startsWith('openai/') || !hasOutput(model, 'text')) return false;
  const excluded = ['embedding', 'embed', 'gpt-image', 'dall-e', 'tts', 'whisper', 'transcribe', 'audio', 'moderation'];
  return !excluded.some((word) => modelText(model).includes(word));
}

function isOpenAiImage(model, version) {
  return String(model?.id || '').startsWith('openai/')
    && hasOutput(model, 'image')
    && modelText(model).includes(`gpt-image-${version}`);
}

function safeModel(model, extra = {}) {
  return {
    id: String(model?.id || extra.id || ''),
    name: String(model?.name || extra.name || model?.id || extra.id || ''),
    context_length: model?.context_length ?? null,
    pricing: model?.pricing || null,
    supported_parameters: Array.isArray(model?.supported_parameters) ? model.supported_parameters : [],
    architecture: model?.architecture || null,
    top_provider: model?.top_provider || null,
    created: model?.created ?? null,
    is_free: Boolean(extra.is_free ?? isFreeModel(model)),
    available: extra.available ?? true,
  };
}

function sortModels(models) {
  return models.sort((left, right) => String(left.name || left.id).localeCompare(String(right.name || right.id)));
}

function chooseDefaultChat(models) {
  for (const id of ['openai/gpt-4.1-mini', 'openai/gpt-4.1-nano', 'openai/gpt-4o-mini']) {
    if (models.some((model) => model.id === id)) return id;
  }
  return models[0]?.id || '';
}

export function buildModelCatalog(raw) {
  const source = Array.isArray(raw?.data) ? raw.data : [];
  const openaiChat = sortModels(source.filter(isOpenAiChat).map((model) => safeModel(model)));
  const imageTwo = source.filter((model) => isOpenAiImage(model, 2)).map((model) => safeModel(model));
  const imageOne = source.filter((model) => isOpenAiImage(model, 1)).map((model) => safeModel(model));
  const openaiImage = sortModels(imageTwo.length ? imageTwo : imageOne);
  const freeModels = sortModels(source
    .filter((item) => hasOutput(item, 'text') && isFreeModel(item))
    .map((model) => safeModel(model, { is_free: true })));
  return {
    ok: true,
    groups: {
      openai_chat: openaiChat,
      openai_image: openaiImage,
      free_test: freeModels,
    },
    defaults: {
      chat: chooseDefaultChat(openaiChat),
      image: openaiImage[0]?.id || '',
      free: freeModels[0]?.id || '',
    },
    updated_at: new Date().toISOString(),
  };
}

const FUCHEERS_API = 'https://www.fucheers.top/v1';
export const FUCHEERS_PREFIX = 'fucheers:';
const cache = {
  openrouter: { value: null, expiry: 0, updatedAt: null },
  fucheers: { value: null, expiry: 0, updatedAt: null },
};

export function modelProvider(id) {
  return String(id || '').startsWith(FUCHEERS_PREFIX) ? 'fucheers' : 'openrouter';
}

export function providerRoute(env, modelId) {
  if (modelProvider(modelId) === 'fucheers') {
    return {
      provider: 'fucheers',
      key: env.FUCHEERS_API_KEY,
      url: String(env.FUCHEERS_BASE_URL || FUCHEERS_API).replace(/\/$/, '') + '/chat/completions',
      upstreamModel: String(modelId).slice(FUCHEERS_PREFIX.length),
    };
  }
  return {
    provider: 'openrouter',
    key: openRouterKey(env),
    url: 'https://openrouter.ai/api/v1/chat/completions',
    upstreamModel: modelId,
  };
}

function fucheersChatModel(raw) {
  const id = String(raw?.id || '');
  if (!/^(?:gpt-|o[1-9][0-9]*(?:-|$))/i.test(id)) return null;
  return {
    id: FUCHEERS_PREFIX + id,
    name: String(raw.name || id),
    provider: 'fucheers',
    context_length: raw.context_length ?? null,
    pricing: raw.pricing && typeof raw.pricing === 'object' ? raw.pricing : null,
    supported_parameters: Array.isArray(raw.supported_parameters) ? raw.supported_parameters : [],
    reasoning_efforts: Array.isArray(raw.reasoning_efforts) ? raw.reasoning_efforts : [],
    architecture: null,
    top_provider: null,
    created: raw.created ?? null,
    is_free: false,
    available: true,
  };
}

async function refreshProvider(provider, url, headers, convert, force = false) {
  const entry = cache[provider];
  if (!force && entry.value && entry.expiry > Date.now()) return true;
  try {
    const response = await fetch(url, { headers });
    if (!response.ok) return false;
    const raw = await response.json();
    if (!Array.isArray(raw?.data)) return false;
    entry.value = convert(raw);
    entry.expiry = Date.now() + CATALOG_TTL_MS;
    entry.updatedAt = new Date().toISOString();
    return true;
  } catch {
    return false;
  }
}

export async function fetchModelCatalog(env, force = false) {
  const fucheersConfigured = Boolean(env.FUCHEERS_API_KEY);
  const [openrouterOk, fucheersOk] = await Promise.all([
    refreshProvider('openrouter', OPENROUTER_MODELS_URL, {
      Accept: 'application/json',
      ...(openRouterKey(env) ? { Authorization: 'Bearer ' + openRouterKey(env) } : {}),
    }, buildModelCatalog, force),
    fucheersConfigured
      ? refreshProvider('fucheers',
        String(env.FUCHEERS_BASE_URL || FUCHEERS_API).replace(/\/$/, '') + '/models',
        { Accept: 'application/json', Authorization: 'Bearer ' + env.FUCHEERS_API_KEY },
        (raw) => sortModels(raw.data.map(fucheersChatModel).filter(Boolean)), force)
      : Promise.resolve(false),
  ]);
  if (!cache.openrouter.value && !cache.fucheers.value) {
    throw new ModelRequestError('models_fetch_failed', '模型目录目前不可用。', 502);
  }
  const base = cache.openrouter.value || buildModelCatalog({ data: [] });
  return {
    ...base,
    groups: {
      ...base.groups,
      fucheers_chat: fucheersConfigured ? (cache.fucheers.value || []) : [],
    },
    providers: {
      openrouter: {
        configured: Boolean(openRouterKey(env)),
        status: openrouterOk ? 'ok' : 'error',
        last_success: cache.openrouter.updatedAt,
      },
      fucheers: {
        configured: fucheersConfigured,
        status: !fucheersConfigured ? 'unconfigured' : fucheersOk ? 'ok' : 'error',
        last_success: fucheersConfigured ? cache.fucheers.updatedAt : null,
      },
    },
    updated_at: new Date().toISOString(),
  };
}
