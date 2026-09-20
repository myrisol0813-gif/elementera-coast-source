import { CATALOG_TTL_MS, OPENROUTER_MODELS_URL } from './model-constants.js';
import { ModelRequestError } from './model-validation.js';

let catalogCache = null;
let catalogExpiresAt = 0;

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

export async function fetchModelCatalog(env, force = false) {
  const now = Date.now();
  if (!force && catalogCache && catalogExpiresAt > now) return catalogCache;
  const headers = { Accept: 'application/json' };
  if (openRouterKey(env)) headers.Authorization = `Bearer ${openRouterKey(env)}`;
  let response;
  try {
    response = await fetch(OPENROUTER_MODELS_URL, { headers });
  } catch {
    throw new ModelRequestError('models_fetch_failed', 'Model catalog is unavailable.', 502);
  }
  if (!response.ok) throw new ModelRequestError('models_fetch_failed', 'Model catalog is unavailable.', 502);
  let raw;
  try {
    raw = await response.json();
  } catch {
    throw new ModelRequestError('models_parse_failed', 'Model catalog is invalid.', 502);
  }
  catalogCache = buildModelCatalog(raw);
  catalogExpiresAt = now + CATALOG_TTL_MS;
  return catalogCache;
}
