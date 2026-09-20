import { API, requestJson } from '../core/api.js';
import { escapeHtml } from '../core/dom.js';

function pill(label,value){return `<span class="dev-status ${value?'is-ok':'is-off'}">${escapeHtml(label)} · ${value?'可用':'需配置'}</span>`;}
export function createDevHands({router,toast}){
  const state={tools:[],runs:[],check:null,error:''};
  async function load(){
    state.error='';
    try{
      const [tools,runs,check]=await Promise.all([
        requestJson(API.workbenchTools),
        requestJson(`${API.devLogs}?limit=80`),
        requestJson(API.devSelfCheck),
      ]);
      state.tools=Array.isArray(tools.tools)?tools.tools:[];
      state.runs=Array.isArray(runs.runs)?runs.runs:[];
      state.check=check;
    }catch(error){state.error=error?.message||'开发手状态读取失败。';}
  }
  async function homeView(){
    await load();
    const integrations=state.check?.integrations||[];
    const available=state.tools.filter((tool)=>tool.available).length;
    return {
      title:'开发手',
      subtitle:'授权项目工具 · 自检 · 日志',
      className:'dev-hands-panel',
      headerAction:'<button class="feature-head-action" type="button" data-action="devhands:refresh">刷新</button>',
      body:`<section class="dev-paper-card dev-hand-hero"><strong>source-safe 开发手</strong><p>这里保留工具目录、自检与脱敏调用记录。GitHub / Notion 只提供通用 adapter contract，未接入自托管 adapter 时不会执行外部写操作。</p></section>
      <section class="dev-paper-card"><div class="dev-status-row">${pill('聊天数据源',Boolean(state.check?.database))}${integrations.map((item)=>pill(item.label||item.id,Boolean(item.configured))).join('')}</div><p>当前目录 ${state.tools.length} 项 · 可直接使用 ${available} 项。</p></section>
      <button class="dev-hand-card" type="button" data-action="toolroom:open"><span><strong>工具调用记录</strong><small>查看工具名、作用范围、失败原因与脱敏状态</small></span><i>›</i></button>
      <section class="dev-paper-card"><strong>最近调用</strong><p>最近 ${state.runs.length} 次 · 成功 ${state.runs.filter((run)=>run.success).length} · 失败 ${state.runs.filter((run)=>!run.success).length}</p></section>
      ${state.error?`<p class="dev-hand-error">${escapeHtml(state.error)}</p>`:''}`,
    };
  }
  router.register('dev-hands-home',homeView);
  function handleAction(name){
    if(name==='open')return router.open('dev-hands-home');
    if(name==='refresh'){toast('开发手状态已刷新');return router.refresh({preserveScroll:true});}
  }
  return Object.freeze({
    id:'devhands',priority:56,mountOrder:56,
    ownsRoute:(route)=>route?.name==='dev-hands-home',
    ownsEvent(_event,context){if(context.namespace!=='devhands')return false;if(context.eventType==='click')return {preventDefault:true};return false;},
    handleEvent(_event,context){return handleAction(context.name);},
    handleAction,mount(){},refresh(){},destroy(){},
  });
}
