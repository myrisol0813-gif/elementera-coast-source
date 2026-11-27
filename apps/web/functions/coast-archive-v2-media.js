import { ensureChatAttachmentSchema, getChatAttachmentRecord, MAX_ATTACHMENT_BYTES } from './chat-attachments.js';
import { getConversation } from './chat-store.js';
import { ensureDogtalkSchema } from './dogtalk-store.js';
import { ARCHIVE_CHUNK_BYTES, digestBytes, describeObject, stageVerifiedObject } from './coast-archive-v2-chunks.js';

const idPattern=/^[A-Za-z0-9_.:-]{1,160}$/;
const validId=value=>typeof value==='string'&&idPattern.test(value);
const check=(ok,message)=>{if(!ok)throw Error(message);};
const toBytes=v=>v instanceof ArrayBuffer?new Uint8Array(v):ArrayBuffer.isView(v)?new Uint8Array(v.buffer,v.byteOffset,v.byteLength):Array.isArray(v)?Uint8Array.from(v):null;
function pageArgs(cursor,limit){check(cursor===''||validId(cursor),'invalid archive cursor');check(Number.isInteger(limit)&&limit>=1&&limit<=100,'invalid archive page size');}
function page(rows,limit){const items=rows.slice(0,limit);return {items,next_cursor:rows.length>limit?items.at(-1).id:null};}

// Inventory uses persisted originals, not the currently selected message branch.
export async function listArchiveAttachments(db,{cursor='',limit=50}={}){
  pageArgs(cursor,limit);await ensureChatAttachmentSchema(db);
  const {results=[]}=await db.prepare("SELECT a.id,a.conversation_id,a.turn_id,a.kind,a.name,a.mime,a.size,a.created_at,a.updated_at FROM chat_attachments a JOIN conversations c ON c.id=a.conversation_id WHERE c.user_id='owner' AND c.deleted_at IS NULL AND c.conversation_kind='chat' AND a.id>? ORDER BY a.id LIMIT ?").bind(cursor,limit+1).all();
  return page(results,limit);
}
export async function readArchiveAttachment(db,conversationId,id){
  check(validId(conversationId)&&validId(id),'invalid attachment identity');
  await getConversation(db,conversationId);
  const record=await getChatAttachmentRecord(db,conversationId,id);
  const bytes=toBytes(record.data);
  check(bytes&&Number.isSafeInteger(record.size)&&record.size===bytes.length&&record.size>0&&record.size<=MAX_ATTACHMENT_BYTES,'attachment original missing or corrupt');
  const chunks=[];for(let offset=0;offset<bytes.length;offset+=ARCHIVE_CHUNK_BYTES)chunks.push(bytes.subarray(offset,offset+ARCHIVE_CHUNK_BYTES));
  const descriptor=await describeObject(bytes.length,await Promise.all(chunks.map(digestBytes)),{maxBytes:MAX_ATTACHMENT_BYTES});
  const {data,...meta}=record;
  // Canonical reader omits updated_at; read it from the same persisted record.
  const row=await db.prepare('SELECT updated_at FROM chat_attachments WHERE id=? AND conversation_id=?').bind(id,conversationId).first();
  check(row,'attachment disappeared during collection');
  return {metadata:{...meta,updated_at:row.updated_at},descriptor,chunks};
}

// Explicit column names and owner filter: do not expose arbitrary tables or visitor data.
// Normalize edition-specific fields on the archive wire only.
const SNAPSHOT_OWNER='owner';
function neutral(row){
  const {owner,visibility,model_partner_hint,readable_by_model_partner,...fields}=row;
  return {...fields,owner:'owner',visibility:'private_to_owner_and_model_partner',model_partner_hint:model_partner_hint,readable_by_model_partner:readable_by_model_partner};
}
export async function listArchiveDogtalk(db,{kind='snapshots',cursor='',limit=50}={}){
  pageArgs(cursor,limit);await ensureDogtalkSchema(db);
  check(kind==='snapshots'||kind==='records','invalid archive record kind');
  const table=kind==='snapshots'?'coast_mystic_dogtalk_snapshots':'coast_mystic_dogtalk';
  const columns='id,owner,room_scope,scope_key,conversation_id,body,true_core,self_note,model_partner_hint,not_to_misunderstand,weather,read_mode,readable_by_model_partner,auto_recall,memory_weight,not_instruction,not_preference,not_memory_seed,not_pocket,visibility,created_at,'+
    (kind==='snapshots'?'dogtalk_id,source_type,source_id':'type,status,source,updated_at,archived_at,last_read_at');
  const {results=[]}=await db.prepare('SELECT '+columns+' FROM '+table+" WHERE owner=? AND id>? AND (conversation_id IS NULL OR conversation_id IN (SELECT id FROM conversations WHERE user_id='owner' AND deleted_at IS NULL AND conversation_kind='chat')) ORDER BY id LIMIT ?").bind(SNAPSHOT_OWNER,cursor,limit+1).all();
  const result=page(results,limit);return {...result,items:result.items.map(neutral)};
}

