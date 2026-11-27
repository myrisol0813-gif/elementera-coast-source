import {ensureChatSchema} from './chat-store.js';
import {dreamTideCandidate} from './dream-tide-schedule.js';
import {executeDreamTide} from './dream-tide-executor.js';
import {recoverDreamTide} from './dream-tide-ledger.js';
import {recoverSingleChatRuns} from './chat-single-run.js';
import {recoverStaleReplyRuns} from './chat-reply-run.js';

// Trusted scheduled handler only. Never called from a browser route or page
// load. The exact armed model is used, never the global model as a fallback.
export async function runDreamTideTick(env,{now=Date.now(),signal,execute=executeDreamTide}={}){
  if(env.COAST_DREAM_TIDE_ENABLED!=='true'||env.COAST_DREAM_TIDE_SCHEDULER!=='true')return {status:'disabled',attempts:0};
  const cap=Number(env.COAST_DREAM_TIDE_MAX_RUNS_PER_TICK);
  if(!Number.isSafeInteger(cap)||cap<1||cap>100||!env.COAST_CHAT_DB)return {status:'invalid_deployment_config',attempts:0};
  const db=env.COAST_CHAT_DB;
  await ensureChatSchema(db);
  await recoverDreamTide(db,now);
  await recoverSingleChatRuns(db,now);
  const rows=(await db.prepare(`SELECT a.*, COALESCE((SELECT MAX(r.started_at) FROM dream_tide_runs r WHERE r.conversation_id=a.conversation_id),0) AS last_run
    FROM dream_tide_arms a JOIN conversations c ON c.id=a.conversation_id
    WHERE a.enabled=1 AND c.user_id='owner' AND c.room_type='main' AND c.source='coast' AND c.conversation_kind='chat' AND c.deleted_at IS NULL
    AND NOT EXISTS(SELECT 1 FROM dream_tide_runs r WHERE r.conversation_id=a.conversation_id AND r.status='running')
    ORDER BY last_run,a.conversation_id`).all()).results||[];
  let attempts=0,completed=0,errors=0;
  for(const a of rows){
    if(signal?.aborted||attempts>=cap)break;
    try{
      const cfg=JSON.parse(a.config_json);
      if(!cfg.execution||!/^[-\w.]+\/[\w.:-]+$/.test(a.model_id))continue;
      const state={armed:true,armedAt:a.armed_at,busy:false,extra:a.extra_id?{id:a.extra_id,at:a.extra_at}:null};
      let candidate=dreamTideCandidate(cfg,state,now);
      if(candidate?.kind==='daily'&&await db.prepare("SELECT 1 FROM dream_tide_runs WHERE conversation_id=? AND slot_key=?").bind(a.conversation_id,candidate.key).first()){
        state.lastDailyDay=candidate.day;candidate=dreamTideCandidate(cfg,state,now);
      }
      if(!candidate)continue;
      // Busy windows do not consume the dispatch quota or starve other windows.
      await recoverStaleReplyRuns(db,now,a.conversation_id);
      const busy=await db.prepare("SELECT 1 FROM chat_single_runs WHERE conversation_id=? UNION ALL SELECT 1 FROM chat_reply_runs WHERE conversation_id=? AND status='running' LIMIT 1").bind(a.conversation_id,a.conversation_id).first();
      if(busy)continue;
      if(candidate.kind==='extra'){
        const row=await db.prepare("SELECT COUNT(*) AS n FROM dream_tide_runs WHERE conversation_id=? AND local_day=? AND kind='extra'").bind(a.conversation_id,candidate.day).first();
        if(row.n>=cfg.execution.extraPerDay)continue;
      }
      // Recheck exact revision at execution, so a tick cannot arm or substitute
      // a configuration which changed while the candidates were being scanned.
      const latest=await db.prepare("SELECT revision,model_id FROM dream_tide_arms WHERE conversation_id=? AND enabled=1").bind(a.conversation_id).first();
      if(latest?.revision!==a.revision||latest.model_id!==a.model_id)continue;
      attempts++;
      const result=await execute(env,a.conversation_id,{now,currentModelId:a.model_id,expectedRevision:a.revision,busy:false,signal});
      if(result.status==='completed')completed++;
    }catch{errors++;}
  }
  return {status:'checked',attempts,completed,errors};
}
