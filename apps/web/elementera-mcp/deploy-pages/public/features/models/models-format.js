const natural = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

export function allModels(catalog) {
  const groups = catalog?.groups || {};
  return [...(groups.openai_chat || []), ...(groups.openai_image || []), ...(groups.free_test || [])];
}

export function modelById(catalog, modelId) {
  return allModels(catalog).find((model) => model.id === modelId) || null;
}

export function inferredModelName(modelId) {
  const raw = String(modelId || '').split('/').at(-1)?.replace(/:free$/i, '') || '';
  return raw.split(/[-_]+/).filter(Boolean).map((part) => {
    if (part.toLowerCase() === 'gpt') return 'GPT';
    if (/^[a-z]\d+[a-z]?$/i.test(part) || /^\d+[a-z]+$/i.test(part)) return part.toUpperCase();
    if (/^\d/.test(part)) return part;
    return `${part.charAt(0).toUpperCase()}${part.slice(1)}`;
  }).join(' ');
}

export function modelName(catalog, modelId) {
  return modelById(catalog, modelId)?.name || inferredModelName(modelId) || '未选择模型';
}

export function modelKind(catalog, modelId, model = modelById(catalog, modelId)) {
  if (model?.is_free || String(modelId).includes(':free')) return 'Free';
  if (String(modelId).includes('gpt-image')) return 'Image';
  if (String(modelId).startsWith('openai/')) return 'OpenAI';
  return 'Model';
}

export function seriesKey(model) {
  const value = `${model?.id || ''} ${model?.name || ''}`.toLocaleLowerCase('en-US');
  if (/(?:^|[\s/_-])o\d(?:[.\s/_-]|$)/.test(value)) return 'o';
  if (/(?:^|[\s/_-])gpt[\s_-]*4/.test(value)) return '4';
  if (/(?:^|[\s/_-])gpt[\s_-]*5/.test(value)) return '5';
  return 'other';
}

export function sortedModels(models) {
  return [...models].sort((left, right) => natural.compare(
    `${left.name || ''} ${left.id || ''}`,
    `${right.name || ''} ${right.id || ''}`,
  ));
}

export function sortedModelIds(catalog, ids) {
  return [...ids].sort((left, right) => natural.compare(modelName(catalog, left), modelName(catalog, right)));
}

export function priceText(model) {
  const pricing = model?.pricing || {};
  return `prompt ${pricing.prompt ?? '?'} / completion ${pricing.completion ?? '?'}`;
}

export function tagText(model) {
  const tags = Array.isArray(model?.supported_parameters) ? model.supported_parameters.slice(0, 5) : [];
  if (model?.is_free) tags.unshift('free');
  if (!model?.available) tags.unshift('unavailable');
  return tags.length ? tags.join(' · ') : 'no tags';
}
