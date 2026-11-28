import {escapeHtml as h,escapeAttribute as a,q} from '../core/dom.js';
import {requestJson} from '../core/api.js';
const BASE='/api/chat/dream-tide';
const modules=[['includeTime','当前时间'],['includePrevious','上次活动与间隔'],['includeReplies','自主手记与回复'],['readHistory','允许自主选读窗口历史'],['writeNote','允许写自主手记'],['includeCustom','核心自定义'],['includeUserPortrait','用户画像'],['includeSelfPortrait','自我画像'],['includeConversationCount','期间新增对话轮数'],['includeWeather','天气（需窗口现实权限）'],['includeCalendar','未来日历（需窗口现实权限）'],['includeSteps','步数（目前仅本机 Android 可取得）'],['includeAppUsage','应用使用情况（目前仅本机 Android 可取得）'],['allowWeb','独立联网（已配置供应商）'],['allowLibrary','书房阅读'],['allowMemory','按需检索正式记忆'],['allowMemoryCandidate','提议记忆候选（仅待确认）'],['allowCalendar','查阅日历'],['allowCollection','查阅收藏'],['allowLibraryWrite','创建自己的书房笔记'],['allowDailyWrite','新增自己的日记与动态'],['allowCalendarWrite','新增日历事项'],['allowVoice','自主语音（独立供应商费用）'],['allowImage','自主生图（独立供应商费用）'],['allowImageReadback','允许将本次自主生图原件转交支持视觉的模型（计入推理预算）']];
const names={running:'活动中',completed:'已结束',failed:'未完成',cancelled:'已取消',interrupted:'已中断',claimed:'已认领，结果未确认'};
const toolNames={voice_create:'自主语音',image_generate:'自主生图',dream_read_history:'阅读历史',dream_write_note:'写自主手记',dream_memory_candidate:'提议记忆候选',dream_schedule_extra:'提议额外唤醒'};
const row=(label,body)=>'<label>'+h(label)+body+'</label>';
const input=(id,value,type='text',extra='')=>'<input id="'+id+'" type="'+type+'" value="'+a(String(value??''))+'" '+extra+'>';
const checkbox=(id,label,checked)=>'<label class="coast-toggle-row"><span>'+h(label)+'</span><input type="checkbox" id="'+id+'" '+(checked?'checked':'')+'></label>';
const button=(label,action,extra='')=>'<button type="button" class="feature-row" data-action="dream-tide:'+action+'" '+extra+'><span><strong>'+h(label)+'</strong></span></button>';
const mediaLink=(cid,claim,t)=>{
  const id=t.receipt?.record_id;
  const audio=t.tool_name==='voice_create'&&typeof id==='string'&&id==='voice_dream_'+claim+'_'+t.step_index+'_'+t.call_index;
  const image=t.tool_name==='image_generate'&&typeof id==='string'&&id==='att_dream_'+claim+'_'+t.step_index+'_'+t.call_index;
  if(!audio&&!image)return '';
  const url=audio?'/api/voice/clips/'+encodeURIComponent(id)+'/audio':'/api/chat/attachments/'+encodeURIComponent(id)+'?conversation_id='+encodeURIComponent(cid)+'&inline=1';
  return '<p><a target="_blank" rel="noopener" href="'+a(url)+'">'+(audio?'查看原声':'查看原图')+'</a></p>';
};
const section=(title,body)=>'<section class="feature-group"><h2>'+h(title)+'</h2><div class="feature-card dream-tide-card">'+body+'</div></section>';
const stamp=v=>Number.isFinite(v)?new Date(v).toLocaleString():'未记录';
 
