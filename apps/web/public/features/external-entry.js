import { API, requestJson } from '../core/api.js';
import { escapeHtml } from '../core/dom.js';

const CHANNEL_LABELS=Object.freeze({external:'外部入口消息',api_common_room:'官端 MCP 与 API 共通聊天室',official_mcp:'与官端 MCP 对话区'});
export function createExternalEntry({router,toast}){
  const state={messages:[],status:null,channel:''};
  async function load(){
    const suffix=state.channel?`?channel=${encodeURIComponent(state.channel)}&limit=100`:'?limit=100';
    const [messages,status]=await Promise.all([requestJson(`${API.externalMessages}${suffix}`),requestJson(API.externalStatus)]);
    state.messages=Array.isArray(messages.messages)?messages.messages:[];
    state.status=status;
  }
  async function view(){
    await load();
    return {
      title:'外部入口消息',
      subtitle:'外部入口同步 / 取信 · source-safe',
      className:'external-entry-panel',
      headerAction:'<button class="feature-head-action" type="button" data-action="external:refresh">刷新</button>',
      body:`<section class="feature-group"><h2>入口状态</h2><div class="feature-card">
        <div class="feature-row static"><span><strong>source ingress contract</strong><small>默认仅已登录屋主可用；不包含生产认证、远端地址或历史数据。</small></span></div>
      </div></section>
      <section class="external-filter"><label>来源<select data-input="external:channel"><option value="">全部入口</option>${Object.entries(CHANNEL_LABELS).map(([id,label])=>`<option value="${id}" ${state.channel===id?'selected':''}>${escapeHtml(label)}</option>`).join('')}</select></label></section>
      <section class="external-message-list">${state.messages.length?state.messages.map((item)=>`<article><header><strong>${escapeHtml(CHANNEL_LABELS[item.channel]||item.channel)}</strong><small>${escapeHtml(item.created_at||'')}</small></header><p>${escapeHtml(item.content)}</p><footer>${escapeHtml(item.author||'未标注来源')}${item.conversation_id?` · ${escapeHtml(item.conversation_id)}`:''}</footer></article>`).join(''):'<p class="feature-empty">当前没有外部入口消息。</p>'}</section>`,
    };
  }
  router.register('external-entry',view);
  function handleAction(name){if(name==='open')return router.open('external-entry');if(name==='refresh'){toast('外部入口状态已刷新');return router.refresh({preserveScroll:true});}}
  function handleInput(name,target){if(name!=='channel')return;state.channel=target.value||'';return router.refresh({preserveScroll:false});}
  return Object.freeze({
    id:'external',priority:53,mountOrder:53,
    ownsRoute:(route)=>route?.name==='external-entry',
    ownsEvent(_event,context){if(context.namespace!=='external')return false;if(context.eventType==='click')return {preventDefault:true};if(context.eventType==='input')return true;return false;},
    handleEvent(_event,context){return context.eventType==='click'?handleAction(context.name):handleInput(context.name,context.target);},
    handleAction,mount(){},refresh(){},destroy(){},
  });
}
