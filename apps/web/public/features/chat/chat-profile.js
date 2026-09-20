export const DEFAULT_MODEL = '';

export { shortModelName } from '../../core/model-format.js';

export function emptyProfile() {
  return {
    model_partner_avatar_dataurl: '',
    current_chat_model: DEFAULT_MODEL,
    current_image_model: '',
    model_box: { chat: [], free: [], image: [] },
  };
}

export function cleanProfile(value = {}) {
  const modelBox = value.model_box || value.modelBox || {};
  const strings = (list) => Array.isArray(list) ? list.filter((item) => typeof item === 'string').slice(0, 60) : [];
  return {
    model_partner_avatar_dataurl: typeof value.model_partner_avatar_dataurl === 'string' ? value.model_partner_avatar_dataurl : '',
    current_chat_model: String(value.current_chat_model || DEFAULT_MODEL),
    current_image_model: String(value.current_image_model || ''),
    model_box: {
      chat: strings(modelBox.chat),
      free: strings(modelBox.free),
      image: strings(modelBox.image),
    },
  };
}

export function isImageModel(modelId, imageModels = []) {
  const id = String(modelId || '');
  return imageModels.includes(id) || /(?:gpt-image-|dall-e)/i.test(id);
}

export function replyTokenBudget(outputLength) {
  if (outputLength === 'short') return 700;
  return null;
}
