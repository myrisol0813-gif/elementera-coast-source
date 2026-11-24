import { validatedChat } from './coast-transfer-store.js';
import { prepareArchiveVoice,prepareArchiveSoil } from './coast-archive-v2-restore-extra.js';
import { ensureChatSchema, normalizeState } from './chat-store.js';
import { prepareArchiveAttachment,prepareArchiveDogtalk } from './coast-archive-v2-media.js';
import { stageVerifiedObject } from './coast-archive-v2-chunks.js';
import { validateArchiveManifest } from './coast-archive-v2-manifest.js';
import { readStagedArchiveChunks } from './coast-archive-v2-stage.js';
const APP='com.elementeracoast.source';
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(v);
const stamp=v=>Number.isSafeInteger(v)&&v>=0;
const check=(ok,msg,status=409)=>{if(!ok)throw Object.assign(Error(msg),{status});};
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const equal=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
// A bounded, dependency-closed, same-edition chat group. Never overwrite a window.
// All record bytes are checked before preparing statements; commit re-runs the plan.
export async function prepareArchiveChatGroup(db,sessionId,manifest,conversationId){
  await validateArchiveManifest(manifest);
  check(['backend','local'].includes(manifest.workspace)&&manifest.application_id===APP,'chat group restore requires same-edition archive');
  check(id(conversationId),'invalid chat id',400);
  const records=new Map(manifest.records.map(r=>[r.module+'/'+r.id,r])),objects=new Map(manifest.objects.map(o=>[o.object_sha256,o]));
  const root=records.get('chat/'+conversationId);check(root,'chat record missing');
  const group=manifest.records.filter(r=>r===root||(['attachments','dogtalk_records','dogtalk_snapshots','voice','thinking_soil','thinking_soil_history'].includes(r.module)&&r.dependencies.includes('chat/'+conversationId)));
  const keys=new Set(group.map(r=>r.module+'/'+r.id));
  check(group.length<=80&&group.every(r=>r.dependencies.every(d=>keys.has(d))),'chat restore group is too large or missing a dependency');
  const unique=new Set(group.flatMap(r=>[r.record_object,...r.media_objects]));
  check([...unique].reduce((n,h)=>n+objects.get(h).size,0)<=16*1024*1024,'chat restore transaction exceeds 16 MiB safety budget');
  async function read(r){
    const d=objects.get(r.record_object);check(d.size<=1800000,'record exceeds database size limit');
    const bytes=new Uint8Array(d.size);let offset=0;
    await stageVerifiedObject(d,readStagedArchiveChunks(db,sessionId,d.object_sha256),async b=>{bytes.set(b,offset);offset+=b.length;},{maxBytes:1800000});
    const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    check(value&&typeof value.kind==='string'&&value.data&&typeof value.data==='object'&&!Array.isArray(value.data),'invalid record envelope');
    return value;
  }
  const entry=await read(root);
  check(root.media_objects.length===0&&root.dependencies.length===0,'invalid chat root');
  let canonical=entry.data;
  if(manifest.workspace==='local'){
    check(entry.kind==='local_chat','invalid local chat record kind');
    const {c,state,storageUpdatedAt}=validatedChat(entry.data,{verifiedMediaGroup:true});
    const ms=v=>typeof v==='number'?v:Date.parse(v);
    canonical={conversation:{id:c.id,title:c.title,room_type:c.room_type,created_at:ms(c.created_at),updated_at:ms(c.updated_at),deleted_at:null,title_manual:c.title_manual?1:0,title_generated_at:c.title_generated_at==null?null:ms(c.title_generated_at),title_model_id:c.title_model_id??null,source:c.source||'coast',source_window_id:c.source_window_id??null},history_json:JSON.stringify(state),history_updated_at:storageUpdatedAt};
  }else check(entry.kind==='chat','invalid backend chat record kind');
  const {conversation:c,history_json:raw,history_updated_at:updated}=canonical;
  check(c?.id===conversationId&&Object.keys(c).every(k=>['id','title','room_type','created_at','updated_at','deleted_at','title_manual','title_generated_at','title_model_id','source','source_window_id'].includes(k)),'invalid conversation metadata');
  check(typeof c.title==='string'&&c.title.trim()&&c.title.length<=1000&&['main','radio','lighthouse'].includes(c.room_type)&&stamp(c.created_at)&&stamp(c.updated_at)&&c.deleted_at==null&&[0,1].includes(c.title_manual)&&[c.title_generated_at].every(v=>v==null||stamp(v))&&[c.title_model_id,c.source_window_id].every(v=>v==null||typeof v==='string')&&typeof c.source==='string'&&c.source.length<=160,'invalid conversation fields');
  check(typeof raw==='string'&&new TextEncoder().encode(raw).length<=1800000&&stamp(updated),'invalid history storage');
  const history=JSON.parse(raw);check(history.version===4&&Array.isArray(history.turns)&&history.turns.length<=400,'invalid history structure');
  // Raw persisted history is retained byte-for-byte. Refuse records whose visible
  // representation would change under the target's normalizer.
  check(equal(history,normalizeState(history)),'target would normalize or lose original chat fields');
  const turns=new Set(),variants=new Set(),variantTurns=new Map(),assistantTurns=new Map(),attachmentRefs=new Map(),attachmentTurns=new Map(),snapshotRefs=new Map();
  for(const t of history.turns){
    check(id(t.id)&&!turns.has(t.id),'duplicate turn id');turns.add(t.id);
    for(const v of Object.values(t.assistant.variantsByUserVariant).flat())assistantTurns.set(v.id,t.id);
    for(const v of [...t.user.variants,...Object.values(t.assistant.variantsByUserVariant).flat()]){
      check(id(v.id)&&!variants.has(v.id),'duplicate variant id');variants.add(v.id);variantTurns.set(v.id,t.id);
      for(const a of v.attachments||[]){check(id(a.id),'invalid attachment ref');const old=attachmentRefs.get(a.id);check(!old||equal(old,a),'inconsistent attachment references');attachmentRefs.set(a.id,a);const linked=attachmentTurns.get(a.id)||new Set();linked.add(t.id);attachmentTurns.set(a.id,linked);}
      if(v.dogtalk_snapshot_id){check(id(v.dogtalk_snapshot_id),'invalid snapshot reference');const old=snapshotRefs.get(v.dogtalk_snapshot_id);check(!old||old===t.id,'snapshot references different turns');snapshotRefs.set(v.dogtalk_snapshot_id,t.id);}
    }
  }
  await ensureChatSchema(db);
  check(!await db.prepare('SELECT id FROM conversations WHERE id=?').bind(c.id).first(),'window already exists; never overwrite');
  const statements=[
    db.prepare("INSERT INTO conversations (id,user_id,title,created_at,updated_at,deleted_at,title_manual,title_generated_at,title_model_id,conversation_kind,room_type,source,source_window_id) VALUES (?,'owner',?,?,?,NULL,?,?,?,'chat',?,?,?)").bind(c.id,c.title,c.created_at,c.updated_at,c.title_manual,c.title_generated_at??null,c.title_model_id??null,c.room_type,c.source,c.source_window_id??null),
    db.prepare('INSERT INTO conversation_states (conversation_id,state_json,updated_at) VALUES (?,?,?)').bind(c.id,raw,updated)
  ];
  const conversationIds=new Set([c.id]),foundAttachments=new Set(),parents=[],snapshots=[];let voices=0,soils=0;
  for(const r of group.filter(r=>r!==root)){
    const {kind,data}=await read(r);
    check(data.conversation_id===c.id&&(['thinking_soil','thinking_soil_history'].includes(r.module)||data.id===r.id),'record identity or conversation mismatch');
    if(r.module==='attachments'){
      check(kind==='attachment'&&r.media_objects.length===1&&(data.turn_id==null||turns.has(data.turn_id)),'invalid attachment group');
      const ref=attachmentRefs.get(data.id);
      check(!ref||(ref.size===data.size&&ref.type===data.kind&&ref.name===data.name&&ref.mime===data.mime&&(data.turn_id==null||[...attachmentTurns.get(data.id)].every(t=>t===data.turn_id))),'attachment metadata differs from history');
      const d=objects.get(r.media_objects[0]);statements.push(...await prepareArchiveAttachment(db,data,d,readStagedArchiveChunks(db,sessionId,d.object_sha256),{conversationIds}));foundAttachments.add(data.id);
    }else if(r.module==='voice'){
      check(kind==='voice'&&r.media_objects.length===1,'invalid voice record');
      const d=objects.get(r.media_objects[0]);
      statements.push(...await prepareArchiveVoice(db,data,d,readStagedArchiveChunks(db,sessionId,d.object_sha256),{conversationId:c.id,turns,variantTurns}));voices++;
    }else if(['thinking_soil','thinking_soil_history'].includes(r.module)){
      check(kind===r.module&&r.media_objects.length===0,'invalid soil record');
      statements.push(...await prepareArchiveSoil(db,r.id,kind,data,{conversationId:c.id,turns,variantTurns:assistantTurns}));soils++;
    }else{
      check(kind===r.module&&r.media_objects.length===0,'invalid snapshot record kind');
      check(r.module==='dogtalk_records'?r.dependencies.length===1&&r.dependencies[0]==='chat/'+c.id:r.dependencies.length===2&&r.dependencies.includes('dogtalk_records/'+data.dogtalk_id),'dogtalk dependency mismatch');
      (r.module==='dogtalk_records'?parents:snapshots).push(data);
    }
  }
  check([...attachmentRefs.keys()].every(k=>foundAttachments.has(k))&&[...snapshotRefs].every(([k,t])=>snapshots.some(s=>s.id===k&&s.source_type==='turn'&&s.source_id===t)),'chat original or historical snapshot missing');
  if(parents.length||snapshots.length)statements.push(...await prepareArchiveDogtalk(db,{records:parents,snapshots},{conversationIds,sourceIds:new Set([...turns].map(t=>'turn:'+t))}));
  check(statements.length<=90,'chat restore exceeds atomic statement budget');
  return {statements,report:{conversation_id:c.id,turns:turns.size,variants:variants.size,attachments:foundAttachments.size,snapshots:snapshots.length,voices,soils,statement_count:statements.length,can_commit:true,scope:'chat_group_only'}};
}
export async function restoreArchiveChatGroup(db,sessionId,manifest,conversationId,confirm=false){
  const {statements,report}=await prepareArchiveChatGroup(db,sessionId,manifest,conversationId);
  if(confirm===true){await db.batch(statements);return {...report,committed:true};}
  return {...report,committed:false};
}
