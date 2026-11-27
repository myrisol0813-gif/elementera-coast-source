import {ensureChatSchema} from './chat-store.js';
import {normalizeDreamConfig} from './dream-tide-ledger.js';
const check=(ok,msg)=>{if(!ok)throw Object.assign(Error(msg),{status:409});};
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(v);
const stamp=v=>Number.isSafeInteger(v)&&v>=0;
const text=(v,n)=>typeof v==='string'&&v.length<=n;
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
const stmt=(db,sql,...a)=>db.prepare(sql).bind(...a);
const specs={
  runs:['dream_tide_runs','claim_id,conversation_id,slot_key,local_day,kind,model_id,status,started_at,updated_at,result_json'],
  steps:['dream_tide_steps','claim_id,step_index,status,receipt_json,started_at,finished_at'],
  tools:['dream_tide_tool_events','claim_id,step_index,call_index,tool_name,status,receipt_json,started_at,finished_at'],
  notes:['dream_tide_notes','claim_id,conversation_id,model_id,body,created_at'],
  replies:['dream_tide_replies','id,claim_id,conversation_id,body,created_at']
};
const lists=Object.keys(specs);
const terminal=['completed','failed','cancelled','interrupted'];
const receiptStates=['claimed','completed','failed'];
const model=v=>text(v,180)&&v.trim();
function jsonText(v){
  if(v===null)return true;
  if(!text(v,64000))return false;
  try{const x=JSON.parse(v);return x&&typeof x==='object'&&!Array.isArray(x);}catch{return false;}
}
export async function readDreamArchive(db,cid){
  await ensureChatSchema(db);
  // One read statement gives a consistent snapshot even in adapters whose
  // batch implementation only returns mutation metadata.
  const selects=["(SELECT json_object('model_id',model_id,'config_json',config_json) FROM dream_tide_arms WHERE conversation_id=(SELECT cid FROM target)) AS arm"];
  for(const key of lists){
    const [table,cols]=specs[key],fields=cols.split(',');
    const where=['steps','tools'].includes(key)?'claim_id IN (SELECT claim_id FROM dream_tide_runs WHERE conversation_id=(SELECT cid FROM target))':'conversation_id=(SELECT cid FROM target)';
    const order=key==='runs'?'started_at,claim_id':key==='steps'?'claim_id,step_index':key==='tools'?'claim_id,step_index,call_index':key==='notes'?'created_at,claim_id':'created_at,id';
    const object="json_object("+fields.map(f=>"'"+f+"',"+f).join(',')+")";
    selects.push(`(SELECT json_group_array(${object}) FROM (SELECT ${cols} FROM ${table} WHERE ${where} ORDER BY ${order})) AS ${key}`);
  }
  const snapshot=await stmt(db,'WITH target(cid) AS (VALUES (?)) SELECT '+selects.join(','),cid).first();
  const arm=snapshot.arm?JSON.parse(snapshot.arm):null,rows=Object.fromEntries(lists.map(k=>[k,JSON.parse(snapshot[k]||'[]')]));
  check(!rows.runs.some(r=>r.status==='running'),'窗口正在自主唤醒，请结束活动后再归档。');
  if(!arm&&!lists.some(k=>rows[k].length))return null;
  // Revision, enabled, live claim authorization, and pending appointments are
  // intentionally never exported. Historical step identities are not permits.
  const value={version:1,settings:arm?{modelId:arm.model_id,config:JSON.parse(arm.config_json)}:null,...rows};
  validateDreamArchive(value,cid);
  return value;
}
export function validateDreamArchive(v,cid){
  check(id(cid)&&exact(v,['version','settings',...lists])&&v.version===1,'invalid autonomous wake archive');
  if(v.settings!==null){
    check(exact(v.settings,['modelId','config'])&&model(v.settings.modelId),'invalid wake draft');
    try{normalizeDreamConfig(v.settings.config);}catch{check(false,'invalid wake configuration');}
  }
  for(const k of lists)check(Array.isArray(v[k])&&v[k].length<=20000,'invalid wake archive records');
  check(new TextEncoder().encode(JSON.stringify(v)).length<=1400000,'自主唤醒记录超过单窗口归档预算；未截断。');
  const runs=new Map(),slots=new Set(),steps=new Set(),tools=new Set(),notes=new Set(),replies=new Set();
  for(const r of v.runs){
    check(exact(r,specs.runs[1].split(','))&&id(r.claim_id)&&r.conversation_id===cid&&!runs.has(r.claim_id)&&!slots.has(r.slot_key)&&
      text(r.slot_key,180)&&typeof r.local_day==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(r.local_day)&&
      (r.kind==='daily'?r.slot_key==='daily:'+r.local_day:r.kind==='extra'&&r.slot_key.startsWith('extra:')&&id(r.slot_key.slice(6)))&&
      model(r.model_id)&&terminal.includes(r.status)&&stamp(r.started_at)&&stamp(r.updated_at)&&r.updated_at>=r.started_at&&jsonText(r.result_json),'invalid historical wake run');
    runs.set(r.claim_id,r);slots.add(r.slot_key);
  }
  for(const r of v.steps){
    const key=r.claim_id+':'+r.step_index;
    check(exact(r,specs.steps[1].split(','))&&runs.has(r.claim_id)&&Number.isInteger(r.step_index)&&r.step_index>=0&&r.step_index<=128&&!steps.has(key)&&receiptStates.includes(r.status)&&jsonText(r.receipt_json)&&stamp(r.started_at)&&(r.finished_at===null||stamp(r.finished_at)),'invalid historical model receipt');
    steps.add(key);
  }
  for(const r of v.tools){
    const key=r.claim_id+':'+r.step_index+':'+r.call_index;
    check(exact(r,specs.tools[1].split(','))&&steps.has(r.claim_id+':'+r.step_index)&&Number.isInteger(r.call_index)&&r.call_index>=0&&r.call_index<=1024&&!tools.has(key)&&text(r.tool_name,120)&&receiptStates.includes(r.status)&&jsonText(r.receipt_json)&&stamp(r.started_at)&&(r.finished_at===null||stamp(r.finished_at)),'invalid historical tool receipt');
    tools.add(key);
  }
  for(const r of v.notes){
    check(exact(r,specs.notes[1].split(','))&&runs.has(r.claim_id)&&!notes.has(r.claim_id)&&r.conversation_id===cid&&r.model_id===runs.get(r.claim_id).model_id&&text(r.body,16000)&&r.body.trim()&&stamp(r.created_at),'invalid autonomous note');notes.add(r.claim_id);
  }
  for(const r of v.replies){
    check(exact(r,specs.replies[1].split(','))&&id(r.id)&&!replies.has(r.id)&&notes.has(r.claim_id)&&r.conversation_id===cid&&text(r.body,16000)&&r.body.trim()&&stamp(r.created_at),'invalid note reply');replies.add(r.id);
  }
  return v;
}
// Present originals must refer to a real historical tool reservation. A
// missing original does not invalidate a historical receipt (e.g. deletion
// or a selected-module export). An interrupted save may lack its receipt.
export function validateDreamMediaOrigin(archive,row,kind){
  const prefix=kind==='voice'?'voice_dream_':'att_dream_';
  const independent=String(row.id).startsWith(prefix)||kind==='voice'&&row.source==='dream_tide';
  if(!independent)return;
  check(row.turn_id===null&&(kind==='voice'?row.message_id===null&&row.source==='dream_tide':row.kind==='image'),'invalid autonomous media origin');
  const name=kind==='voice'?'voice_create':'image_generate';
  const event=archive?.tools?.find(e=>e.tool_name===name&&row.id===prefix+e.claim_id+'_'+e.step_index+'_'+e.call_index);
  check(event&&archive.runs.some(r=>r.claim_id===event.claim_id&&r.conversation_id===row.conversation_id),'autonomous media activity missing');
  const receipt=event.receipt_json==null?null:JSON.parse(event.receipt_json);
  check(!receipt?.record_id||receipt.record_id===row.id,'autonomous media receipt differs');
}
// Prepared statements participate in the existing atomic chat restore. No
// original permission survives; even an archive of an enabled window creates
// a disabled draft and terminal receipts only.
export async function prepareDreamArchive(db,cid,value){
  if(value==null)return [];
  const v=validateDreamArchive(value,cid);
  await ensureChatSchema(db);
  check(!await stmt(db,"SELECT 1 FROM dream_tide_arms WHERE conversation_id=? UNION ALL SELECT 1 FROM dream_tide_runs WHERE conversation_id=? LIMIT 1",cid,cid).first(),'autonomous wake target already exists');
  const revision=crypto.randomUUID(),statements=[];
  if(v.settings)statements.push(stmt(db,"INSERT INTO dream_tide_arms(conversation_id,revision,enabled,config_json,armed_at,model_id,extra_id,extra_at) VALUES (?,?,0,?,0,?,NULL,NULL)",cid,revision,JSON.stringify(normalizeDreamConfig(v.settings.config)),v.settings.modelId));
  for(const k of lists){
    if(!v[k].length)continue;
    const [table,cols]=specs[k],fields=cols.split(',');
    // Fixed field list, each value is bound JSON, not dynamic SQL. Use one
    // INSERT per table to preserve the parent chat's transaction budget.
    const select=fields.map(f=>"json_extract(value,'$."+f+"')").join(',');
    statements.push(k==='runs'?stmt(db,`INSERT INTO ${table}(${cols},arm_revision) SELECT ${select},? FROM json_each(?)`,revision,JSON.stringify(v[k])):
      stmt(db,`INSERT INTO ${table}(${cols}) SELECT ${select} FROM json_each(?)`,JSON.stringify(v[k])));
  }
  return statements;
}