const safeCode=v=>typeof v==='string'&&/^[A-Za-z0-9_.:/-]{1,180}$/.test(v)?v:'未确认';
const num=v=>Number.isSafeInteger(v)?String(v):'未确认';
const phaseLabels={claimed:'已认领',context:'准备上下文',tools_prepare:'准备工具',claim_response_ready:'服务端已准备认领回执，手机接收未确认',device_received:'手机已收到认领回执',request_prepare:'准备模型请求',request_reserved:'已预留请求，送达尚未确认',provider_wait:'等待模型回执',step_delivery:'交付模型响应',tool_dispatch:'执行工具',step_recorded:'请求及工具结果已记录',finish:'收尾'};
const reasonLabels={ended:'正常结束',heartbeat_expired:'超过回收期限未取得活动更新',context_unavailable:'上下文准备失败',tool_context_unavailable:'工具准备失败',plan_request_timeout:'模型请求超时',plan_network_error:'网络连接异常',plan_response_decode_error:'响应解析失败',plan_soft_budget_exhausted:'剩余软预算不足',plan_step_or_soft_budget_limit:'套餐请求次数或软预算达到上限',authorization_ended:'授权已改变',authorization_or_task_ended:'授权或执行任务中止'};
function activityDiagnostic(r){
  const d=r.result||{},steps=r.steps||[],tools=r.tools||[],limits=d.limits||{};
  const lines=['执行模式：在线','活动 ID：'+safeCode(r.claim_id),'模型：'+safeCode(r.model_id),'状态：'+(names[r.status]||safeCode(r.status)),'认领时间：'+stamp(r.started_at),'阶段：'+(phaseLabels[d.phase]||safeCode(d.phase))];
  for(const [label,v] of [['阶段更新时间',d.phase_at],['最近心跳',d.heartbeat_at],['最近记录更新',r.updated_at],['回收前最后更新',d.last_activity_at],['回收时间',d.recovered_at]])if(Number.isSafeInteger(v))lines.push(label+'：'+stamp(v));else if(label==='最近心跳')lines.push(label+'：未记录');
  if(d.reason)lines.push('结束原因：'+(reasonLabels[d.reason]||safeCode(d.reason))+' · '+safeCode(d.reason));else if(r.status!=='running')lines.push('结束原因：未确认（旧记录可能没有诊断）');
  const known=steps.map(s=>s.receipt?.usage?.total_tokens).filter(v=>Number.isSafeInteger(v)&&v>=0);
  lines.push('已确认请求 token 合计：'+(Number.isSafeInteger(d.confirmed_tokens)?d.confirmed_tokens:known.length?known.reduce((a,b)=>a+b,0):'未确认')+' / '+num(limits.token_budget),'已预留请求：'+steps.length+' / '+num(limits.request_limit),'已记录工具：'+tools.length+' / '+num(limits.tool_budget));
  for(const s of steps){
    lines.push('请求 '+(Number.isSafeInteger(s.step_index)?s.step_index+1:'?')+' · '+(names[s.status]||safeCode(s.status))+' · token '+num(s.receipt?.usage?.total_tokens),'  预留：'+stamp(s.started_at)+' · 回执：'+stamp(s.finished_at));
    if(s.receipt?.finish_reason)lines.push('  结束标记：'+safeCode(s.receipt.finish_reason));
    if(s.receipt?.error_type)lines.push('  错误：'+safeCode(s.receipt.error_type));
    if(Number.isInteger(s.receipt?.http_status))lines.push('  HTTP：'+s.receipt.http_status);
  }
  for(const t of tools)lines.push('工具：'+(toolNames[t.tool_name]||safeCode(t.tool_name))+' · '+(names[t.status]||safeCode(t.status))+' · '+stamp(t.started_at)+' → '+stamp(t.finished_at));
  if(steps.some(s=>s.status==='claimed'||s.status==='failed'))lines.push('存在未确认或失败请求，可能已消耗额度；不会自动重放。');
  if(['failed','interrupted','cancelled'].includes(r.status)&&tools.some(t=>t.status==='completed'))lines.push('部分成功：已完成的工具与作品保留。');
  return lines.join('\n');
}

