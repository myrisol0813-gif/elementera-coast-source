import { escapeAttribute, escapeHtml, q } from '../../core/dom.js';
import { modelKind, modelName, sortedModelIds, imageGroupKey } from './models-format.js';

export function createModelsQuickPicker({ chat, toast, getCatalog, fetchCatalog }) {
  let tab='chat';
  const titleKey='tideloom.home.displayName';
  function readTitle(){try{return localStorage.getItem(titleKey)||'ChatGPT';}catch{return 'ChatGPT';}}
  function setTitle(value){
    const name=String(value||'').trim().slice(0,40)||'ChatGPT';
    try{localStorage.setItem(titleKey,name);}catch{toast('无法保存显示名');return;}
    updateTopLabel();renderQuickPicker();
  }
  function selectTab(value){if(['chat','image','voice'].includes(value)){tab=value;renderQuickPicker();}}
  function updateTopLabel(profile = chat.getProfile()) {
    const title=q('#modelButton .model-title');if(title)title.textContent=readTitle();
    const catalog = getCatalog();
    const modelId = profile.current_chat_model || '';
    const kind = modelKind(catalog, modelId);
    const name = modelName(catalog, modelId);
    const label = kind === 'OpenAI'
      ? `${name.replace(/^GPT(?:[-:\s]+)?/i, '') || name} ›`
      : kind === 'Free'
        ? `Free: ${name.replace(/NVIDIA\s*/i, '').replace(/ · free$/i, '')} ›`
        : `${name} ›`;
    const node = q('#modelName');
    if (node) {
      node.textContent = label;
      node.title = modelId;
    }
  }

  function quickModelIds(profile = chat.getProfile()) {
    const box = profile.model_box || {};
    return sortedModelIds(getCatalog(), [...new Set([
      profile.current_chat_model,
      ...(box.chat || []),
      ...(box.free || []),
    ].filter(Boolean))]);
  }

  function renderQuickPicker(profile = chat.getProfile()) {
    const root = q('#modelQuickPicker');
    if (!root) return;
    const catalog = getCatalog();
    const ids = quickModelIds(profile);
    const imageIds=[...new Set([profile.current_image_model,...(profile.model_box?.image||[]),...(catalog?.groups?.openai_image||[]).map(m=>m.id)].filter(Boolean))];
    const renderRow=(id,image=false)=>`<button class="${id===(image?profile.current_image_model:profile.current_chat_model)?'is-current':''}" type="button" data-action="models:${image?'quick-image':'quick-select'}" data-id="${escapeAttribute(id)}"><span>${escapeHtml(modelName(catalog,id))}</span><small>${escapeHtml(image? id:modelKind(catalog,id))}</small></button>`;
    const imageGroups=['GPT','其他模型','Free'].map(group=>{
      const entries=imageIds.filter(id=>imageGroupKey(id)===group);
      return entries.length?`<details class="feature-card model-quick-list"><summary>${group} · ${entries.length}</summary>${entries.map(id=>renderRow(id,true)).join('')}</details>`:'';
    }).join('');
    const tabs=['chat','image','voice'].map((kind,i)=>`<button type="button" class="${kind===tab?'is-current':''}" data-action="models:quick-tab" data-id="${kind}" aria-pressed="${kind===tab}">${['聊天模型','生图模型','语音模型'][i]}</button>`).join('');
    root.innerHTML = `<div class="model-quick-card" role="dialog" aria-label="快捷选择模型">
      <details class="feature-card"><summary>主页显示名 · ${escapeHtml(readTitle())}</summary>
        <div class="model-actions"><button type="button" data-action="models:title-preset" data-id="ChatGPT">ChatGPT</button><button type="button" data-action="models:title-preset" data-id="Tideloom">Tideloom</button></div>
        <form data-submit="models:title"><input name="display_name" maxlength="40" value="${escapeAttribute(readTitle())}" aria-label="自定义名称"><button type="submit">保存</button></form>
      </details>
      <div class="model-actions">${tabs}</div>
      ${tab==='chat'?`<div class="model-quick-list">${ids.map(id=>renderRow(id)).join('')||'<p>模型箱里还没有聊天模型。</p>'}</div>`:tab==='image'?`<div class="feature-card"><strong>当前生图模型</strong><small>${escapeHtml(profile.current_image_model||'尚未选择')}</small></div>${imageGroups||'<p>暂无图片目录。</p>'}`:'<div class="feature-card"><strong>语音 · ElevenLabs</strong><p>Web 在线语音由部署者配置，不读取本机密钥。</p></div>'}
      <button class="model-quick-manage" type="button" data-action="models:open">管理模型箱 ›</button>
    </div>`;
  }

  function closeQuickPicker() {
    const root = q('#modelQuickPicker');
    const button = q('#modelButton');
    if (root) root.hidden = true;
    if (button) button.setAttribute('aria-expanded', 'false');
  }

  async function toggleQuickPicker() {
    const root = q('#modelQuickPicker');
    const button = q('#modelButton');
    if (!root || !button) return;
    if (!root.hidden) {
      closeQuickPicker();
      return;
    }
    if (!getCatalog()) {
      try {
        await fetchCatalog();
      } catch (error) {
        toast(`模型目录读取失败：${error.message}`);
      }
    }
    renderQuickPicker();
    root.hidden = false;
    button.setAttribute('aria-expanded', 'true');
  }

  function observeEvent(event) {
    if (event.type !== 'click') return;
    const root = q('#modelQuickPicker');
    if (!root || root.hidden) return;
    if (!event.target?.closest?.('#modelButton, #modelQuickPicker')) closeQuickPicker();
  }

  return Object.freeze({
    updateTopLabel,
    renderQuickPicker,
    selectTab,
    setTitle,
    closeQuickPicker,
    toggleQuickPicker,
    observeEvent,
  });
}
