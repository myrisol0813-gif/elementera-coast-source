// Only static trusted SQL prefixes/flags are used by the canonical stores.
export async function insertAutonomousRecord(db,sql,values,context,flag,name){
  const claim=context?.autonomous_claim,event=context?.autonomous_event;
  if(!claim||claim.conversationId!==context.conversation_id||!event||!Number.isSafeInteger(event.step)||!Number.isSafeInteger(event.index))
    throw Object.assign(Error('自主写入缺少有效活动身份。'),{type:'tool_forbidden',status:403});
  const r=await db.prepare(sql+` WHERE EXISTS(
    SELECT 1 FROM dream_tide_runs r JOIN dream_tide_arms a ON a.conversation_id=r.conversation_id
    JOIN conversations c ON c.id=r.conversation_id
    JOIN dream_tide_tool_events t ON t.claim_id=r.claim_id
    WHERE r.claim_id=? AND r.conversation_id=? AND r.arm_revision=? AND r.status='running'
      AND a.enabled=1 AND a.revision=r.arm_revision AND json_extract(a.config_json,?)=1
      AND c.user_id='owner' AND c.deleted_at IS NULL AND c.room_type='main' AND c.source='coast' AND c.conversation_kind='chat'
      AND t.step_index=? AND t.call_index=? AND t.tool_name=? AND t.status='claimed'
    )`).bind(...values,claim.claimId,claim.conversationId,claim.revision,'$.execution.'+flag,event.step,event.index,name).run();
  if(r.meta.changes!==1)throw Object.assign(Error('自主写入权限已撤回或活动已结束。'),{type:'tool_forbidden',status:403});
  return r;
}
