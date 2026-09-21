import { escapeAttribute, escapeHtml } from '../../core/dom.js';
import { SERIES } from './models-constants.js';
import {
  modelById,
  modelKind,
  priceText,
  seriesKey,
  sortedModels,
  tagText,
} from './models-format.js';

export function createModelsView({ chat, getCatalog, getSearch, getSearchDraft }) {
  function row(modelId, groupName, mode = 'box') {
    const catalog = getCatalog();
    const model = modelById(catalog, modelId) || {
      id: modelId,
      name: modelId,
      is_free: String(modelId).includes(':free'),
      available: true,
      supported_parameters: [],
      pricing: null,
    };
    const profile = chat.getProfile();
    const groupIds = profile.model_box?.[groupName] || [];
    const current = profile.current_chat_model === modelId
      || (groupName === 'image' && profile.current_image_model === modelId);
    const inBox = groupIds.includes(modelId);
    const action = mode === 'current'
      ? ''
      : mode === 'box'
        ? `<button type="button" data-action="models:remove" data-id="${escapeAttribute(modelId)}" data-group="${groupName}">移除</button>`
        : `<button type="button" data-action="models:add" data-id="${escapeAttribute(modelId)}" data-group="${groupName}" ${inBox ? 'disabled' : ''}>${inBox ? '已加入' : '加入'}</button>`;
    const select = groupName === 'image'
      ? `<button class="${current ? 'is-current' : ''}" type="button" data-action="models:select-image" data-id="${escapeAttribute(modelId)}">${current ? '当前' : '设为当前'}</button>`
      : `<button class="${current ? 'is-current' : ''}" type="button" data-action="models:select-chat" data-id="${escapeAttribute(modelId)}">${current ? '当前' : '设为当前'}</button>`;
    return `<article class="model-row">
      <div><strong>${escapeHtml(model.name || model.id)}</strong><code>${escapeHtml(model.id)}</code><small><span class="model-badge ${model.is_free ? 'is-free' : ''}">${escapeHtml(modelKind(catalog, model.id, model))}</span>${escapeHtml(priceText(model))}<br>${escapeHtml(tagText(model))}</small></div>
      <div class="model-actions">${select}${action}</div>
    </article>`;
  }

  function group(title, body) {
    return `<section class="feature-group"><h2>${escapeHtml(title)}</h2><div class="feature-card model-list">${body || '<p class="feature-empty">暂无模型。</p>'}</div></section>`;
  }

  function filtered(models) {
    const needle = getSearch().toLocaleLowerCase('zh-CN');
    if (!needle) return models;
    return models.filter((model) => `${model.id} ${model.name}`.toLocaleLowerCase('zh-CN').includes(needle));
  }

  function catalogGroups(models) {
    const grouped = new Map(SERIES.map(({ key }) => [key, []]));
    sortedModels(filtered(models)).forEach((model) => grouped.get(seriesKey(model)).push(model));
    const sections = SERIES
      .filter(({ key }) => grouped.get(key).length)
      .map(({ key, title }) => group(title, grouped.get(key).map((model) => row(model.id, 'chat', 'catalog')).join('')))
      .join('');
    return sections || group(getSearch() ? `没有找到“${getSearch()}”` : 'OpenAI Chat 目录', '');
  }

  function view() {
    const catalog = getCatalog();
    const profile = chat.getProfile();
    const box = profile.model_box || { chat: [], free: [], image: [] };
    const groups = catalog?.groups || { openai_chat: [], openai_image: [], free_test: [] };
    return {
      title: '模型箱',
      subtitle: '选择、搜索与管理模型',
      className: 'model-box',
      body: `<form class="model-toolbar" data-submit="models:search">
          <input type="search" data-input="models:search-draft" placeholder="搜索 OpenAI Chat 模型" value="${escapeAttribute(getSearchDraft())}" autocomplete="off" enterkeyhint="search">
          <button type="submit">搜索</button>
          <button type="button" data-action="models:refresh">刷新</button>
        </form>
        <p class="feature-meta">目录更新：${escapeHtml(catalog?.updated_at || '未刷新')} · 当前模型：${escapeHtml(profile.current_chat_model || '未选择')}</p>
        ${group('当前聊天模型', profile.current_chat_model ? row(profile.current_chat_model, 'chat', 'current') : '')}
        ${group('我的 Chat 模型', (box.chat || []).map((id) => row(id, 'chat')).join(''))}
        ${catalogGroups(groups.openai_chat || [])}
        ${group('Free Test', (box.free || []).map((id) => row(id, 'free')).join(''))}
        ${group('Free Test 目录', filtered(groups.free_test || []).map((model) => row(model.id, 'free', 'catalog')).join(''))}
        ${group('图片模型', (box.image || []).map((id) => row(id, 'image')).join(''))}
        ${group('图片模型目录', filtered(groups.openai_image || []).map((model) => row(model.id, 'image', 'catalog')).join(''))}`,
    };
  }

  return Object.freeze({ view });
}
