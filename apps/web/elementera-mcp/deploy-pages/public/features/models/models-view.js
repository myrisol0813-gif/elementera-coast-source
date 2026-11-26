import { escapeAttribute, escapeHtml } from '../../core/dom.js';
import { SERIES } from './models-constants.js';
import {
  modelById,
  imageGroupKey,
  modelKind,
  priceText,
  seriesKey,
  sortedModels,
  tagText,
} from './models-format.js';

export function createModelsView({ chat, getCatalog, getSearch, getSearchDraft, getKind = () => 'chat' }) {
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
    const current = groupName === 'image' ? profile.current_image_model === modelId : profile.current_chat_model === modelId;
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
      <div><strong>${escapeHtml(model.name || model.id)}</strong><code>${escapeHtml(model.id)}</code><small><span class="model-badge ${model.is_free ? 'is-free' : ''}">${escapeHtml(modelKind(catalog, model.id, model))}</span>${escapeHtml(groupName === 'image' ? (model.is_free ? '免费标识 · 以供应商计费为准' : '按图像 API 实际计费') : priceText(model))}<br>${escapeHtml(tagText(model))}</small></div>
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
    const kind=getKind();
    const tabs=['chat','image','voice'].map((id,i)=>`<button type="button" data-action="models:kind" data-id="${id}" class="${kind===id?'is-current':''}" aria-pressed="${kind===id}">${['聊天模型','生图模型','语音模型'][i]}</button>`).join('');
    const toolbar=`<form class="model-toolbar" data-submit="models:search"><input type="search" data-input="models:search-draft" placeholder="搜索${kind==='image'?'生图':'聊天'}模型" value="${escapeAttribute(getSearchDraft())}" autocomplete="off" enterkeyhint="search"><button type="submit">搜索</button><button type="button" data-action="models:refresh">刷新</button></form>`;
    const chatBody=()=>`${group('当前聊天模型', profile.current_chat_model ? row(profile.current_chat_model, 'chat', 'current') : '')}
        ${group('我的 Chat 模型', (box.chat || []).map((id) => row(id, 'chat')).join(''))}
        ${catalogGroups(groups.openai_chat || [])}
        ${group('Free Test', (box.free || []).map((id) => row(id, 'free')).join(''))}
        ${group('Free Test 目录', filtered(groups.free_test || []).map((model) => row(model.id, 'free', 'catalog')).join(''))}`;
    const imageBody=()=>{
      const all=[...new Set([...(box.image||[]),...(groups.openai_image||[]).map(m=>m.id)])];
      const entries=filtered(all.map(id=>modelById(catalog,id)||{id,name:id}));
      const sections=['GPT','其他模型','Free'].map(label=>{
        const models=entries.filter(m=>imageGroupKey(m.id)===label);
        return models.length?`<details class="feature-card model-list" ${getSearch()?'open':''}><summary>${label} · ${models.length}</summary>${models.map(m=>row(m.id,'image',(box.image||[]).includes(m.id)?'box':'catalog')).join('')}</details>`:'';
      }).join('');
      return `${group('当前生图模型',profile.current_image_model?row(profile.current_image_model,'image','current'):'')}${group('图片模型目录',sections||'<p class="feature-empty">暂无匹配图片模型。</p>')}${catalog?.image_catalog_status==='unavailable'?'<div class="feature-card">目录暂不可用；已选模型保留，生成时重新核验。</div>':''}`;
    };
    return {
      title: '模型箱',
      subtitle: '选择、搜索与管理模型',
      className: 'model-box',
      body: `<div class="feature-card model-actions">${tabs}</div>${kind==='voice'?group('语音模型','<strong>ElevenLabs</strong><p>在线语音由部署者配置；本机语音密钥不会上传。</p>'):`${toolbar}<div class="feature-card feature-meta">目录更新：${escapeHtml(catalog?.updated_at||'未刷新')}</div>${kind==='image'?imageBody():chatBody()}`}`,
    };
  }

  return Object.freeze({ view });
}
