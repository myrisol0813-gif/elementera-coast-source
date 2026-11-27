import {ensureChatSchema} from './chat-store.js';
import {DREAM_CONTEXT_FLAGS,DREAM_TOOL_FLAGS} from './dream-tide-policy.js';
import {dreamTideCandidate,localClock} from './dream-tide-schedule.js';

// Internal D1 ledger. Only authenticated owner configuration may change authorization.
// Only an authenticated owner action may call armDreamTide/disarmDreamTide.
// Never archive authorization or active claims. Import must not call arm.
const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);
const changed=r=>r?.meta?.changes===1;
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(v);
const time=v=>Number.isSafeInteger(v)&&v>=0;
const clock=v=>typeof v==='string'&&/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(v);
const terminal=new Set(['completed','failed','cancelled','interrupted']);
const schema=ensureChatSchema;
export function normalizeDreamConfig(config){
  if(!config||!clock(config.dailyTime)||typeof config.timeZone!=='string'||!config.timeZone)throw new TypeError('invalid dream tide configuration');
  new Intl.DateTimeFormat('en',{timeZone:config.timeZone}).format(0);
  let quietHours=null;
  if(config.quietHours){
    if(!clock(config.quietHours.start)||!clock(config.quietHours.end))throw new TypeError('invalid quiet hours');
    quietHours={start:config.quietHours.start,end:config.quietHours.end};
  }
  // Execution is separately opt-in. A scheduling-only configuration cannot
  // reach a provider. Explicit, visible budgets are required, never defaults.
  let execution=null;
  if(config.execution!=null){
    const e=config.execution, int=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
    if(!int(e.tokenBudget,1,2147483646)||!int(e.outputLimit,1,2147483646)||!int(e.toolBudget,0,2147483646)||!int(e.readTurns,1,2147483646)
      ||!int(e.voiceLimit??1,0,2147483646)||!int(e.imageLimit??1,0,2147483646)||!int(e.extraPerDay??0,0,2147483646)||typeof e.invitation!=='string'||e.invitation.length>16000||!e.invitation.trim())throw new TypeError('invalid dream tide execution settings');
    execution={tokenBudget:e.tokenBudget,outputLimit:e.outputLimit,toolBudget:e.toolBudget,readTurns:e.readTurns,
      extraPerDay:e.extraPerDay??0,voiceLimit:e.voiceLimit??1,imageLimit:e.imageLimit??1,invitation:e.invitation,includeTime:e.includeTime===true,includePrevious:e.includePrevious===true,
      includeReplies:e.includeReplies===true,readHistory:e.readHistory===true,writeNote:e.writeNote===true,
      ...Object.fromEntries([...DREAM_CONTEXT_FLAGS,...DREAM_TOOL_FLAGS].map(key=>[key,e[key]===true]))};
  }
  return {enabled:true,timeZone:config.timeZone,dailyTime:config.dailyTime,quietHours,allowExtra:config.allowExtra===true,execution};
}
const liveWindow="SELECT 1 FROM conversations WHERE id=? AND user_id='owner' AND room_type='main' AND source='coast' AND conversation_kind='chat' AND deleted_at IS NULL";
export async function armDreamTide(db,cid,config,modelId,now=Date.now()){
  if(!id(cid)||!time(now)||typeof modelId!=='string'||!modelId.trim()||modelId.length>180)throw new TypeError('invalid arm identity');
  const cfg=normalizeDreamConfig(config), revision=crypto.randomUUID();
  await schema(db);
  // Reconfiguration must wait until the existing claim settles.
  const result=await stmt(db,`INSERT INTO dream_tide_arms(conversation_id,revision,enabled,config_json,armed_at,model_id)
    SELECT ?,?,1,?,?,? WHERE EXISTS(${liveWindow}) AND NOT EXISTS(SELECT 1 FROM dream_tide_runs WHERE conversation_id=? AND status='running')
    ON CONFLICT(conversation_id) DO UPDATE SET revision=excluded.revision,enabled=1,config_json=excluded.config_json,
    armed_at=excluded.armed_at,model_id=excluded.model_id,extra_id=NULL,extra_at=NULL`,
    cid,revision,JSON.stringify(cfg),now,modelId,cid,cid).run();
  return changed(result)?revision:null;
}
// Owner-facing configuration uses a compare-and-swap revision. Saving a
// draft is deliberately different from granting execution permission.
export async function readDreamSettings(db,cid){
  if(!id(cid))throw new TypeError('invalid window');
  await schema(db);
  if(!await stmt(db,liveWindow,cid).first())return null;
  const row=await stmt(db,"SELECT revision,enabled,config_json,model_id,armed_at,extra_at FROM dream_tide_arms WHERE conversation_id=?",cid).first();
  if(!row)return {revision:null,enabled:false,config:null,modelId:null,armedAt:null,extraAt:null};
  const running=!!await stmt(db,"SELECT 1 FROM dream_tide_runs WHERE conversation_id=? AND status='running'",cid).first();
  return {revision:row.revision,enabled:row.enabled===1,config:JSON.parse(row.config_json),modelId:row.model_id,
    armedAt:row.enabled===1?row.armed_at:null,extraAt:row.enabled===1?row.extra_at:null,running};
}
export async function configureDreamTide(db,cid,config,modelId,{expectedRevision=null,enable=false,now=Date.now()}={}){
  if(!id(cid)||!time(now)||typeof modelId!=='string'||!modelId.trim()||modelId.length>180||
    (expectedRevision!==null&&!id(expectedRevision)))throw new TypeError('invalid dream configuration identity');
  const cfg=normalizeDreamConfig(config),revision=crypto.randomUUID();
  if(enable&&!cfg.execution)throw new TypeError('explicit execution consent required');
  await schema(db);
  const noRun="NOT EXISTS(SELECT 1 FROM dream_tide_runs WHERE conversation_id=? AND status='running')";
  const result=expectedRevision===null
    ?await stmt(db,`INSERT OR IGNORE INTO dream_tide_arms(conversation_id,revision,enabled,config_json,armed_at,model_id)
      SELECT ?,?,?,?,?,? WHERE EXISTS(${liveWindow}) AND ${noRun}`,
      cid,revision,enable?1:0,JSON.stringify(cfg),now,modelId,cid,cid).run()
    :await stmt(db,`UPDATE dream_tide_arms SET revision=?,enabled=?,config_json=?,armed_at=?,model_id=?,extra_id=NULL,extra_at=NULL
      WHERE conversation_id=? AND revision=? AND EXISTS(${liveWindow}) AND ${noRun}`,
      revision,enable?1:0,JSON.stringify(cfg),now,modelId,cid,expectedRevision,cid,cid).run();
  return changed(result)?await readDreamSettings(db,cid):null;
}
export async function disarmDreamTide(db,cid,revision){
  if(!id(cid)||!id(revision))throw new TypeError('invalid arm identity');
  await schema(db);
  // Do not release a running claim here: an uncertain provider request may
  // still be in flight. The executor must observe revocation and settle.
  return changed(await stmt(db,"UPDATE dream_tide_arms SET revision=?,enabled=0,extra_id=NULL,extra_at=NULL WHERE conversation_id=? AND revision=? AND enabled=1",crypto.randomUUID(),cid,revision).run());
}
async function expireExtra(db,arm,now){
  if(!arm?.extra_id||!time(arm.extra_at)||arm.extra_at>=now)return false;
  const zone=JSON.parse(arm.config_json).timeZone;
  if(localClock(arm.extra_at,zone).day>=localClock(now,zone).day)return false;
  return changed(await stmt(db,`UPDATE dream_tide_arms SET extra_id=NULL,extra_at=NULL WHERE conversation_id=? AND revision=? AND extra_id=? AND extra_at=?
    AND NOT EXISTS(SELECT 1 FROM dream_tide_runs WHERE conversation_id=? AND status='running')`,
    arm.conversation_id,arm.revision,arm.extra_id,arm.extra_at,arm.conversation_id).run());
}
export async function setDreamTideExtra(db,cid,revision,extraId,at,now=Date.now()){
  if(!id(cid)||!id(revision)||!id(extraId)||!time(at)||!time(now)||at<=now)return false;
  await schema(db);
  const row=await stmt(db,"SELECT * FROM dream_tide_arms WHERE conversation_id=? AND revision=? AND enabled=1",cid,revision).first();
  if(!row||!JSON.parse(row.config_json).allowExtra)return false;
  await expireExtra(db,row,now);
  // First version has one pending extra appointment. It is never silently replaced.
  return changed(await stmt(db,`UPDATE dream_tide_arms SET extra_id=?,extra_at=? WHERE conversation_id=? AND revision=? AND enabled=1
    AND extra_id IS NULL AND NOT EXISTS(SELECT 1 FROM dream_tide_runs WHERE conversation_id=? AND slot_key=?)`,
    extraId,at,cid,revision,cid,'extra:'+extraId).run());
}
export async function claimDreamTide(db,cid,{now=Date.now(),currentModelId,busy=true,expectedRevision=null}={}){
  if(!id(cid)||!time(now)||busy!==false)return null;
  await schema(db);
  let arm=await stmt(db,"SELECT * FROM dream_tide_arms WHERE conversation_id=? AND enabled=1",cid).first();
  if(await expireExtra(db,arm,now))arm=await stmt(db,"SELECT * FROM dream_tide_arms WHERE conversation_id=? AND enabled=1",cid).first();
  if(!arm||currentModelId!==arm.model_id||(expectedRevision!==null&&arm.revision!==expectedRevision))return null;
  const config=JSON.parse(arm.config_json);
  const state={armed:true,armedAt:arm.armed_at,busy:false,
    extra:arm.extra_id?{id:arm.extra_id,at:arm.extra_at}:null};
  let candidate=dreamTideCandidate(config,state,now);
  if(candidate?.kind==='daily'&&await stmt(db,"SELECT 1 FROM dream_tide_runs WHERE conversation_id=? AND slot_key=?",cid,candidate.key).first()){
    state.lastDailyDay=candidate.day;
    candidate=dreamTideCandidate(config,state,now);
  }
  if(!candidate)return null;
  const extraLimit=config.execution?.extraPerDay??null;
  if(candidate.kind==='extra'&&extraLimit!==null){
    const count=await stmt(db,"SELECT COUNT(*) AS n FROM dream_tide_runs WHERE conversation_id=? AND local_day=? AND kind='extra'",cid,candidate.day).first();
    if(count.n>=extraLimit)return null;
  }
  const claimId=crypto.randomUUID();
  // Unique slot and partial unique active index enforce atomic claim.
  // Other admission statements check this ledger in the same D1 write.
  const r=await stmt(db,`INSERT OR IGNORE INTO dream_tide_runs(conversation_id,slot_key,local_day,kind,arm_revision,claim_id,model_id,status,started_at,updated_at)
    SELECT ?,?,?,?,?,?,?,'running',?,? WHERE EXISTS(${liveWindow})
    AND EXISTS(SELECT 1 FROM dream_tide_arms WHERE conversation_id=? AND revision=? AND enabled=1 AND model_id=? AND extra_id IS ? AND extra_at IS ?)
    AND NOT EXISTS(SELECT 1 FROM chat_reply_runs WHERE conversation_id=? AND status='running')
    AND NOT EXISTS(SELECT 1 FROM chat_single_runs WHERE conversation_id=?)`,
    cid,candidate.key,candidate.day,candidate.kind,arm.revision,claimId,arm.model_id,now,now,cid,cid,arm.revision,arm.model_id,arm.extra_id,arm.extra_at,cid,cid).run();
  if(!changed(r))return null;
  return {conversationId:cid,claimId,revision:arm.revision,modelId:arm.model_id,...candidate};
}
export async function dreamTideClaimAuthorized(db,claim){
  await schema(db);
  return !!await stmt(db,`SELECT 1 FROM dream_tide_runs r JOIN dream_tide_arms a ON a.conversation_id=r.conversation_id
    WHERE r.claim_id=? AND r.conversation_id=? AND r.arm_revision=? AND r.status='running' AND a.enabled=1 AND a.revision=r.arm_revision
    AND EXISTS(${liveWindow})`,claim.claimId,claim.conversationId,claim.revision,claim.conversationId).first();
}
export async function heartbeatDreamTide(db,claim,now=Date.now()){
  if(!time(now))return false;
  await schema(db);
  return changed(await stmt(db,`UPDATE dream_tide_runs SET updated_at=MAX(updated_at,?) WHERE claim_id=? AND conversation_id=? AND arm_revision=? AND status='running'
    AND EXISTS(SELECT 1 FROM dream_tide_arms WHERE conversation_id=? AND revision=? AND enabled=1)
    AND EXISTS(${liveWindow})`,now,claim.claimId,claim.conversationId,claim.revision,claim.conversationId,claim.revision,claim.conversationId).run());
}
export async function settleDreamTide(db,claim,status,now=Date.now()){
  if(!terminal.has(status)||!time(now))throw new TypeError('invalid settlement');
  await schema(db);
  const result=await db.batch([
    stmt(db,"UPDATE dream_tide_runs SET status=?,updated_at=MAX(updated_at,?) WHERE claim_id=? AND conversation_id=? AND arm_revision=? AND status='running'",status,now,claim.claimId,claim.conversationId,claim.revision),
    stmt(db,`UPDATE dream_tide_arms SET extra_id=NULL,extra_at=NULL WHERE conversation_id=? AND revision=? AND EXISTS(
      SELECT 1 FROM dream_tide_runs WHERE claim_id=? AND kind='extra' AND status=? AND slot_key='extra:'||dream_tide_arms.extra_id)`,claim.conversationId,claim.revision,claim.claimId,status)
  ]);
  return changed(result[0]);
}
// No retry after ambiguous work. A late response cannot reclaim the same slot.
// Extra appointments already claimed before interruption are likewise consumed.
export async function recoverDreamTide(db,now=Date.now(),staleMs=30*60*1000){
  if(!time(now)||!Number.isSafeInteger(staleMs)||staleMs<=0)throw new TypeError('invalid recovery boundary');
  await schema(db);
  const r=await db.batch([
    stmt(db,"UPDATE dream_tide_runs SET status='interrupted',updated_at=? WHERE status='running' AND updated_at<?",now,now-staleMs),
    db.prepare(`UPDATE dream_tide_arms SET extra_id=NULL,extra_at=NULL WHERE EXISTS(
      SELECT 1 FROM dream_tide_runs r WHERE r.conversation_id=dream_tide_arms.conversation_id AND r.arm_revision=dream_tide_arms.revision
      AND r.status='interrupted' AND r.slot_key='extra:'||dream_tide_arms.extra_id)`)
  ]);
  return r[0].meta.changes;
}
