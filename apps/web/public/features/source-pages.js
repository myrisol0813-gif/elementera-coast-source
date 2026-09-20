import { API, requestJson } from '../core/api.js';
import { escapeAttribute, escapeHtml } from '../core/dom.js';
import { THEME_PRESETS, themeLabel } from '../core/themes.js';

const ROUTES=new Set(['owner-settings','theme-settings','widgets-home']);
function row(title,note,action=''){
  const inner=`<span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(note)}</small></span>`;
  return action
    ? `<button class="feature-row" type="button" data-action="sourcepages:${escapeAttribute(action)}">${inner}<span>›</span></button>`
    : `<div class="feature-row static">${inner}</div>`;
}
export function createSourcePages({router,storage,shell,toast}){
  let sourceStatus=null;
  function ownerView(){
    const prefs=storage.read().preferences;
    return {
      title:'屋主设置',
      subtitle:'人类屋主设置 · source 本机配置',
      className:'source-pages',
      body:`
        <section class="feature-group"><h2>账户</h2><div class="feature-card">${row('账户：前端屋主','公开 source 配置；不读取生产账户。')}</div></section>
        <section class="feature-group"><h2>显示名</h2><form class="feature-card source-form" data-submit="sourcepages:names">
          <label>屋主显示名<input name="ownerName" maxlength="80" value="${escapeAttribute(prefs.ownerName||'Owner')}"></label>
          <label>另一位屋主显示名<input name="modelPartnerName" maxlength="80" value="${escapeAttribute(prefs.modelPartnerName||'Model Partner')}"></label>
          <button class="primary-wide" type="submit">保存显示名</button>
        </form></section>
        <section class="feature-group"><h2>界面与数据</h2><div class="feature-card">
          ${row('主题系统',`当前：${themeLabel(prefs.theme)}`,'themes')}
          ${row('聊天数据源','已配置共享历史。source 规则使用 COAST_CHAT_DB。')}
          ${row('聊天主链已连接','基础聊天、历史、记忆与工作台按 source 配置运行。')}
        </div></section>`,
    };
  }
  function themeView(){
    const current=storage.read().preferences.theme;
    return {
      title:'主题系统',
      subtitle:'公开 source 预设',
      className:'source-pages',
      body:`<div class="theme-grid">${THEME_PRESETS.map((item)=>`
        <button class="theme-card ${item.id===current?'is-current':''}" type="button" data-action="sourcepages:theme" data-theme-id="${escapeAttribute(item.id)}">
          <span class="theme-preview" data-preview="${escapeAttribute(item.id)}"></span>
          <strong>${escapeHtml(item.label)}</strong><small>${item.id===current?'正在使用':'应用主题'}</small>
        </button>`).join('')}</div>`,
    };
  }
  async function widgetsView(){
    try{sourceStatus=await requestJson(API.devSelfCheck);}catch{sourceStatus=null;}
    const state=storage.read();
    const run=state.runControl;
    const integrations=sourceStatus?.integrations||[];
    return {
      title:'小组件',
      subtitle:'source 运行概览',
      className:'source-pages',
      headerAction:'<button class="feature-head-action" type="button" data-action="sourcepages:refresh-widgets">刷新</button>',
      body:`<div class="widget-grid">
        <section><small>聊天数据源</small><strong>${sourceStatus?.database?'已连接':'未连接'}</strong><p>COAST_CHAT_DB</p></section>
        <section><small>主题</small><strong>${escapeHtml(themeLabel(state.preferences.theme))}</strong><p>本机界面配置</p></section>
        <section><small>上下文预算</small><strong>${escapeHtml(run.contextBudget)} tokens</strong><p>本轮上下文 · 已在预算内</p></section>
        <section><small>记忆召回上限</small><strong>${escapeHtml(run.memoryLimit)}</strong><p>每轮最多递入条数</p></section>
      </div>
      <section class="feature-group"><h2>通用集成</h2><div class="feature-card">
        ${integrations.length?integrations.map((item)=>row(item.label||item.id,item.configured?'已配置':'需要自托管 adapter')).join(''):'<p class="feature-empty">当前没有可报告的集成状态。</p>'}
      </div></section>`,
    };
  }
  router.register('owner-settings',ownerView);
  router.register('theme-settings',themeView);
  router.register('widgets-home',widgetsView);
  async function handleAction(name,target){
    if(name==='open-settings')return router.open('owner-settings');
    if(name==='themes')return router.open('theme-settings');
    if(name==='open-widgets')return router.open('widgets-home');
    if(name==='theme'){
      shell.setTheme(target?.dataset?.themeId||'default');
      toast('主题已更新');
      return router.refresh({preserveScroll:true});
    }
    if(name==='refresh-widgets'){sourceStatus=null;return router.refresh({preserveScroll:true});}
  }
  async function handleSubmit(name,target){
    if(name!=='names')return;
    const data=new FormData(target);
    storage.update((state)=>{
      state.preferences.ownerName=String(data.get('ownerName')||'Owner').trim().slice(0,80)||'Owner';
      state.preferences.modelPartnerName=String(data.get('modelPartnerName')||'Model Partner').trim().slice(0,80)||'Model Partner';
    });
    toast('显示名已保存');
    return router.refresh({preserveScroll:true});
  }
  return Object.freeze({
    id:'sourcepages',priority:52,mountOrder:52,
    ownsRoute:(route)=>ROUTES.has(route?.name||''),
    ownsEvent(_event,context){
      if(context.namespace!=='sourcepages')return false;
      if(context.eventType==='click'||context.eventType==='submit')return {preventDefault:true};
      return false;
    },
    handleEvent(_event,context){
      return context.eventType==='click'
        ? handleAction(context.name,context.target)
        : handleSubmit(context.name,context.target);
    },
    handleAction,mount(){},refresh(){},destroy(){},
  });
}
