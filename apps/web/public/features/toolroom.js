import { API, requestJson } from '../core/api.js';
import { escapeAttribute, escapeHtml } from '../core/dom.js';

function summary(value){if(value==null)return '—';if(typeof value==='string')return value;try{return JSON.stringify(value,null,2);}catch{return '—';}}
export function createToolroom({router,chat}){
  const state={runs:[],status:'',tool:''};
  async function load(){
    const data=await requestJson(`${API.workbenchRuns}?limit=100`);
    state.runs=Array.isArray(data.runs)?data.runs:[];
  }
  function filtered(){
    return state.runs.filter((run)=>{
      if(state.status && (run.success?'success':'error')!==state.status)return false;
      if(state.tool && run.tool_name!==state.tool)return false;
      return true;
    });
  }
  async function view(){
    await load();
    const tools=[...new Set(state.runs.map((run)=>run.tool_name).filter(Boolean))].sort();
    const rows=filtered();
    return {
      title:'工具调用记录',
      subtitle:'工具调用 · 作用范围 · 脱敏摘要',
      className:'toolroom-panel',
      headerAction:'<button class="feature-head-action" type="button" data-action="toolroom:refresh">刷新</button>',
      body:`<section class="toolroom-filters"><div class="toolroom-filter-grid">
        <label>状态<select data-input="toolroom:status"><option value="">全部状态</option><option value="success" ${state.status==='success'?'selected':''}>success</option><option value="error" ${state.status==='error'?'selected':''}>error</option></select></label>
        <label>工具<select data-input="toolroom:tool"><option value="">全部工具</option>${tools.map((name)=>`<option value="${escapeAttribute(name)}" ${state.tool===name?'selected':''}>${escapeHtml(name)}</option>`).join('')}</select></label>
      </div></section>
      <section class="tool-run-list">${rows.length?rows.map((run)=>`<details class="tool-run"><summary><span><strong>${escapeHtml(run.tool_name||'tool')}</strong><small>${escapeHtml(run.category||'未分类')} · ${escapeHtml(run.created_at||'')}</small></span><i>${run.success?'success':'error'}</i></summary><div class="tool-run-detail"><dl>
        <div><dt>作用窗口</dt><dd>${escapeHtml(run.window_id||'—')}</dd></div>
        <div><dt>conversation_id</dt><dd>${escapeHtml(run.conversation_id||'—')}</dd></div>
        <div><dt>目标</dt><dd>${escapeHtml(run.target||'—')}</dd></div>
        <div><dt>递给模型</dt><dd>${run.delivered_to_model?'是':'否'}</dd></div>
        <div><dt>进入本轮上下文预览</dt><dd>${run.shown_in_turn_context?'是':'否'}</dd></div>
        <div><dt>脱敏</dt><dd>${run.redacted?'是':'否'}</dd></div>
      </dl>${run.error_summary?`<section><h3>错误摘要</h3><pre>${escapeHtml(summary(run.error_summary))}</pre></section>`:''}</div></details>`).join(''):'<p class="feature-empty">当前还没有工具调用记录。</p>'}</section>`,
    };
  }
  router.register('toolroom',view);
  function handleAction(name){if(name==='open')return router.open('toolroom');if(name==='refresh')return router.refresh({preserveScroll:false});}
  function handleInput(name,target){if(name==='status')state.status=target.value||'';else if(name==='tool')state.tool=target.value||'';else return;return router.refresh({preserveScroll:false});}
  return Object.freeze({
    id:'toolroom',priority:54,mountOrder:54,
    ownsRoute:(route)=>route?.name==='toolroom',
    ownsEvent(_event,context){
      if(context.namespace!=='toolroom')return false;
      if(context.eventType==='click')return {preventDefault:true};
      if(context.eventType==='input')return true;
      return false;
    },
    handleEvent(_event,context){return context.eventType==='click'?handleAction(context.name):handleInput(context.name,context.target);},
    handleAction,mount(){},refresh(){},destroy(){},
    currentConversationId:()=>chat?.getCurrentConversationId?.()||'',
  });
}
