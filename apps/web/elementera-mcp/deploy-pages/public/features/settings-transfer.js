import { requestJson } from '../core/api.js';
import { escapeHtml, downloadFile, timestampLabel } from '../core/dom.js';

const BASE='/api/transfer/v1';
const FILE_LIMIT=64*1024*1024;
const CLOUD_LIMIT=8*1024*1024;
const labels={chat:'聊天窗口',calendar:'日历与纪念日',daily:'日记与动态',model_profile:'模型资料'};
const supported=['chat','calendar'];
const bytes=s=>new TextEncoder().encode(s);
async function hash(s){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes(s)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
async function readBundle(file){
  if(file.size>FILE_LIMIT) throw Error('数据包超过 64 MiB。');
  const envelope=JSON.parse(await file.text());
  if(envelope?.format!=='elementera-coast-transfer'||envelope.version!==1||typeof envelope.payload_json!=='string'||await hash(envelope.payload_json)!==envelope.sha256) throw Error('数据包格式或完整性校验失败。');
  const payload=JSON.parse(envelope.payload_json);
  if(!['local','backend'].includes(payload.workspace)||!Array.isArray(payload.includedModules)||!payload.includedModules.every(k=>Object.hasOwn(labels,k))) throw Error('数据包模块声明无效。');
  for(const k of ['conversations','calendar','moments','diaries']) if(!Array.isArray(payload[k])) throw Error('数据包列表不完整。');
  return payload;
}
async function selectedBundle(payload,selected){
  const value={...payload,includedModules:[...selected],
    conversations:selected.has('chat')?payload.conversations:[],
    calendar:selected.has('calendar')?payload.calendar:[],
    moments:[],diaries:[],profile:null,dailyProfile:null};
  const payload_json=JSON.stringify(value);
  const bundle={format:'elementera-coast-transfer',version:1,sha256:await hash(payload_json),payload_json};
  if(bytes(JSON.stringify({bundle,modules:[...selected],confirm:true})).length>CLOUD_LIMIT) throw Error('所选数据超过云端单次 8 MiB 上限；未上传。');
  return bundle;
}
function action(name,label,disabled=false){
  return '<button class="primary-wide" type="button" data-action="settings:transfer-'+name+'" '+(disabled?'disabled':'')+'>'+escapeHtml(label)+'</button>';
}
function section(title,body){return '<div class="settings-group"><h2>'+escapeHtml(title)+'</h2>'+body+'</div>';}
function line(title,description){return '<div class="feature-row static"><span><strong>'+escapeHtml(title)+'</strong><small>'+escapeHtml(description)+'</small></span></div>';}

export function createTransferSettings({router,toast,chat}){
  let payload=null, selection=new Set(), preview=null, result=null, busy=false, failure='',revision=0;
  const current=()=>router.current()?.name==='settings-transfer';
  const refresh=()=>current()?router.refresh():Promise.resolve();
  function reset(){revision++;payload=null;selection=new Set();preview=null;result=null;busy=false;failure='';}
  router.subscribe(({current:next,previous})=>{if(previous?.name==='settings-transfer'&&next?.name!=='settings-transfer')reset();});
  router.register('settings-transfer',()=>{
    let content=section('可迁移数据包',line('当前目的地：在线海岸','导入写入已登录的云端。不会覆盖已有记录；原文件保留。')+
      action('export','导出云端聊天与日历',busy)+action('choose','选择数据包',busy));
    if(payload){
      content+=section('选择模块',line('来源',payload.workspace==='local'?'本机海岸':'在线海岸')+payload.includedModules.map(k=>{
        const allowed=supported.includes(k);
        return '<button class="feature-row" type="button" aria-pressed="'+selection.has(k)+'" data-action="settings:transfer-toggle" data-module="'+k+'" '+(!allowed||busy||result?'disabled':'')+'><span><strong>'+escapeHtml(labels[k])+'</strong><small>'+escapeHtml(allowed?(selection.has(k)?'已选择':'未选择'):'目标暂不支持')+'</small></span></button>';
      }).join('')+line('上传说明','只有选中的模块会发送到当前云端。预览不会写入用户记录。')+
      (!preview&&!result?action('preview','上传所选并预览',busy||selection.size===0):''));
    }
    const report=result||preview;
    if(report){
      content+=section(result?'已确认导入':'导入预览',supported.map(k=>{
        const row=report[k];if(!row||!selection.has(k))return '';
        return line(labels[k],(result?'已新增 ':'可新增 ')+row.ready+' · 已存在保留 '+row.existing+' · 内容冲突 '+(row.conflicts||0))+(row.blocked||[]).map(x=>line('不可迁移',x.reason)).join('');
      }).join('')+
      (result?line('导入完成','如果聊天列表尚未刷新，请重新打开海岸。'):(report.can_commit?action('import','确认写入云端',busy):line('本次不能导入','存在不兼容记录或超过 90 条原子写入上限。原资料未被修改。'))));
    }
    if(failure)content+=line('操作未完成',failure);
    content+=section('范围与限制',line('数据包最多 64 MiB','云端单次上传 8 MiB；附件原件、长期记忆、语音及其他模块暂不恢复。原 JSON / HTML 防丢导出仍保留。'));
    return {title:'海岸数据迁移',subtitle:'选择、预览、确认 · 云端存储',className:'settings-panel',body:content};
  });
  async function operate(work){
    if(busy)return;const token=revision;busy=true;failure='';await refresh();
    try{await work(token);}catch(e){if(token===revision)failure=e.message||'操作失败';}
    finally{if(token===revision){busy=false;await refresh();}}
  }
  async function handle(name,target){
    if(name==='transfer-open'){reset();return router.open('settings-transfer');}
    if(!current()||busy)return;
    if(name==='transfer-export')return operate(async token=>{
      const {bundle}=await requestJson(BASE);if(token!==revision)return;
      downloadFile(JSON.stringify(bundle),'elementera-coast-transfer-'+timestampLabel()+'.json','application/json');
      toast('数据包已导出；请妥善保存。');
    });
    if(name==='transfer-choose'){
      const input=document.createElement('input');input.type='file';input.accept='.json,application/json';
      const token=revision;
      input.addEventListener('change',()=>{const file=input.files?.[0];if(!file||token!==revision||!current())return;
        void operate(async v=>{const data=await readBundle(file);if(v!==revision)return;
          payload=data;selection=new Set(data.includedModules.filter(k=>supported.includes(k)));preview=null;result=null;
        });
      },{once:true});input.click();return;
    }
    if(name==='transfer-toggle'&&payload&&!result){
      const key=target.dataset.module;if(!supported.includes(key)||!payload.includedModules.includes(key))return;
      if(selection.has(key))selection.delete(key);else selection.add(key);preview=null;failure='';return refresh();
    }
    if(name==='transfer-preview'&&payload&&selection.size)return operate(async token=>{
      const bundle=await selectedBundle(payload,selection);if(token!==revision)return;
      const reply=await requestJson(BASE+'/preview',{method:'POST',body:JSON.stringify({bundle,modules:[...selection]})});
      if(token===revision)preview=reply.preview;
    });
    if(name==='transfer-import'&&preview?.can_commit&&!result)return operate(async token=>{
      const bundle=await selectedBundle(payload,selection);if(token!==revision)return;
      const reply=await requestJson(BASE+'/import',{method:'POST',body:JSON.stringify({bundle,modules:[...selection],confirm:true})});
      if(token!==revision)return;result=reply.result;preview=null;
      await chat.refreshFromCoast();toast('云端已确认导入。');
    });
  }
  return Object.freeze({handle});
}
