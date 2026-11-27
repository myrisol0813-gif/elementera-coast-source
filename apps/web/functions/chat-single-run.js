import {ensureChatSchema} from './chat-store.js';

// Durable admission for a single server-side chat request. No provider calls
// are made here. All competing ledgers are checked in one SQL statement.
const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);
const changed=r=>r?.meta?.changes===1;
const valid=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(v);
const STALE_MS=30*60*1000;
const liveWindow="SELECT 1 FROM conversations WHERE id=? AND user_id='owner' AND room_type IN ('main','radio') AND deleted_at IS NULL";
export async function acquireSingleChatRun(db,cid,now=Date.now()){
  if(!valid(cid)||!Number.isSafeInteger(now))throw new TypeError('invalid chat claim');
  await ensureChatSchema(db);
  const claimId=crypto.randomUUID();
  const r=await stmt(db,`INSERT OR IGNORE INTO chat_single_runs(conversation_id,claim_id,started_at,updated_at)
    SELECT ?,?,?,? WHERE EXISTS(${liveWindow})
    AND NOT EXISTS(SELECT 1 FROM chat_reply_runs WHERE conversation_id=? AND status='running')
    AND NOT EXISTS(SELECT 1 FROM dream_tide_runs WHERE conversation_id=? AND status='running')`,
    cid,claimId,now,now,cid,cid,cid).run();
  return changed(r)?{conversationId:cid,claimId}:null;
}
export async function heartbeatSingleChatRun(db,claim,now=Date.now()){
  await ensureChatSchema(db);
  return changed(await stmt(db,"UPDATE chat_single_runs SET updated_at=MAX(updated_at,?) WHERE conversation_id=? AND claim_id=?",now,claim.conversationId,claim.claimId).run());
}
export async function releaseSingleChatRun(db,claim){
  await ensureChatSchema(db);
  return changed(await stmt(db,"DELETE FROM chat_single_runs WHERE conversation_id=? AND claim_id=?",claim.conversationId,claim.claimId).run());
}
// A dead process may leave a lease. Recovery clears only a stale lease,
// never restarts the associated request or releases a newer claim.
export async function recoverSingleChatRuns(db,now=Date.now(),staleMs=STALE_MS){
  if(!Number.isSafeInteger(now)||!Number.isSafeInteger(staleMs)||staleMs<=0)throw new TypeError('invalid recovery boundary');
  await ensureChatSchema(db);
  const r=await stmt(db,"DELETE FROM chat_single_runs WHERE updated_at<?",now-staleMs).run();
  return r.meta.changes;
}
export async function isSingleChatRunActive(db,cid){
  await ensureChatSchema(db);
  return !!await stmt(db,"SELECT 1 FROM chat_single_runs WHERE conversation_id=?",cid).first();
}
