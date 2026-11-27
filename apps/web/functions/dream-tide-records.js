import {ensureChatSchema,readConversationState} from './chat-store.js';

const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);
const live="EXISTS(SELECT 1 FROM conversations c WHERE c.id=r.conversation_id AND c.user_id='owner' AND c.deleted_at IS NULL AND c.room_type='main' AND c.source='coast' AND c.conversation_kind='chat')";
const active="r.claim_id=? AND r.conversation_id=? AND r.arm_revision=? AND r.status='running' AND a.enabled=1 AND a.revision=r.arm_revision AND "+live;
const args=c=>[c.claimId,c.conversationId,c.revision];
const validBody=s=>typeof s==='string'&&s.trim()&&s.length<=16000;
export async function dreamExecutionConfig(db,cid,revision=null){
  await ensureChatSchema(db);
  const row=await stmt(db,"SELECT revision,model_id,config_json FROM dream_tide_arms WHERE conversation_id=? AND enabled=1 AND (? IS NULL OR revision=?)",cid,revision,revision).first();
  if(!row)return null;
  const config=JSON.parse(row.config_json);
  return config.execution?{revision:row.revision,modelId:row.model_id,...config}:null;
}
export async function reserveDreamStep(db,claim,index,now=Date.now()){
  await ensureChatSchema(db);
  if(!Number.isSafeInteger(index)||index<0)return false;
  const r=await stmt(db,`INSERT OR IGNORE INTO dream_tide_steps(claim_id,step_index,status,started_at)
    SELECT ?,?,'claimed',? WHERE EXISTS(SELECT 1 FROM dream_tide_runs r JOIN dream_tide_arms a ON a.conversation_id=r.conversation_id WHERE ${active})
    AND (SELECT COUNT(*) FROM dream_tide_steps WHERE claim_id=?)=?
    AND NOT EXISTS(SELECT 1 FROM dream_tide_steps WHERE claim_id=? AND status!='completed')`,
    claim.claimId,index,now,...args(claim),claim.claimId,index,claim.claimId).run();
  return r.meta.changes===1;
}
export async function recordDreamStep(db,claim,index,status,receipt,now=Date.now()){
  if(!['completed','failed'].includes(status))throw new TypeError('invalid step status');
  await ensureChatSchema(db);
  const r=await stmt(db,`UPDATE dream_tide_steps SET status=?,receipt_json=?,finished_at=? WHERE claim_id=? AND step_index=? AND status='claimed'
    AND EXISTS(SELECT 1 FROM dream_tide_runs r WHERE r.claim_id=? AND r.conversation_id=? AND r.arm_revision=? AND r.status='running')`,
    status,JSON.stringify(receipt),now,claim.claimId,index,...args(claim)).run();
  return r.meta.changes===1;
}
export async function writeDreamNote(db,claim,body,now=Date.now()){
  if(!validBody(body))return false;
  await ensureChatSchema(db);
  const r=await stmt(db,`INSERT OR IGNORE INTO dream_tide_notes(claim_id,conversation_id,model_id,body,created_at)
    SELECT r.claim_id,r.conversation_id,r.model_id,?,? FROM dream_tide_runs r JOIN dream_tide_arms a ON a.conversation_id=r.conversation_id
    WHERE ${active} AND json_extract(a.config_json,'$.execution.writeNote')=1`,body,now,...args(claim)).run();
  return r.meta.changes===1;
}
// An explicit human reply is data only, never a scheduling action. Scope is
// checked at insertion, and a stable client ID makes network retries harmless.
export async function replyDreamNote(db,cid,claimId,replyId,body,now=Date.now()){
  if(!validBody(body)||typeof replyId!=='string'||!replyId||replyId.length>160)throw new TypeError('invalid note reply');
  await ensureChatSchema(db);
  const r=await stmt(db,`INSERT OR IGNORE INTO dream_tide_replies(id,claim_id,conversation_id,body,created_at)
    SELECT ?,n.claim_id,n.conversation_id,?,? FROM dream_tide_notes n JOIN conversations c ON c.id=n.conversation_id
    WHERE n.claim_id=? AND n.conversation_id=? AND c.user_id='owner' AND c.deleted_at IS NULL`,replyId,body,now,claimId,cid).run();
  return r.meta.changes===1;
}
export async function readDreamNotes(db,cid,limit=20){
  await ensureChatSchema(db);
  const n=Math.min(100,Math.max(1,Math.trunc(Number(limit)||20)));
  const rows=(await stmt(db,`SELECT n.* FROM dream_tide_notes n JOIN conversations c ON c.id=n.conversation_id WHERE n.conversation_id=? AND c.user_id='owner' AND c.deleted_at IS NULL ORDER BY n.created_at DESC,n.claim_id LIMIT ?`,cid,n).all()).results||[];
  for(const row of rows)row.replies=(await stmt(db,"SELECT id,body,created_at FROM dream_tide_replies WHERE conversation_id=? AND claim_id=? ORDER BY created_at,id",cid,row.claim_id).all()).results||[];
  return rows;
}
export async function readDreamActivity(db,cid,limit=20){
  await ensureChatSchema(db);
  const n=Math.min(100,Math.max(1,Math.trunc(Number(limit)||20)));
  const rows=(await stmt(db,`SELECT r.claim_id,r.kind,r.local_day,r.model_id,r.status,r.started_at,r.updated_at,r.result_json FROM dream_tide_runs r JOIN conversations c ON c.id=r.conversation_id
    WHERE r.conversation_id=? AND c.user_id='owner' AND c.deleted_at IS NULL ORDER BY r.started_at DESC,r.claim_id LIMIT ?`,cid,n).all()).results||[];
  for(const row of rows){
    row.result=row.result_json?JSON.parse(row.result_json):null;delete row.result_json;
    row.steps=(await stmt(db,"SELECT step_index,status,receipt_json,started_at,finished_at FROM dream_tide_steps WHERE claim_id=? ORDER BY step_index",row.claim_id).all()).results.map(s=>({...s,receipt:s.receipt_json?JSON.parse(s.receipt_json):null,receipt_json:undefined}));
  }
  return rows;
}
export async function previousDream(db,claim){
  await ensureChatSchema(db);
  return await stmt(db,`SELECT p.claim_id,p.started_at,p.status,p.result_json FROM dream_tide_runs p JOIN dream_tide_runs r ON r.claim_id=?
    WHERE p.conversation_id=r.conversation_id AND p.claim_id!=r.claim_id AND p.started_at<=r.started_at ORDER BY p.started_at DESC,p.claim_id LIMIT 1`,claim.claimId).first();
}
export async function readDreamHistory(db,cid,{mode='window',start=0,count=1,since=null,maxTurns=1,until=Date.now()}={}){
  if(!['window','since_previous'].includes(mode)||!Number.isSafeInteger(start)||start<0||!Number.isSafeInteger(count)||count<1||count>maxTurns)throw new TypeError('invalid history range');
  const history=await readConversationState(db,cid);
  const turns=history.turns.flatMap((turn,index)=>{
    const key=String(turn.user.active),u=turn.user.variants[turn.user.active];
    if(!u||u.hidden)return [];
    const list=turn.assistant.variantsByUserVariant[key]||[],a=list[turn.assistant.activeByUserVariant[key]];
    const selected=a?.reply_sequence?list.filter(v=>v.reply_sequence?.id===a.reply_sequence.id).sort((x,y)=>x.reply_sequence.index-y.reply_sequence.index):a?[a]:[];
    const messages=[{role:'user',id:u.id,content:u.content,created_at:u.created_at},...selected.map(v=>({role:'assistant',id:v.id,content:v.content,created_at:v.created_at}))];
    const bounded=messages.filter(m=>{const time=Date.parse(m.created_at);return mode==='window'||(Number.isFinite(time)&&time>since&&time<=until);});
    return bounded.length?[{index,turn_id:turn.id,messages:bounded}]:[];
  });
  if(mode==='since_previous'&&!Number.isSafeInteger(since))return {total:0,turns:[],reason:'no_previous_wake'};
  const rows=turns.slice(start,start+count);
  // Return whole turns or reject. Do not silently replace originals with excerpts.
  if(JSON.stringify(rows).length>60000)return {total:turns.length,turns:[],reason:'range_too_large'};
  return {total:turns.length,turns:rows,next:start+rows.length<turns.length?start+rows.length:null};
}
export async function finishDreamActivity(db,claim,status,result,now=Date.now()){
  if(!['completed','failed','cancelled','interrupted'].includes(status))throw new TypeError('invalid activity status');
  await ensureChatSchema(db);
  const encoded=JSON.stringify(result);
  // For success require still-valid authorization; failure/cancellation can
  // settle a revoked claim. No output may be added to an interrupted run.
  const guard=status==='completed'?`AND EXISTS(SELECT 1 FROM dream_tide_arms a JOIN dream_tide_runs r ON r.conversation_id=a.conversation_id WHERE ${active})`:'';
  const values=status==='completed'?args(claim):[];
  const r=await db.batch([
    stmt(db,`UPDATE dream_tide_runs SET status=?,result_json=?,updated_at=MAX(updated_at,?) WHERE claim_id=? AND conversation_id=? AND arm_revision=? AND status='running' ${guard}`,status,encoded,now,...args(claim),...values),
    stmt(db,`UPDATE dream_tide_arms SET extra_id=NULL,extra_at=NULL WHERE conversation_id=? AND revision=? AND EXISTS(
      SELECT 1 FROM dream_tide_runs WHERE claim_id=? AND kind='extra' AND status=? AND slot_key='extra:'||dream_tide_arms.extra_id)`,claim.conversationId,claim.revision,claim.claimId,status)
  ]);
  return r[0].meta.changes===1;
}
