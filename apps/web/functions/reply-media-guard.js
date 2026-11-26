// Internal SQL capability only. Never read a sequence ID from an untrusted
// manual media request. A settled/uncertain group cannot perform more writes.
export function replyMediaGuard({conversationId,turnId,userId,messageId,sequenceId=null}){
  if(sequenceId!==null)return {
    sql:"EXISTS(SELECT 1 FROM chat_reply_runs WHERE conversation_id=? AND turn_id=? AND user_variant_id=? AND sequence_id=? AND status='running' AND pending_id=? AND pending_state='claimed')",
    args:[conversationId,turnId,userId,sequenceId,messageId]
  };
  return {
    sql:"NOT EXISTS(SELECT 1 FROM chat_reply_runs WHERE conversation_id=? AND status='running')",
    args:[conversationId]
  };
}
export async function canUseReplyMedia(db,identity){
  const guard=replyMediaGuard(identity);
  const row=await db.prepare('SELECT 1 AS allowed WHERE '+guard.sql).bind(...guard.args).first();
  return row?.allowed===1;
}
