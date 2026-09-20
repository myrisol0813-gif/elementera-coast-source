import { escapeAttribute, escapeHtml, q } from '../../core/dom.js';
import { modelKind, modelName, sortedModelIds } from './models-format.js';
export function createModelsQuickPicker({chat,toast,getCatalog,fetchCatalog}){
  function updateTopLabel(profile=chat.getProfile()){
    const catalog=getCatalog();const modelId=profile.current_chat_model||'';const kind=modelKind(catalog,modelId);const name=modelName(catalog,modelId);
    const node=q('#modelName');if(node){node.textContent=modelId?`${kind==='Free'?'Free: ':''}${name} ›`:'自动选择 ›';node.title=modelId;}
  }
  function quickModelIds(profile=chat.getProfile()){const box=profile.model_box||{};return sortedModelIds(getCatalog(),[...new Set([profile.current_chat_model,...(box.chat||[]),...(box.free||[])].filter(Boolean))]);}
  function renderQuickPicker(profile=chat.getProfile()){
    const root=q('#modelQuickPicker');if(!root)return;const catalog=getCatalog();const ids=quickModelIds(profile);
    root.innerHTML=`<div class="model-quick-card" role="dialog" aria-label="快捷选择模型"><strong>选择模型</strong><div class="model-quick-list">${ids.map((modelId)=>{const current=modelId===profile.current_chat_model;return `<button class="${current?'is-current':''}" type="button" data-action="models:quick-select" data-id="${escapeAttribute(modelId)}" aria-pressed="${current}"><span>${escapeHtml(modelName(catalog,modelId))}</span><small>${escapeHtml(modelKind(catalog,modelId))}</small></button>`;}).join('')||'<p>模型箱里还没有聊天模型。</p>'}</div><button class="model-quick-manage" type="button" data-action="models:open">管理模型箱 ›</button></div>`;
  }
  function closeQuickPicker(){const root=q('#modelQuickPicker');const button=q('#modelButton');if(root)root.hidden=true;if(button)button.setAttribute('aria-expanded','false');}
  async function toggleQuickPicker(){const root=q('#modelQuickPicker');const button=q('#modelButton');if(!root||!button)return;if(!root.hidden){closeQuickPicker();return;}if(!getCatalog()){try{await fetchCatalog();}catch(error){toast(`模型目录读取失败：${error.message}`);}}renderQuickPicker();root.hidden=false;button.setAttribute('aria-expanded','true');}
  function observeEvent(event){if(event.type!=='click')return;const root=q('#modelQuickPicker');if(!root||root.hidden)return;if(!event.target?.closest?.('#modelButton, #modelQuickPicker'))closeQuickPicker();}
  return Object.freeze({updateTopLabel,renderQuickPicker,closeQuickPicker,toggleQuickPicker,observeEvent});
}