// Prepare an insert-only attachment restore. No live records are changed here.
// Caller must include new conversation rows before these statements in one D1 batch,
// and independently verify all message/turn references before publication.
export async function prepareArchiveAttachment(db,metadata,descriptor,source,{conversationIds}={}){
  const m=metadata;
  check(m&&validId(m.id)&&validId(m.conversation_id)&&(m.turn_id==null||validId(m.turn_id)),'invalid attachment reference');
  check(!m.id.startsWith('att_dream_')||m.turn_id==null&&m.kind==='image','invalid autonomous image origin');
  check(conversationIds instanceof Set&&conversationIds.has(m.conversation_id),'attachment conversation not in verified restore plan');
  check(['image','file'].includes(m.kind)&&typeof m.name==='string'&&m.name.length>0&&m.name.length<=180&&typeof m.mime==='string'&&/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(m.mime)&&m.mime.length<=120,'invalid attachment metadata');
  check(Number.isSafeInteger(m.created_at)&&m.created_at>=0&&Number.isSafeInteger(m.updated_at)&&m.updated_at>=0&&m.size===descriptor?.size&&m.size>0,'invalid attachment timestamps or size');
  await ensureChatAttachmentSchema(db);
  const existing=await db.prepare('SELECT id FROM chat_attachments WHERE id=?').bind(m.id).first();
  check(!existing,'attachment ID already exists; never overwrite');
  const statements=[db.prepare('INSERT INTO chat_attachments (id,conversation_id,turn_id,kind,name,mime,size,data,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(m.id,m.conversation_id,m.turn_id??null,m.kind,m.name,m.mime,m.size,new Uint8Array(),m.created_at,m.updated_at)];
  await stageVerifiedObject(descriptor,source,async(chunk,index)=>{
    statements.push(db.prepare('INSERT INTO chat_attachment_chunks (attachment_id,chunk_index,data) VALUES (?,?,?)').bind(m.id,index,chunk.slice()));
  },{maxBytes:MAX_ATTACHMENT_BYTES});
  return statements;
}

// Restore historical private drafts and snapshots as a dependency-closed group.
// No live writes: the caller publishes these statements with verified chat records.
export async function prepareArchiveDogtalk(db,{records,snapshots},{conversationIds,sourceIds}={}){
  check(Array.isArray(records)&&Array.isArray(snapshots)&&records.length+snapshots.length<=90,'invalid snapshot restore batch');
  check(conversationIds instanceof Set&&sourceIds instanceof Set,'snapshot restore requires verified references');
  await ensureDogtalkSchema(db);
  const parents=new Map(),ids=new Set(),sources=new Set(),statements=[];
  const strings=['body','true_core','self_note','model_partner_hint','not_to_misunderstand','weather'];
  const common=['id','owner','visibility','room_scope','scope_key','conversation_id',...strings,'read_mode','readable_by_model_partner','auto_recall','memory_weight','not_instruction','not_preference','not_memory_seed','not_pocket','created_at'];
  const stamp=v=>Number.isSafeInteger(v)&&v>=0;
  function validate(row,extra){
    check(row&&validId(row.id)&&row.owner==='owner'&&row.visibility==='private_to_owner_and_model_partner'&&Object.keys(row).every(k=>common.includes(k)||extra.includes(k)),'invalid snapshot metadata');
    check(['conversation','radio','lighthouse'].includes(row.room_scope)&&
      (row.room_scope==='conversation'?validId(row.conversation_id)&&conversationIds.has(row.conversation_id)&&row.scope_key==='conversation:'+row.conversation_id:row.conversation_id==null&&row.scope_key===row.room_scope+':main'),'snapshot scope is not in verified restore plan');
    check(strings.every(k=>typeof row[k]==='string')&&new TextEncoder().encode(JSON.stringify(row)).length<=1500000,'invalid or oversized snapshot text');
    check(['keep_private','when_confused','read_now'].includes(row.read_mode)&&row.readable_by_model_partner===1&&row.auto_recall===0&&row.memory_weight==='low'&&['not_instruction','not_preference','not_memory_seed','not_pocket'].every(k=>row[k]===1)&&stamp(row.created_at),'invalid snapshot privacy or time');
  }
  const sharedColumns=['id','owner','room_scope','scope_key','conversation_id','body','true_core','self_note','model_partner_hint','not_to_misunderstand','weather','read_mode','readable_by_model_partner','auto_recall','memory_weight','not_instruction','not_preference','not_memory_seed','not_pocket','visibility','created_at'];
  const sharedValues=r=>[r.id,SNAPSHOT_OWNER,r.room_scope,r.scope_key,r.conversation_id??null,r.body,r.true_core,r.self_note,r.model_partner_hint,r.not_to_misunderstand,r.weather,r.read_mode,r.readable_by_model_partner,r.auto_recall,r.memory_weight,r.not_instruction,r.not_preference,r.not_memory_seed,r.not_pocket,'private_to_owner_and_model_partner',r.created_at];
  const insert=(table,columns,values)=>db.prepare('INSERT INTO '+table+' ('+columns.join(',')+') VALUES ('+columns.map(()=>'?').join(',')+')').bind(...values);
  for(const r of records){
    validate(r,['type','status','source','updated_at','archived_at','last_read_at']);
    check(!parents.has(r.id)&&['xiaohan_mystic_dogtalk','owner_mystic_dogtalk'].includes(r.type)&&['draft','saved','archived'].includes(r.status)&&typeof r.source==='string'&&r.source.length<=160&&stamp(r.updated_at)&&[r.archived_at,r.last_read_at].every(v=>v==null||stamp(v)),'invalid parent record');
    check(!await db.prepare('SELECT id FROM coast_mystic_dogtalk WHERE id=?').bind(r.id).first(),'parent already exists; never overwrite');
    // A second active draft in the same scope would alter which draft is visible.
    if(r.status!=='archived'){
      check(![...parents.values()].some(p=>p.scope_key===r.scope_key&&p.status!=='archived'),'multiple active drafts in restore group');
      check(!await db.prepare("SELECT id FROM coast_mystic_dogtalk WHERE owner=? AND scope_key=? AND status IN ('draft','saved')").bind(SNAPSHOT_OWNER,r.scope_key).first(),'active target draft already exists; never overwrite');
    }
    parents.set(r.id,r);
    statements.push(insert('coast_mystic_dogtalk',[...sharedColumns,'type','status','source','updated_at','archived_at','last_read_at'],[...sharedValues(r),'owner_mystic_dogtalk',r.status,r.source,r.updated_at,r.archived_at??null,r.last_read_at??null]));
  }
  for(const s of snapshots){
    validate(s,['dogtalk_id','source_type','source_id']);
    const parent=parents.get(s.dogtalk_id),source=s.source_type+':'+s.source_id;
    check(!ids.has(s.id)&&parent&&parent.scope_key===s.scope_key&&['turn','radio_message','lighthouse_letter'].includes(s.source_type)&&validId(s.source_id)&&sourceIds.has(source)&&!sources.has(source),'snapshot dependency missing or duplicated');
    check(!await db.prepare('SELECT id FROM coast_mystic_dogtalk_snapshots WHERE id=? OR (source_type=? AND source_id=?)').bind(s.id,s.source_type,s.source_id).first(),'snapshot already exists; never overwrite');
    ids.add(s.id);sources.add(source);
    statements.push(insert('coast_mystic_dogtalk_snapshots',[...sharedColumns,'dogtalk_id','source_type','source_id'],[...sharedValues(s),s.dogtalk_id,s.source_type,s.source_id]));
  }
  return statements;
}
