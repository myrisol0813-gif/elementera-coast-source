import { collectArchiveV2 } from '../core/archive-v2-collect.js';
import { openArchiveV2 } from '../core/archive-v2-read.js';
import { archiveV2Transport as api } from '../core/archive-v2-transport.js';
import { escapeHtml,timestampLabel } from '../core/dom.js';
const APP='com.elementeracoast.source';
const line=(title,body)=>'<div class="feature-row static"><span><strong>'+escapeHtml(title)+'</strong><small>'+escapeHtml(body)+'</small></span></div>';
const action=(key,label,disabled)=>'<button class="primary-wide" type="button" data-action="settings:transfer-v2-'+key+'" '+(disabled?'disabled':'')+'>'+escapeHtml(label)+'</button>';
const labels={chat:'聊天',attachments:'附件',voice:'语音',dogtalk_records:'私人草稿',dogtalk_snapshots:'历史快照',thinking_soil:'思维壤',thinking_soil_history:'思维壤历史',memory_entries:'记忆',memory_pockets:'候选',calendar:'日历',daily:'日常',model_profile:'模型资料',user_portrait:'用户画像',self_portrait:'自我画像',worldbook:'世界书',custom_instructions:'自定义',vault:'拾潮',library:'书房',appearance:'外观',tools:'工具'};
export function createV2Transfer({router,toast,chat}){
  let incoming=null,selected='',preview=null,result=null,session=null,uploaded=false,busy=false,failure='',progress='',revision=0;
  const current=()=>router.current()?.name==='settings-transfer';
  const refresh=()=>current()?router.refresh():Promise.resolve();
  // No automatic writes on navigation. Retain the cloud session id until explicitly cancelled.
  async function reset(){
    if(session)await api.cancelSession(session);
    incoming=null;selected='';preview=null;result=null;session=null;uploaded=false;failure='';progress='';
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
    let html='<div class="settings-group"><h2>V2 归档 · 试验</h2>'+line('范围说明','当前仅支持同应用云端 ZIP 的逐窗口恢复；完整包及其他来源暂不能全部恢复。')+
      action('export','导出 V2 ZIP',busy)+action('choose','读取 V2 ZIP',busy||!!incoming);
    if(incoming){
      const m=incoming.manifest;
      html+=line('归档来源',m.workspace+' · '+m.records.length+' 项记录')+
        m.modules.map(v=>line(labels[v.module]||v.module,v.count+' 项 · '+(v.coverage==='unavailable'?'未采集':'已列入清单'))).join('');
      const chats=m.workspace==='backend'&&m.application_id===APP?m.records.filter(r=>r.module==='chat'):[];
      html+=chats.map(r=>'<button class="feature-row" type="button" data-action="settings:transfer-v2-select" data-id="'+escapeHtml(r.id)+'" aria-pressed="'+(selected===r.id)+'" '+(busy||preview||result?'disabled':'')+'><span><strong>'+escapeHtml(r.id)+'</strong><small>聊天窗口</small></span></button>').join('');
      html+=line('上传范围','预览将把此归档的全部对象暂存在已登录云端；仅确认后才写入所选窗口。');
      if(!chats.length)html+=line('目标暂不支持','请保留原始归档。');
      if(preview||result){const p=result||preview;html+=line(result?'已恢复窗口':'预览通过','轮次 '+p.turns+' · 附件 '+p.attachments+' · 语音 '+p.voices+' · 思维壤 '+p.soils+' · 快照 '+p.snapshots);}
      if(!result)html+=action(preview?'commit':'preview',preview?'确认恢复所选窗口':'上传并预览',busy||!selected);
      html+=action('clear','关闭并清理暂存',busy);
    }
    if(progress)html+=line('进度',progress);
    if(failure)html+=line('操作未完成',failure);
    return html+'</div>';
  }
  async function handle(name,target){
    if(!current()||busy)return;
    if(name==='v2-export'){
      // Directly choose a writable file in supporting browsers; OPFS keeps the
      // mobile fallback out of JS heap. No giant in-memory Blob of all chunks.
      let handle=null;
      if(typeof window.showSaveFilePicker==='function'){
        try{handle=await window.showSaveFilePicker({suggestedName:'elementera-coast-v2-'+timestampLabel()+'.zip',types:[{description:'海岸 V2 ZIP',accept:{'application/zip':['.zip']}}]});}
        catch(e){if(e.name==='AbortError')return;if(e.name!=='SecurityError'&&e.name!=='NotSupportedError'){toast('无法打开保存位置。');return;}}
      }
      return operate(async token=>{
        let directory=null,tempName=null,objectUrl=null;
        try{
          if(!handle){if(!navigator.storage?.getDirectory)throw Error('当前浏览器不支持流式文件保存；请使用 Native 导出。');directory=await navigator.storage.getDirectory();tempName='coast-v2-'+crypto.randomUUID()+'.zip';handle=await directory.getFileHandle(tempName,{create:true});}
          const writer=await handle.createWritable();
          await collectArchiveV2({sink:writer,applicationId:APP,onProgress:p=>{if(token!==revision)throw Error('已离开归档页面');progress='已采集 '+p.records+' 项 · '+p.bytes+' 字节';}});
          if(directory){
            const file=await handle.getFile();objectUrl=URL.createObjectURL(file);const link=document.createElement('a');link.href=objectUrl;link.download='elementera-coast-v2-'+timestampLabel()+'.zip';link.click();
            const dir=directory,n=tempName,url=objectUrl;
            setTimeout(()=>{URL.revokeObjectURL(url);void dir.removeEntry(n).catch(()=>{});},60000);
            directory=null;objectUrl=null;
          }
          toast('V2 ZIP 已生成；覆盖范围见清单。');
        }finally{if(objectUrl)URL.revokeObjectURL(objectUrl);if(directory&&tempName)await directory.removeEntry(tempName).catch(()=>{});}
      });
    }
    if(name==='v2-choose'){
      const input=document.createElement('input');input.type='file';input.accept='.zip,application/zip';
      input.addEventListener('change',()=>{const file=input.files?.[0];if(!file)return;void operate(async token=>{
        const data=await openArchiveV2(file,m=>api.validateManifest(m));
        if(token!==revision)return;
        // Full byte verification precedes preview and any upload.
        for(const d of data.manifest.objects){for await(const b of data.objectChunks(d)){if(token!==revision)throw Error('已离开归档页面');}progress='正在校验原件';}
        incoming=data;selected=data.manifest.workspace==='backend'&&data.manifest.application_id===APP?data.manifest.records.find(r=>r.module==='chat')?.id||'':'';
        preview=null;result=null;uploaded=false;progress='原件校验完成';
      });},{once:true});input.click();return;
    }
    if(name==='v2-select'&&incoming&&!preview&&!result){const id=target.dataset.id;if(incoming.manifest.records.some(r=>r.module==='chat'&&r.id===id))selected=id;return refresh();}
    if(name==='v2-clear')return operate(async()=>{await reset();});
    if(name==='v2-preview'&&incoming&&selected&&!result)return operate(async token=>{
      if(!session)session=(await api.createSession()).session.id;
      if(!uploaded){
        let n=0;
        for(const d of incoming.manifest.objects){
          if(token!==revision)throw Error('已离开归档页面；可返回继续或清理暂存');
          await api.registerObject(session,d);const received=new Set((await api.status(session,d.object_sha256)).received);
          let i=0;for await(const b of incoming.objectChunks(d)){if(token!==revision)throw Error('已离开归档页面；可返回继续');if(!received.has(i)){await api.putChunk(session,d.object_sha256,i,b);progress='已上传 '+(++n)+' 个新分块';}i++;}
        }
        const p=await api.preflight(session,incoming.manifest);if(!p.ready_for_byte_verification)throw Error('云端暂存未到齐');uploaded=true;
      }
      if(token!==revision)return;
      preview=await api.restoreChat(session,incoming.manifest,selected,false);
    });
    if(name==='v2-commit'&&preview&&!result&&session)return operate(async token=>{
      result=await api.restoreChat(session,incoming.manifest,selected,true);
      await chat.refreshFromCoast();toast('已确认恢复所选窗口。');
    });
  }
  return {render,handle};
}
