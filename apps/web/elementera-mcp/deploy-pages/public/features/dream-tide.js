import {escapeHtml as h,escapeAttribute as a,q} from '../core/dom.js';
import {requestJson} from '../core/api.js';
const BASE='/api/chat/dream-tide';
const modules=[['includeTime','当前时间'],['includePrevious','上次活动与间隔'],['includeReplies','自主手记与回复'],['readHistory','允许自主选读窗口历史'],['writeNote','允许写自主手记'],['includeCustom','核心自定义'],['includeUserPortrait','用户画像'],['includeSelfPortrait','自我画像'],['includeConversationCount','期间新增对话轮数'],['includeWeather','天气（需窗口现实权限）'],['includeCalendar','未来日历（需窗口现实权限）'],['includeSteps','步数（目前仅本机 Android 可取得）'],['includeAppUsage','应用使用情况（目前仅本机 Android 可取得）'],['allowWeb','独立联网（已配置供应商）'],['allowLibrary','书房阅读'],['allowMemory','按需检索正式记忆'],['allowMemoryCandidate','提议记忆候选（仅待确认）'],['allowCalendar','查阅日历'],['allowCollection','查阅收藏'],['allowLibraryWrite','创建自己的书房笔记'],['allowDailyWrite','新增自己的日记与动态'],['allowCalendarWrite','新增日历事项'],['allowVoice','自主语音（独立供应商费用）'],['allowImage','自主生图（独立供应商费用）'],['allowImageReadback','允许将本次自主生图原件转交支持视觉的模型（计入推理预算）']];
const names={running:'活动中',completed:'已结束',failed:'未完成',cancelled:'已取消',interrupted:'已中断',claimed:'已认领，结果未确认'};
const toolNames={voice_create:'自主语音',image_generate:'自主生图',dream_read_history:'阅读历史',dream_write_note:'写自主手记',dream_memory_candidate:'提议记忆候选',dream_schedule_extra:'提议额外唤醒'};
const row=(label,body)=>'<label>'+h(label)+body+'</label>';
const input=(id,value,type='text',extra='')=>'<input id="'+id+'" type="'+type+'" value="'+a(String(value??''))+'" '+extra+'>';
const checkbox=(id,label,checked)=>'<label><input type="checkbox" id="'+id+'" '+(checked?'checked':'')+'> '+h(label)+'</label>';
const button=(label,action,extra='')=>'<button type="button" class="feature-row" data-action="dream-tide:'+action+'" '+extra+'><span><strong>'+h(label)+'</strong></span></button>';
const mediaLink=(cid,claim,t)=>{
  const id=t.receipt?.record_id;
  const audio=t.tool_name==='voice_create'&&typeof id==='string'&&id==='voice_dream_'+claim+'_'+t.step_index+'_'+t.call_index;
  const image=t.tool_name==='image_generate'&&typeof id==='string'&&id==='att_dream_'+claim+'_'+t.step_index+'_'+t.call_index;
  if(!audio&&!image)return '';
  const url=audio?'/api/voice/clips/'+encodeURIComponent(id)+'/audio':'/api/chat/attachments/'+encodeURIComponent(id)+'?conversation_id='+encodeURIComponent(cid)+'&inline=1';
  return '<p><a target="_blank" rel="noopener" href="'+a(url)+'">'+(audio?'查看原声':'查看原图')+'</a></p>';
};
const section=(title,body)=>'<section class="feature-group"><h2>'+h(title)+'</h2><div class="feature-card">'+body+'</div></section>';
const stamp=v=>Number.isFinite(v)?new Date(v).toLocaleString():'未记录';
const query=(path,cid,offset=0)=>BASE+path+'?'+new URLSearchParams({conversation_id:cid,limit:'20',offset:String(offset)});
const post=(path,data)=>requestJson(BASE+path,{method:'POST',body:JSON.stringify(data)});
export function createDreamTideViews({router,chat,toast}){
  let configState=null,busy=false,notesOffset=0,activityOffset=0,notesWindow=null,activityWindow=null;
  const current=()=>chat.getCurrentConversationId();
  const pinned=()=>router.current()?.params?.conversationId||null;
  const open=cid=>router.open('dream-tide',{conversationId:cid});
  const nav=()=>'<div class="feature-card">'+button('唤醒设置','open')+button('自主手记','notes')+button('活动记录','activity')+'</div>';
  const page=(title,body)=>({title,subtitle:'当前窗口 · 独立于普通聊天',className:'settings-form',body:nav()+body});
  const noWindow=()=>page('自主唤醒','<p class="feature-note">请先打开支持自主唤醒的普通聊天窗口。</p>');
  router.register('dream-tide',async({conversationId:cid}={})=>{if(!cid)return noWindow();
    const data=await requestJson(query('',cid)),s=data.settings,c=s.config||{},e=c.execution||{};
    configState={cid,s,available:data.executionAvailable&&data.schedulerConfigured};
    const model=s.modelId||chat.getProfile().current_chat_model||'';
    const zone=c.timeZone||Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
    const status=s.enabled?(s.running?'活动中':'已授权'):'未授权';
    const notice=configState.available?'服务端已配置调度；授权后才会请求模型。':'当前服务端未开通实际调度；可保存设置，不会自动请求模型。';
    return page('自主唤醒',section('当前状态','<p class="feature-note">'+h(status+' · '+notice)+'</p>'+
      (s.extraAt?'<p class="feature-note">下一次额外预约：'+h(stamp(s.extraAt))+'</p>':'')+
      (s.enabled?button('关闭唤醒授权','disarm'):''))
      +section('唤醒与模型','<div class="form-stack">'+row('绑定模型 ID',input('dreamModel',model,'text','maxlength="180"'))+
      row('时区（IANA）',input('dreamZone',zone))+row('每日固定时间',input('dreamTime',c.dailyTime||'09:00','time'))+
      checkbox('dreamQuiet','安静时段',!!c.quietHours)+row('开始',input('dreamQuietStart',c.quietHours?.start||'23:00','time'))+
      row('结束',input('dreamQuietEnd',c.quietHours?.end||'07:00','time'))+checkbox('dreamExtra','允许模型自主预约额外唤醒',c.allowExtra)+
      row('每日额外唤醒次数上限',input('dreamExtraLimit',e.extraPerDay??0,'number','min="0" max="128" step="1"'))+'</div>')
      +section('独立预算与邀请','<div class="form-stack">'+row('单次累计 token 预算',input('dreamTokens',e.tokenBudget??8000,'number','min="1" max="1000000" step="1"'))+
      row('每次请求输出上限',input('dreamOutput',e.outputLimit??1000,'number','min="1" max="65536" step="1"'))+
      row('单次工具调用上限',input('dreamTools',e.toolBudget??4,'number','min="0" max="128" step="1"'))+
      row('每次阅读最大轮数',input('dreamReadTurns',e.readTurns??10,'number','min="1" max="400" step="1"'))+
       row('每次活动语音尝试上限',input('dreamVoiceLimit',e.voiceLimit??1,'number','min="0" max="128" step="1"'))+
       row('每次活动生图尝试上限',input('dreamImageLimit',e.imageLimit??1,'number','min="0" max="128" step="1"'))+
      row('唤醒邀请词','<textarea id="dreamInvitation" maxlength="16000" rows="7">'+h(e.invitation||'')+'</textarea>')+
      '<p class="feature-note">邀请词由你书写。模型可以什么也不做。输入 token 为估算，实际收费以供应商为准。</p></div>')
      +section('注入与工具','<div class="form-stack">'+modules.map(([key,label])=>checkbox('dream-'+key,label,e[key]===true)).join('')+'</div>')
      +section('保存与授权','<p class="feature-note">保存为草稿会保持或恢复暂停状态，不会发起请求。授权绑定本窗口及指定模型。</p>'+
      button('保存设置（不启用）','save')+checkbox('dreamConsent','我确认允许按上述设置进行模型调用并产生相应费用',false)+
      (configState.available?button('保存并授权唤醒','arm'):'<p class="feature-note">实际调度尚未开通。</p>')));
  });
  router.register('dream-tide-notes',async({conversationId:cid}={})=>{if(!cid)return noWindow();
    if(notesWindow!==cid){notesWindow=cid;notesOffset=0;}
    const d=await requestJson(query('/notes',cid,notesOffset));
    const body=d.items.map(n=>'<article class="feature-group"><h2>'+h(stamp(n.created_at)+' · '+n.model_id)+'</h2><div class="feature-card">'+
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
      '<p class="feature-note">总 token：'+h(r.result?.total_tokens??'未确认')+' · 供应商报告成本：'+h(r.result?.reported_cost==null?'未确认':'USD '+r.result.reported_cost)+'</p>'+
      r.tools.map(t=>'<p class="feature-note">'+h((toolNames[t.tool_name]||t.tool_name)+' · '+(names[t.status]||t.status)+(Number.isInteger(t.receipt?.count)?' · '+t.receipt.count+' 轮':''))+'</p>'+mediaLink(cid,r.claim_id,t)).join('')+
      (r.result?.extra_scheduled?'<p class="feature-note">已保存额外预约。</p>':'')+
      (r.steps.some(s=>s.status==='claimed')?'<p class="feature-note">存在未确认请求，不会自动重放。</p>':''))).join('');
    return page('活动记录',(mediaId?'<p class="feature-note">作品来源 · '+h(mediaId)+'</p>':'')+(body||'<p class="feature-note">'+(mediaId?'未找到对应的活动记录。':'还没有活动记录。')+'</p>')+
      (mediaId?button('查看全部活动','activity'):(activityOffset?button('上一页','activity-prev'):'')+(d.nextOffset!==null?button('下一页','activity-next'):'')));
  });
  const value=id=>q('#'+id)?.value??'';
  const checked=id=>q('#'+id)?.checked===true;
  const number=id=>{const v=value(id);if(!v.trim()||!Number.isSafeInteger(Number(v)))throw Error('请填写完整整数预算。');return Number(v);};
  async function handle(name,target){
    const cid=pinned();
    if(!cid||cid!==current())return toast('窗口已切换，请从当前窗口重新打开自主唤醒。');
    if(name==='open')return open(cid);
    if(name==='notes'){notesOffset=0;return router.open('dream-tide-notes',{conversationId:cid});}
    if(name==='activity'){activityOffset=0;return router.open('dream-tide-activity',{conversationId:cid});}
    if(name==='notes-prev'||name==='notes-next'){notesOffset=Math.max(0,notesOffset+(name.endsWith('next')?20:-20));return router.refresh();}
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
