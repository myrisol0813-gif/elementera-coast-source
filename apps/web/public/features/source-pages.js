import { API, requestJson } from '../core/api.js';
import { escapeAttribute, escapeHtml } from '../core/dom.js';
import { THEME_PRESETS, themeLabel } from '../core/themes.js';

const ROUTES=new Set(['owner-settings','theme-settings','widgets-home','run-settings','integrations','cross-window-index']);
function row(title,note,action=''){
  const inner=`<span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(note)}</small></span>`;
  return action
    ? `<button class="feature-row" type="button" data-action="sourcepages:${escapeAttribute(action)}">${inner}<span>›</span></button>`
    : `<div class="feature-row static">${inner}</div>`;
}
export function createSourcePages({router,storage,shell,toast,chat}){
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
          ${row('聊天与上下文设置','回答长度、流式输出、当前对话纸条、记忆与词典。','run-settings')}
          ${row('跨窗口索引','手动查看其他 source 聊天窗口与近期内容。','cross-window')}
          ${row('GitHub / Notion 通用集成','查看 source adapter contract 与自托管配置状态。','integrations')}
          ${row('导出 source 快照','导出聊天、记忆、纸条、词典、外部入口与脱敏工具日志。','export-snapshot')}
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
  function runSettingsView(){
    const run=storage.read().runControl;
    const number=(name,label,min,step=1)=>`<label>${escapeHtml(label)}<input type="number" name="${escapeAttribute(name)}" min="${min}" step="${step}" value="${escapeAttribute(run[name])}"></label>`;
    const yesNo=(name,label)=>`<label>${escapeHtml(label)}<select name="${escapeAttribute(name)}"><option value="true" ${run[name]?'selected':''}>开启</option><option value="false" ${!run[name]?'selected':''}>关闭</option></select></label>`;
    return {
      title:'聊天与上下文设置',
      subtitle:'source 本机运行参数',
      className:'source-pages',
      body:`<form class="feature-card source-form" data-submit="sourcepages:run-settings">
        ${number('recentTurns','最近聊天轮数',1)}
        ${number('contextBudget','上下文 token budget',500,100)}
        <label>回答长度<select name="outputLength"><option value="auto" ${run.outputLength==='auto'?'selected':''}>自然</option><option value="short" ${run.outputLength==='short'?'selected':''}>偏短</option><option value="long" ${run.outputLength==='long'?'selected':''}>偏长</option></select></label>
        ${number('maxOutputTokens','最大输出 token',64,64)}
        <label>表达倾向<select name="creativity"><option value="precise" ${run.creativity==='precise'?'selected':''}>克制</option><option value="balanced" ${run.creativity==='balanced'?'selected':''}>自然</option><option value="expansive" ${run.creativity==='expansive'?'selected':''}>发散</option></select></label>
        ${yesNo('streamingEnabled','流式输出')}
        ${number('soilBudget','当前对话纸条最多字数',300,100)}
        ${number('seedCooldownTurns','线索冷却轮数',0)}
        ${yesNo('worldbookEnabled','世界书 / 词典')}
        ${number('worldbookLimit','每轮最多词条',0)}
        ${number('memoryLimit','本轮记忆召回上限',0)}
        <button class="primary-wide" type="submit">保存运行参数</button>
      </form>
      <p class="feature-note">清空当前对话纸条等数据操作仍放在记忆库中；这里仅编辑运行参数，不删除聊天、线索或记忆。</p>`,
    };
  }
  async function crossWindowView(){
    const current=chat?.getCurrentConversationId?.()||'';
    const data=await requestJson(`${API.crossWindowMessages}?current_conversation_id=${encodeURIComponent(current)}`);
    const sources=Array.isArray(data.sources)?data.sources:[];
    return {
      title:'跨窗口索引',
      subtitle:'屋主 · 人类思考链 / 跨窗口索引',
      className:'source-pages',
      body:`<p class="feature-note">${escapeHtml(data.description||'')}</p>
        <div class="cross-window-list">${sources.length?sources.map((source)=>`<section>
          <header><span><strong>${escapeHtml(source.title||'未命名窗口')}</strong><small>${escapeHtml(source.room_type||'main')} · ${escapeHtml(source.updated_at||'')}</small></span><button type="button" data-action="sourcepages:cross-read" data-id="${escapeAttribute(source.conversation_id)}" ${source.readable?'':'disabled'}>读取最近 4 轮</button></header>
          <div class="cross-window-preview">${(source.turns||[]).slice(-2).flatMap((turn)=>turn.messages||[]).map((message)=>`<p><b>${message.role==='owner'?'屋主':'另一位屋主'}</b> ${escapeHtml(message.preview||'')}</p>`).join('')||'<p>暂无可读取内容。</p>'}</div>
        </section>`).join(''):'<p class="feature-empty">还没有其他聊天窗口。</p>'}</div>`,
    };
  }
  async function integrationsView(){
    try{sourceStatus=await requestJson(API.devSelfCheck);}catch{sourceStatus=null;}
    const items=sourceStatus?.integrations||[];
    return {
      title:'通用集成',
      subtitle:'GitHub / Notion · source adapter contract',
      className:'source-pages',
      headerAction:'<button class="feature-head-action" type="button" data-action="sourcepages:refresh-integrations">刷新</button>',
      body:`<p class="feature-note">公开 source 不携带远端凭证或固定项目地址。接入时由部署者实现自己的 adapter，并在后端保持权限边界与脱敏。</p>
        <div class="integration-grid">${items.length?items.map((item)=>`<section><header><strong>${escapeHtml(item.label||item.id)}</strong><span>${item.configured?'已配置':'未配置'}</span></header><p>${escapeHtml(item.reason||'adapter_not_connected')}</p><small>${(item.capabilities||[]).map(escapeHtml).join(' · ')}</small></section>`).join(''):'<p class="feature-empty">当前没有可报告的集成 contract。</p>'}</div>`,
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
      body:`<section class="daily-grid"><button type="button" data-action="widgets:moments"><span>◌</span><strong>短帖</strong><small>简短记录</small></button><button type="button" data-action="widgets:diaries"><span>□</span><strong>日记</strong><small>长文本记录</small></button></section><div class="widget-grid">
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
  router.register('run-settings',runSettingsView);
  router.register('integrations',integrationsView);
  router.register('cross-window-index',crossWindowView);
  async function handleAction(name,target){
    if(name==='open-settings')return router.open('owner-settings');
    if(name==='themes')return router.open('theme-settings');
    if(name==='open-widgets')return router.open('widgets-home');
    if(name==='run-settings')return router.open('run-settings');
    if(name==='integrations')return router.open('integrations');
    if(name==='cross-window')return router.open('cross-window-index');
    if(name==='cross-read'){
      const id=target?.dataset?.id||'';
      const data=await requestJson(API.crossWindowRead,{method:'POST',body:JSON.stringify({mode:'manual',current_conversation_id:chat?.getCurrentConversationId?.()||'',sources:[{conversation_id:id,turns:4}]})});
      const text=(data.items||[]).flatMap((item)=>item.messages||[]).map((message)=>`${message.role==='owner'?'屋主':'另一位屋主'}：${message.content}`).join('\n\n');
      toast(text?text.slice(0,1200):'这个窗口没有可读取内容。',5200);
      return;
    }
    if(name==='theme'){
      shell.setTheme(target?.dataset?.themeId||'default');
      toast('主题已更新');
      return router.refresh({preserveScroll:true});
    }
    if(name==='refresh-widgets'){sourceStatus=null;return router.refresh({preserveScroll:true});}
    if(name==='refresh-integrations'){sourceStatus=null;return router.refresh({preserveScroll:true});}
    if(name==='export-snapshot'){globalThis.location?.assign?.(API.v1Snapshot);}
  }
  async function handleSubmit(name,target){
    const data=new FormData(target);
    if(name==='run-settings'){
      storage.update((state)=>{
        const integerFields=['recentTurns','contextBudget','maxOutputTokens','soilBudget','seedCooldownTurns','worldbookLimit','memoryLimit'];
        for(const field of integerFields){
          const value=Number(data.get(field));
          if(Number.isFinite(value)&&value>=0)state.runControl[field]=Math.trunc(value);
        }
        state.runControl.outputLength=['auto','short','long'].includes(String(data.get('outputLength')))?String(data.get('outputLength')):'auto';
        state.runControl.creativity=['precise','balanced','expansive'].includes(String(data.get('creativity')))?String(data.get('creativity')):'balanced';
        state.runControl.streamingEnabled=String(data.get('streamingEnabled'))==='true';
        state.runControl.worldbookEnabled=String(data.get('worldbookEnabled'))==='true';
      });
      toast('运行参数已保存');
      return router.refresh({preserveScroll:true});
    }
    if(name!=='names')return;
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
