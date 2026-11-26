import { openArchiveV2 } from '../core/archive-v2-read.js';
import { archiveV2Transport as api } from '../core/archive-v2-transport.js';
import { escapeHtml } from '../core/dom.js';
import {decodeDeviceBasic,restoreDeviceBasic} from '../core/archive-v2-device-settings.js';
const APP='com.elementeracoast.source';
const line=(title,body)=>'<div class="feature-row static"><span><strong>'+escapeHtml(title)+'</strong><small>'+escapeHtml(body)+'</small></span></div>';
const action=(key,label,disabled)=>'<button class="primary-wide" type="button" data-action="settings:transfer-v2-'+key+'" '+(disabled?'disabled':'')+'>'+escapeHtml(label)+'</button>';
const labels={chat:'聊天',attachments:'附件',voice:'语音',dogtalk_records:'私人草稿',dogtalk_snapshots:'历史快照',thinking_soil:'思维壤',thinking_soil_history:'思维壤历史',memory_entries:'记忆',memory_pockets:'候选',calendar:'日历',daily:'日常',model_profile:'模型资料',user_portrait:'用户画像',self_portrait:'自我画像',worldbook:'世界书',custom_instructions:'自定义',vault:'拾潮',library:'书房',appearance:'设备外观与基本设置',tools:'工具历史（脱敏）'};
// Match the server's restore-group rules, then include the declared dependency
// closure. Every choice uses a separate staging session; unrelated originals
// never leave the device.
export async function selectedArchiveManifest(m,choice){
  if(!choice||choice.kind==='appearance')throw Error('请选择可恢复资料');
  const module=choice.kind==='book'?'library':choice.kind;
  const bookId=choice.kind==='book'?'library_books:'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([choice.id])))),x=>x.toString(16).padStart(2,'0')).join(''):choice.id;
  const rootKey=module+'/'+bookId,key=r=>r.module+'/'+r.id,index=new Map(m.records.map(r=>[key(r),r]));
  if(!index.has(rootKey))throw Error('所选资料不在归档清单中');
  const keep=new Set([rootKey]),chatChildren=new Set(['attachments','voice','dogtalk_records','dogtalk_snapshots','thinking_soil','thinking_soil_history']);
  for(const r of m.records){
    const linked=r.dependencies.includes(rootKey);
    if(choice.kind==='chat'&&chatChildren.has(r.module)&&linked||choice.kind==='book'&&r.module==='library'&&linked||choice.kind==='daily'&&r.module==='daily'&&linked||['user_portrait','self_portrait'].includes(choice.kind)&&r.module===module)keep.add(key(r));
  }
  // Set iteration also visits newly appended dependency keys.
  for(const k of keep)for(const d of index.get(k).dependencies){
    if(!index.has(d)||index.get(d).module==='appearance')throw Error('归档依赖不完整');
    keep.add(d);
  }
  const records=m.records.filter(r=>keep.has(key(r))),used=new Set(records.flatMap(r=>[r.record_object,...r.media_objects])),counts=new Map();
  for(const r of records)counts.set(r.module,(counts.get(r.module)||0)+1);
  return {...m,records,objects:m.objects.filter(d=>used.has(d.object_sha256)),modules:m.modules.map(v=>({...v,coverage:counts.has(v.module)?'partial':'unavailable',count:counts.get(v.module)||0}))};
}
export function createV2Transfer({router,toast,chat,storage}){
  const remoteManifest=m=>{const records=m.records.filter(r=>r.module!=='appearance'),used=new Set(records.flatMap(r=>[r.record_object,...r.media_objects]));return {...m,records,objects:m.objects.filter(d=>used.has(d.object_sha256)),modules:m.modules.map(v=>v.module==='appearance'?{...v,coverage:'unavailable',count:0}:v)};};
  let incoming=null,choices=[],selected='',preview=null,result=null,session=null,stagedChoice='',stagedManifest=null,uploaded=false,busy=false,failure='',progress='',revision=0;
  const current=()=>router.current()?.name==='settings-transfer';
  const refresh=()=>current()?router.refresh():Promise.resolve();
  // No automatic writes on navigation. Retain the cloud session id until explicitly cancelled.
  async function reset(){
    if(session)await api.cancelSession(session);
    incoming=null;choices=[];selected='';preview=null;result=null;session=null;stagedChoice='';stagedManifest=null;uploaded=false;failure='';progress='';
  }
  async function operate(work){
    if(busy)return;busy=true;failure='';const token=revision;await refresh();
    try{await work(token);}catch(e){if(token===revision)failure=(e.message||'操作未完成').slice(0,160);}
    finally{busy=false;await refresh();}
  }
  router.subscribe(({current:next,previous})=>{
    if(previous?.name==='settings-transfer'&&next?.name!=='settings-transfer'){revision++;}
  });
  function render(){
    if(!incoming&&!busy&&!failure)return '';
    let html='<div class="settings-group"><h2>归档预览</h2>';
    if(incoming){
      const m=incoming.manifest;
      html+=line('归档来源',m.workspace+' · '+m.records.length+' 项记录')+
        m.modules.map(v=>line(labels[v.module]||v.module,v.count+' 项 · '+(v.coverage==='unavailable'?'未采集':'已列入清单'))).join('');
      html+=choices.map(r=>'<button class="feature-row" type="button" data-action="settings:transfer-v2-select" data-id="'+escapeHtml(r.key)+'" aria-pressed="'+(selected===r.key)+'" '+(busy||preview||result?'disabled':'')+'><span><strong>'+escapeHtml(r.title)+'</strong><small>'+escapeHtml(r.kind==='chat'?'聊天窗口':r.kind==='book'?'书房':labels[r.kind])+'</small></span></button>').join('');
      const deviceChoice=choices.find(r=>r.key===selected)?.deviceBasic;
      html+=line('恢复范围',deviceChoice?'只替换当前浏览器的基本设置，不上传云端；不会修改外观、账户或模型密钥。':'仅上传所选项目及其归档依赖；确认后才写入所选资料。');
      if(!choices.length)html+=line('目标暂不支持','请保留原始归档。');
      if(preview||result){const p=result||preview;html+=line(result?'已恢复资料':'预览通过',p.scope==='device_basic'?'基本设置 '+p.count+' 项 · 仅当前浏览器':p.scope==='daily_group'?'评论 '+p.comments+' · 点赞 '+p.likes:p.scope==='portrait_group'?'候选 '+p.candidates+' · 历史 '+p.revisions:p.scope==='record_only'?'新增 '+p.ready+' · 已有 '+p.existing:p.scope==='book_only'?'章节 '+p.chapters+' · 批注 '+p.notes:'轮次 '+p.turns+' · 附件 '+p.attachments+' · 语音 '+p.voices+' · 思维壤 '+p.soils+' · 快照 '+p.snapshots);}
      if(!result)html+=action(preview?'commit':'preview',preview?'确认恢复所选资料':deviceChoice?'预览设备设置':'上传并预览',busy||!selected);
      if(preview&&!result)html+=action('back','返回选择',busy);
      if(result)html+=action('next','继续恢复其他资料',busy);
      html+=action('clear','关闭并清理暂存',busy);
    }
    if(progress)html+=line('进度',progress);
    if(failure)html+=line('操作未完成',failure);
    return html+'</div>';
  }
  async function readFile(file){
    if(!current()||busy||incoming)return;
    return operate(async token=>{
        const data=await openArchiveV2(file,m=>api.validateManifest(remoteManifest(m)));
        if(token!==revision)return;
        // Full byte verification precedes preview and any upload.
        for(const d of data.manifest.objects){for await(const b of data.objectChunks(d)){if(token!==revision)throw Error('已离开归档页面');}progress='正在校验原件';}
        const options=[];
        if(['backend','local'].includes(data.manifest.workspace)){
          const objects=new Map(data.manifest.objects.map(d=>[d.object_sha256,d]));
          for(const r of data.manifest.records){
            if(r.module==='appearance'){
              const d=objects.get(r.record_object);if(!d||d.size>1800000)throw Error('设备设置记录不完整');
              const raw=new Uint8Array(d.size);let at=0;for await(const b of data.objectChunks(d)){raw.set(b,at);at+=b.length;}
              const deviceBasic=decodeDeviceBasic(r,JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)));
              if(deviceBasic&&storage)options.push({key:'device:'+r.id,kind:'appearance',id:r.id,title:'当前浏览器基本设置（需单独确认）',deviceBasic});
              continue;
            }
            if(data.manifest.workspace==='local'&&(!['chat','calendar','daily','model_profile','worldbook','custom_instructions','memory_entries','memory_pockets','user_portrait','self_portrait','thinking_soil','thinking_soil_history','tools','library','vault','dogtalk_records'].includes(r.module)||(['custom_instructions','memory_entries','memory_pockets','user_portrait','self_portrait','thinking_soil','thinking_soil_history','tools','vault','dogtalk_records'].includes(r.module)&&data.manifest.application_id!==APP)))continue;
            if(data.manifest.workspace==='backend'&&!(r.module==='chat'&&data.manifest.application_id===APP)&&!(r.module==='library'&&r.id.startsWith('library_books:'))&&!['calendar','worldbook','model_profile'].includes(r.module)&&!(data.manifest.application_id===APP&&['memory_entries','memory_pockets','user_portrait','self_portrait','daily','vault','custom_instructions','tools','dogtalk_records'].includes(r.module)))continue;
            const d=objects.get(r.record_object);if(!d||d.size>1800000)continue;
            const raw=new Uint8Array(d.size);let at=0;
            for await(const b of data.objectChunks(d)){raw.set(b,at);at+=b.length;}
            const v=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
            if(r.module==='dogtalk_records'&&v.kind===r.module&&v.data?.conversation_id===null&&data.manifest.application_id===APP)options.push({key:r.module+':'+r.id,kind:r.module,id:r.id,title:'房间狗话 · '+v.data.room_scope});
            if(data.manifest.workspace==='local'){
              if(r.module==='library'&&v.kind==='library_books'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(v.data?.id||''))options.push({key:'book:'+v.data.id,kind:'book',id:v.data.id,title:String(v.data.title||v.data.id),local:true});
              if(r.module==='vault'&&['vault_treasures','vault_media_labels'].includes(v.kind))options.push({key:'vault:'+r.id,kind:'vault',id:r.id,title:String(v.data.display_name||v.data.excerpt||v.data.source_id).slice(0,80),local:true});
              const kinds={local_chat:'chat',local_calendar:'calendar',local_moment:'daily',local_diary:'daily',local_daily_profile:'daily',local_model_profile:'model_profile',worldbook:'worldbook',custom_instructions:'custom_instructions',memory_entries:'memory_entries',memory_pockets:'memory_pockets',user_portrait:'user_portrait',self_portrait:'self_portrait',thinking_soil:'thinking_soil',thinking_soil_history:'thinking_soil_history',tools:'tools'};
              if(kinds[v.kind]===r.module){
                const grouped=r.module==='chat'&&data.manifest.records.some(x=>['attachments','voice','dogtalk_records','dogtalk_snapshots','thinking_soil','thinking_soil_history'].includes(x.module)&&x.dependencies.includes('chat/'+r.id));
                if(grouped&&data.manifest.application_id!==APP)continue;
                options.push({key:'local:'+r.module+':'+r.id,kind:r.module,id:r.id,local:true,grouped,title:String(v.data?.conversation?.title||v.data?.title||v.data?.text||labels[r.module]).slice(0,100)});
              }
              continue;
            }
            if(r.module==='chat'&&v.kind==='chat'&&v.data?.conversation?.id===r.id)options.push({key:'chat:'+r.id,kind:'chat',id:r.id,title:String(v.data.conversation.title||r.id)});
            if(r.module==='library'&&v.kind==='library_books'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(v.data?.id||''))options.push({key:'book:'+v.data.id,kind:'book',id:v.data.id,title:String(v.data.title||v.data.id)});
            if(['calendar','worldbook','model_profile','memory_entries','memory_pockets','user_portrait','self_portrait','custom_instructions'].includes(r.module)&&v.kind===r.module&&v.data?.id)options.push({key:r.module+':'+r.id,kind:r.module,id:r.id,title:String(v.data.title||labels[r.module])});
            if(data.manifest.application_id===APP&&r.module==='tools'&&v.kind==='tools')options.push({key:'tools:'+r.id,kind:'tools',id:r.id,title:String(v.data.tool_key||'工具历史')});
            if(data.manifest.application_id===APP&&r.module==='daily'&&['daily_moments','daily_diaries','daily_profile'].includes(v.kind))options.push({key:'daily:'+r.id,kind:'daily',id:r.id,title:v.kind==='daily_profile'?'日常资料':String(v.data.date+' · '+v.data.text).slice(0,80)});
            if(data.manifest.application_id===APP&&r.module==='vault'&&['vault_treasures','vault_media_labels'].includes(v.kind))options.push({key:'vault:'+r.id,kind:'vault',id:r.id,title:String(v.data.display_name||v.data.excerpt||v.data.source_id).slice(0,80)});
          }
        }
        if(token!==revision)return;
        incoming=data;choices=options;selected=options.find(r=>!r.deviceBasic)?.key||'';
        preview=null;result=null;uploaded=false;progress='原件校验完成';
      });
  }
  async function handle(name,target){
    if(!current()||busy)return;
    if(name==='v2-select'&&incoming&&!preview&&!result){const id=target.dataset.id;if(choices.some(r=>r.key===id))selected=id;return refresh();}
    if(name==='v2-back'&&preview&&!result){preview=null;failure='';return refresh();}
    if(name==='v2-next'&&result){choices=choices.filter(r=>r.key!==selected);selected=choices[0]?.key||'';preview=null;result=null;failure='';return refresh();}
    if(name==='v2-clear')return operate(async()=>{await reset();});
    if(name==='v2-preview'&&incoming&&selected&&!result)return operate(async token=>{
      const choice=choices.find(r=>r.key===selected);if(!choice)throw Error('请选择资料');
      if(choice.deviceBasic){
        if(session)await api.cancelSession(session);
        session=null;stagedChoice='';stagedManifest=null;uploaded=false;
        preview={scope:'device_basic',count:Object.keys(choice.deviceBasic).length};return;
      }
      if(stagedChoice!==choice.key){
        if(session)await api.cancelSession(session);
        session=null;stagedChoice='';stagedManifest=null;uploaded=false;
      }
      if(!stagedManifest){stagedManifest=await selectedArchiveManifest(incoming.manifest,choice);stagedChoice=choice.key;}
      if(!session)session=(await api.createSession()).session.id;
      if(!uploaded){
        progress='本次上传 '+stagedManifest.records.length+' 项 · '+stagedManifest.objects.reduce((n,o)=>n+o.size,0)+' 字节';
        let n=0;
        for(const d of stagedManifest.objects){
          if(token!==revision)throw Error('已离开归档页面；可返回继续或清理暂存');
          await api.registerObject(session,d);const received=new Set((await api.status(session,d.object_sha256)).received);
          let i=0;for await(const b of incoming.objectChunks(d)){if(token!==revision)throw Error('已离开归档页面；可返回继续');if(!received.has(i)){await api.putChunk(session,d.object_sha256,i,b);progress='已上传 '+(++n)+' 个新分块';}i++;}
        }
        const p=await api.preflight(session,stagedManifest);if(!p.ready_for_byte_verification)throw Error('云端暂存未到齐');uploaded=true;
      }
      if(token!==revision)return;
      preview=await (choice.kind==='book'?api.restoreBook(session,stagedManifest,choice.id,false):choice.kind==='chat'&&(!choice.local||choice.grouped)?api.restoreChat(session,stagedManifest,choice.id,false):api.restoreRecord(session,stagedManifest,choice.kind,choice.id,false));
    });
    if(name==='v2-commit'&&preview&&!result&&(session||preview.scope==='device_basic'))return operate(async token=>{
      const choice=choices.find(r=>r.key===selected);if(!choice)throw Error('请选择资料');
      if(choice.deviceBasic){
        restoreDeviceBasic(storage,choice.deviceBasic);
        result={scope:'device_basic',count:Object.keys(choice.deviceBasic).length};toast('当前浏览器基本设置已恢复。');return;
      }
      result=await (choice.kind==='book'?api.restoreBook(session,stagedManifest,choice.id,true):choice.kind==='chat'&&(!choice.local||choice.grouped)?api.restoreChat(session,stagedManifest,choice.id,true):api.restoreRecord(session,stagedManifest,choice.kind,choice.id,true));
      await chat.refreshFromCoast();toast('已确认恢复所选资料。');
    });
  }
  return {render,handle,readFile,active:()=>busy||!!incoming};
}
