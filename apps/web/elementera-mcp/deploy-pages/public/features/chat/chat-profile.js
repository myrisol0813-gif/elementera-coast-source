export const DEFAULT_MODEL = 'openai/gpt-4.1-nano';

export { shortModelName } from '../../core/model-format.js';

export function emptyProfile() {
  return {
    assistant_avatar_dataurl: '',
    current_chat_model: DEFAULT_MODEL,
    current_image_model: '',
    model_box: { chat: [], free: [], image: [] },
  };
}

export function cleanProfile(value = {}) {
  const modelBox = value.model_box || value.modelBox || {};
  const strings = (list) => Array.isArray(list) ? list.filter((item) => typeof item === 'string').slice(0, 60) : [];
  return {
    assistant_avatar_dataurl: typeof value.assistant_avatar_dataurl === 'string' ? value.assistant_avatar_dataurl : '',
    current_chat_model: String(value.current_chat_model || DEFAULT_MODEL),
    current_image_model: String(value.current_image_model || ''),
    model_box: {
      chat: strings(modelBox.chat),
      free: strings(modelBox.free),
      image: strings(modelBox.image),
    },
  };
}

export function mergeMigrationProfile(server, migrated) {
  const current = cleanProfile(server);
  if (!migrated) return current;
  const old = cleanProfile(migrated);
  return cleanProfile({
    assistant_avatar_dataurl: current.assistant_avatar_dataurl || old.assistant_avatar_dataurl,
    current_chat_model: current.current_chat_model && current.current_chat_model !== DEFAULT_MODEL
      ? current.current_chat_model
      : old.current_chat_model || current.current_chat_model,
    current_image_model: current.current_image_model || old.current_image_model,
    model_box: {
      chat: current.model_box.chat.length ? current.model_box.chat : old.model_box.chat,
      free: current.model_box.free.length ? current.model_box.free : old.model_box.free,
      image: current.model_box.image.length ? current.model_box.image : old.model_box.image,
    },
  });
}

export function isImageModel(modelId, imageModels = []) {
  const id = String(modelId || '');
  return imageModels.includes(id) || /(?:gpt-image-|dall-e)/i.test(id);
}

export function replyTokenBudget(outputLength) {
  if (outputLength === 'short') return 700;
  return null;
}