const query=(path,cid,offset=0)=>BASE+path+'?'+new URLSearchParams({conversation_id:cid,limit:'20',offset:String(offset)});
const post=(path,data)=>requestJson(BASE+path,{method:'POST',body:JSON.stringify(data)});
export function createDreamTideViews({router,chat,toast}){
  let configState=null,busy=false,notesOffset=0,activityOffset=0,notesWindow=null,activityWindow=null;
  const current=()=>chat.getCurrentConversationId();
  const pinned=()=>router.current()?.params?.conversationId||null;
  const open=cid=>router.open('dream-tide',{conversationId:cid});
  const nav=title=>'<nav class="coast-segments dream-tide-nav" aria-label="自主唤醒分区">'+[['唤醒设置','open','自主唤醒'],['自主手记','notes','自主手记'],['活动记录','activity','活动记录']].map(([label,action,active])=>'<button type="button" data-action="dream-tide:'+action+'" aria-pressed="'+(title===active)+'">'+h(label)+'</button>').join('')+'</nav>';
  const page=(title,body)=>({title,subtitle:'当前窗口 · 独立于普通聊天',className:'settings-form dream-tide-panel',body:nav(title)+body});
  const noWindow=()=>page('自主唤醒','<p class="feature-note">请先打开支持自主唤醒的普通聊天窗口。</p>');
  router.register('dream-tide',async({conversationId:cid}={})=>{if(!cid)return noWindow();
    const data=await requestJson(query('',cid)),s=data.settings,c=s.config||{},e=c.execution||{};
    configState={cid,s,available:data.executionAvailable&&data.schedulerConfigured};
    const model=s.modelId||chat.getProfile().current_chat_model||'';
    const zone=c.timeZone||Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
    const status=s.enabled?(s.running?'活动中':'已授权'):'未授权';
    const deviceModel=model.startsWith('chatgpt-plan:');
    const notice=deviceModel?(data.planExecutionAvailable?'套餐唤醒由已授权 Android 设备执行，网页可查看、保存设置或撤销；不能在网页授权手机账号。':'手机端套餐调度尚未开放，可保存草稿。'):configState.available?'服务端已配置调度；授权后才会请求模型。':'当前服务端未开通实际调度；可保存设置，不会自动请求模型。';
    return page('自主唤醒',section('当前状态','<p class="feature-note">'+h(status+' · '+notice)+'</p>'+
      (s.extraAt?'<p class="feature-note">下一次额外预约：'+h(stamp(s.extraAt))+'</p>':'')+
      (s.enabled?button('关闭唤醒授权','disarm'):''))
      +section('唤醒与模型','<div class="form-stack">'+row('绑定模型 ID',input('dreamModel',model,'text','maxlength="180"'))+
      '<div class="coast-field-pair">'+row('时区（IANA）',input('dreamZone',zone))+row('每日固定时间',input('dreamTime',c.dailyTime||'09:00','time'))+'</div>'+
      checkbox('dreamQuiet','安静时段',!!c.quietHours)+'<div class="coast-field-pair">'+row('开始',input('dreamQuietStart',c.quietHours?.start||'23:00','time'))+
      row('结束',input('dreamQuietEnd',c.quietHours?.end||'07:00','time'))+'</div>'+checkbox('dreamExtra','允许模型自主预约额外唤醒',c.allowExtra)+
      row('每日额外唤醒次数上限',input('dreamExtraLimit',e.extraPerDay??0,'number','min="0" max="2147483646" step="1"'))+'</div>')
      +section('独立预算与邀请','<div class="form-stack"><div class="coast-field-pair">'+row('单次累计 token 预算',input('dreamTokens',e.tokenBudget??8000,'number','min="1" max="2147483646" step="1"'))+
      row('每次请求输出上限',input('dreamOutput',e.outputLimit??1000,'number','min="1" max="2147483646" step="1"'))+
      row('单次工具调用上限',input('dreamTools',e.toolBudget??4,'number','min="0" max="2147483646" step="1"'))+
      row('每次阅读最大轮数',input('dreamReadTurns',e.readTurns??10,'number','min="1" max="2147483646" step="1"'))+
       row('每次活动语音尝试上限',input('dreamVoiceLimit',e.voiceLimit??1,'number','min="0" max="2147483646" step="1"'))+
       row('每次活动生图尝试上限',input('dreamImageLimit',e.imageLimit??1,'number','min="0" max="2147483646" step="1"'))+
      '</div>'+row('唤醒邀请词','<textarea id="dreamInvitation" maxlength="16000" rows="7">'+h(e.invitation||'')+'</textarea>')+
      '<p class="feature-note">预算为自填整数，范围 1–2147483646；次数允许 0 表示禁止该项。输出仍受累计剩余预算、供应商与上下文约束。单次历史读取正文最多 60000 字符，请按需分页。邀请词最多 16000 字符。模型可以什么也不做。实际收费以供应商为准。</p></div>')
      +section('注入与工具','<div class="form-stack coast-toggle-stack">'+modules.map(([key,label])=>checkbox('dream-'+key,label,e[key]===true)).join('')+'</div>')
      +section('保存与授权','<p class="feature-note">保存为草稿会保持或恢复暂停状态，不会发起请求。授权绑定本窗口及指定模型。</p>'+
      button('保存设置（不启用）','save')+checkbox('dreamConsent','我确认允许按上述设置进行模型调用并产生相应费用',false)+
      (configState.available&&!deviceModel?button('保存并授权唤醒','arm'):'<p class="feature-note">'+(deviceModel?'套餐授权请在 Android 在线模式完成。':'实际调度尚未开通。')+'</p>')));
  });
  router.register('dream-tide-notes',async({conversationId:cid}={})=>{if(!cid)return noWindow();
    if(notesWindow!==cid){notesWindow=cid;notesOffset=0;}
    const d=await requestJson(query('/notes',cid,notesOffset));
    const body=d.items.map(n=>'<article class="feature-group"><h2>'+h(stamp(n.created_at)+' · '+n.model_id)+'</h2><div class="feature-card dream-tide-card">'+
      '<p style="white-space:pre-wrap;overflow-wrap:anywhere">'+h(n.body)+'</p>'+
      n.replies.map(r=>'<p class="feature-note" style="white-space:pre-wrap;overflow-wrap:anywhere">'+h(stamp(r.created_at)+' · 回复\n'+r.body)+'</p>').join('')+
      '<div class="form-stack"><label>回复<textarea rows="3" maxlength="16000"></textarea></label>'+button('保存回复','reply','data-cid="'+a(cid)+'" data-claim="'+a(n.claim_id)+'"')+'</div></div></article>').join('');
    return page('自主手记',(body||'<p class="feature-note">还没有自主手记。</p>')+'<p class="feature-note">回复只保存文字，不立即唤醒模型。</p>'+
      (notesOffset?button('上一页','notes-prev'):'')+(d.nextOffset!==null?button('下一页','notes-next'):''));
  });
  router.register('dream-tide-activity',async({conversationId:cid,mediaId}={})=>{if(!cid)return noWindow();
    if(activityWindow!==cid){activityWindow=cid;activityOffset=0;}
    const d=await requestJson(query('/activity',cid,mediaId?0:activityOffset)+(mediaId?'&media_id='+encodeURIComponent(mediaId):''));
    const body=d.items.map(r=>section(stamp(r.started_at)+' · '+(r.kind==='daily'?'固定唤醒':'额外唤醒'),
      '<p>'+h(names[r.status]||r.status)+'</p><p class="feature-note">'+h(r.model_id)+'</p>'+
      (r.result?.reason?'<p class="feature-note">活动回执：'+h((reasonLabels[r.result.reason]||safeCode(r.result.reason))+' · '+safeCode(r.result.reason))+'</p>':r.status!=='running'?'<p class="feature-note">结束原因未确认（旧记录可能没有诊断）</p>':'')+
      (r.result?.phase?'<p class="feature-note">阶段：'+h(phaseLabels[r.result.phase]||safeCode(r.result.phase))+'</p>':'')+
      (r.status==='running'?'<p class="feature-note">最近心跳：'+h(stamp(r.result?.heartbeat_at))+'</p>':'')+
      (['failed','interrupted','cancelled'].includes(r.status)&&r.tools.some(t=>t.status==='completed')?'<p class="feature-note">部分成功 · 已完成的工具与作品保留</p>':'')+
      '<details class="dream-diagnostic"><summary>展开详细回执</summary><pre class="feature-note" style="white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;font-size:12px">'+h(activityDiagnostic(r))+'</pre>'+button('复制脱敏诊断','copy-diagnostic')+'</details>'+
      '<p class="feature-note">总 token：'+h(r.result?.total_tokens??'未确认')+' · 供应商报告成本：'+h(r.result?.reported_cost==null?'未确认':'USD '+r.result.reported_cost)+'</p>'+
      r.tools.map(t=>'<p class="feature-note">'+h((toolNames[t.tool_name]||t.tool_name)+' · '+(names[t.status]||t.status)+(Number.isInteger(t.receipt?.count)?' · '+t.receipt.count+' 轮':''))+'</p>'+mediaLink(cid,r.claim_id,t)).join('')+
      (r.result?.extra_scheduled?'<p class="feature-note">已保存额外预约。</p>':'')+
      r.steps.map(s=>'<p class="feature-note">'+h(Array.isArray(s.receipt?.image_readback_accepted)?'图像回读请求已获得响应 · '+s.receipt.image_readback_accepted.length+' 张':Array.isArray(s.receipt?.image_readback_unconfirmed)?'图像回读请求结果未确认 · '+s.receipt.image_readback_unconfirmed.length+' 张':'')+'</p>').filter(x=>x!=='<p class="feature-note"></p>').join('')+
      (r.steps.some(s=>s.status==='claimed')?'<p class="feature-note">存在未确认请求，不会自动重放。</p>':''))).join('');
    return page('活动记录',(mediaId?'<p class="feature-note">作品来源 · '+h(mediaId)+'</p>':'')+(body||'<p class="feature-note">'+(mediaId?'未找到对应的活动记录。':'还没有活动记录。')+'</p>')+
      button('刷新活动记录','refresh-activity')+(mediaId?button('查看全部活动','activity'):(activityOffset?button('上一页','activity-prev'):'')+(d.nextOffset!==null?button('下一页','activity-next'):'')));
  });
  const value=id=>q('#'+id)?.value??'';
  const checked=id=>q('#'+id)?.checked===true;
  const number=id=>{const v=value(id),field=q('#'+id),label=field?.closest('label')?.textContent?.trim()||id,min=Number(field?.min||0),n=Number(v);if(!v.trim()||!Number.isSafeInteger(n)||n<min||n>2147483646)throw Error(label+'：请输入 '+min+'–2147483646 的整数。');return n;};
  async function handle(name,target){
    const cid=pinned();
    if(!cid||cid!==current())return toast('窗口已切换，请从当前窗口重新打开自主唤醒。');
    if(name==='refresh-activity')return router.refresh();
    if(name==='open')return open(cid);
    if(name==='notes'){notesOffset=0;return router.open('dream-tide-notes',{conversationId:cid});}
    if(name==='activity'){activityOffset=0;return router.open('dream-tide-activity',{conversationId:cid});}
    if(name==='notes-prev'||name==='notes-next'){notesOffset=Math.max(0,notesOffset+(name.endsWith('next')?20:-20));return router.refresh();}
    if(name==='copy-diagnostic'){
      const text=target.closest('.dream-diagnostic')?.querySelector('pre')?.textContent;
      if(!text)return toast('诊断不存在');
      try{await navigator.clipboard.writeText(text);toast('已复制脱敏诊断');}catch{toast('复制未完成，请选择诊断文字手动复制。');}return;
    }
    if(name==='activity-prev'||name==='activity-next'){activityOffset=Math.max(0,activityOffset+(name.endsWith('next')?20:-20));return router.refresh();}
    if(busy)return;busy=true;
    try{
      if(name==='reply'){
        const cid=target.dataset.cid,claim=target.dataset.claim,box=target.closest('.form-stack')?.querySelector('textarea'),body=box?.value;
        if(cid!==pinned()||cid!==current()||!body?.trim())throw Error('请填写回复。');
        // Keep the ID for a network-ambiguous retry of the same text.
        if(box.dataset.replyBody!==body){box.dataset.replyId=crypto.randomUUID();box.dataset.replyBody=body;}
        await post('/reply',{conversation_id:cid,claim_id:claim,reply_id:box.dataset.replyId,body});
        toast('回复已保存');return router.refresh();
      }
      if(!configState||configState.cid!==pinned()||configState.cid!==current())throw Error('窗口已切换，请重新打开。');
      const data={conversation_id:configState.cid,revision:configState.s.revision,action:name};
      if(name!=='disarm'){
        if(!['save','arm'].includes(name))return;
        if(name==='arm'&&(!configState.available||!checked('dreamConsent')))throw Error('请明确确认执行授权。');
        data.modelId=value('dreamModel').trim();data.confirmExecution=checked('dreamConsent');
        if(name==='arm'&&data.modelId.startsWith('chatgpt-plan:'))throw Error('套餐授权请在 Android 在线模式完成。');
        data.config={timeZone:value('dreamZone').trim(),dailyTime:value('dreamTime'),allowExtra:checked('dreamExtra'),
          quietHours:checked('dreamQuiet')?{start:value('dreamQuietStart'),end:value('dreamQuietEnd')}:null,
          execution:{invitation:value('dreamInvitation'),tokenBudget:number('dreamTokens'),outputLimit:number('dreamOutput'),toolBudget:number('dreamTools'),readTurns:number('dreamReadTurns'),extraPerDay:number('dreamExtraLimit'),voiceLimit:number('dreamVoiceLimit'),imageLimit:number('dreamImageLimit'),
            ...Object.fromEntries(modules.map(([key])=>[key,checked('dream-'+key)]))}};
      }
      await post('',data);toast(name==='arm'?'已授权自主唤醒':name==='disarm'?'已撤回授权':'设置已保存 · 未启用');return router.refresh();
    }catch(e){toast(e.message||'操作未完成',4500);}finally{busy=false;}
  }
  function ownsRoute(route){return ['dream-tide','dream-tide-notes','dream-tide-activity'].includes(route?.name);}
  function ownsEvent(_event,context){return context.namespace==='dream-tide'&&context.eventType==='click'?{preventDefault:true}:false;}
  function handleEvent(_event,context){return handle(context.name,context.target);}
  function mount(){}
  function refresh({navigation}={}){
    if(navigation&&!ownsRoute(navigation.current)){configState=null;notesOffset=0;activityOffset=0;notesWindow=null;activityWindow=null;}
  }
  function destroy(){configState=null;notesOffset=0;activityOffset=0;notesWindow=null;activityWindow=null;}
  return Object.freeze({id:'dream-tide',priority:60,mountOrder:60,ownsRoute,ownsEvent,handleEvent,mount,refresh,destroy,open,handleAction:handle});
}
