import {ensureMemorySchema} from './memory-store/memory-schema.js';
import {prepareAutonomousRecord} from './dream-tide-write-fence.js';
import {pocketFingerprint} from './memory-store/memory-pocket-store.js';

export async function proposeDreamMemory(db,input,context,now=Date.now()){
  if(!context.autonomous_activity||!context.autonomous_claim||!input||
    Object.keys(input).length!==3||typeof input.title!=='string'||typeof input.content!=='string'||
    !['memory','seed'].includes(input.destination))throw Error('invalid autonomous memory candidate');
  const title=input.title.trim(),body=input.content.trim();
  if(!title||title.length>120||!body||body.length>2000)throw Error('invalid candidate text');
  const claim=context.autonomous_claim,event=context.autonomous_event,cid=context.conversation_id;
  const id='pocket_dream_'+claim.claimId+'_'+event.step+'_'+event.index;
  const reference=JSON.stringify({conversation_id:cid,claim_id:claim.claimId,step_index:event.step,call_index:event.index,model_label:context.model_label,suggested_destination:input.destination,source:'dream_tide'});
  await ensureMemorySchema(db);
  const fingerprint=await pocketFingerprint(cid,body,input.destination);
  const insert=prepareAutonomousRecord(db,`INSERT OR IGNORE INTO memory_pockets
    (id,user_id,conversation_id,source_type,source_ref_json,source_text,suggested_title,suggested_life_core,candidate_id,title,life_core,content,fingerprint,source_model,source_window,source_time,created_at,updated_at)
    SELECT ?,'owner',?,'dream_tide',?,?,?,?,?,?,?,?,?,?,?,?,?,?`,
    [id,cid,reference,body,title,body,id,title,body,body,fingerprint,String(context.model_label||'').slice(0,120),cid,now,now,now],context,'allowMemoryCandidate','dream_memory_candidate');
  const result=await insert.run();
  if(result.meta.changes===1)return {ok:true,id,status:'pending'};
  const permitted=await prepareAutonomousRecord(db,'SELECT 1 AS permitted',[],context,'allowMemoryCandidate','dream_memory_candidate').first();
  if(!permitted)throw Error('自主记忆候选权限已撤回');
  // Never replace a pending candidate or revive a dismissed/confirmed one.
  const existing=await db.prepare("SELECT id FROM memory_pockets WHERE user_id='owner' AND conversation_id=? AND fingerprint=?").bind(cid,fingerprint).first();
  if(existing)return {ok:true,status:'duplicate_suppressed'};
  throw Error('candidate not saved');
}
