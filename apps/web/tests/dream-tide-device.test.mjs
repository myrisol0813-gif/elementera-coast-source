import test from 'node:test';
import assert from 'node:assert/strict';
import {D1Database} from './d1-helper.mjs';
import {createConversation} from '../functions/chat-store.js';
import {configureDreamTide,disarmDreamTide,settleDreamTide} from '../functions/dream-tide-ledger.js';
import {claimDeviceDream,deviceDreamPlanSlug,deviceKeyDigest,deviceDreamAction} from '../functions/dream-tide-device.js';
import {runDreamTideTick} from '../functions/dream-tide-scheduler.js';
import {routeChatApi} from '../functions/chat-router.js';
const modelId='chatgpt-plan:gpt-6.2-sol',due=Date.parse('2026-11-28T09:00:00Z');
const config={timeZone:'UTC',dailyTime:'09:00',allowExtra:false,execution:{tokenBudget:8000,outputLimit:1000,toolBudget:4,readTurns:10,invitation:'独立活动',writeNote:true}};
async function fixture(){
  const db=new D1Database(),cv=await createConversation(db,'device-dream','main');
  const settings=await configureDreamTide(db,cv.id,config,modelId,{enable:true,now:due-86400000});
  const env={COAST_CHAT_DB:db,COAST_DEVICE_DREAM_TIDE_ENABLED:'true',COAST_DREAM_TIDE_ENABLED:'true',COAST_DREAM_TIDE_SCHEDULER:'true',COAST_DREAM_TIDE_MAX_RUNS_PER_TICK:'1'};
  const opts={revision:settings.revision,modelId,now:due,clock:()=>due};
  return {db,cid:cv.id,env,opts};
}
test('device model IDs are distinct from cloud API routes',()=>{
  assert.equal(deviceDreamPlanSlug(modelId),'gpt-6.2-sol');
  for(const id of [null,'fixture/model','chatgpt-plan:','chatgpt-plan:foo/bar','chatgpt-plan: a'])assert.equal(deviceDreamPlanSlug(id),null);
});
test('device claim requires explicit deployment gate and exact armed revision/model; cloud skips plan',async()=>{
  const {db,cid,env,opts}=await fixture();
  assert.equal((await claimDeviceDream({...env,COAST_DEVICE_DREAM_TIDE_ENABLED:'false'},cid,opts)).status,'disabled');
  assert.equal((await claimDeviceDream(env,cid,{...opts,revision:'wrong'})).status,'not_authorized');
  assert.equal((await claimDeviceDream(env,cid,{...opts,modelId:'chatgpt-plan:other'})).status,'not_authorized');
  assert.equal((await runDreamTideTick(env,{now:due,execute:async()=>{throw Error('plan must never reach cloud executor')}})).attempts,0);
  const count=await db.prepare('SELECT COUNT(*) AS n FROM dream_tide_runs').first();
  assert.equal(count.n,0);
});
test('online device claim reuses online context and consumes the same slot once',async()=>{
  const {db,cid,env,opts}=await fixture();
  const result=await claimDeviceDream(env,cid,opts);
  assert.equal(result.status,'claimed');
  assert.equal(result.claim.conversationId,cid);
  assert.equal(result.claim.modelId,modelId);
  assert.match(result.context.messages[0].content,/独立活动/);
  assert.equal((await claimDeviceDream(env,cid,opts)).status,'not_due');
  assert.equal(await settleDreamTide(db,result.claim,'completed',due),true);
  assert.equal((await claimDeviceDream(env,cid,opts)).status,'not_due');
});
test('revoked revision cannot claim a device activity',async()=>{
  const {db,cid,env,opts}=await fixture();
  assert.equal(await disarmDreamTide(db,cid,opts.revision),true);
  assert.equal((await claimDeviceDream(env,cid,opts)).status,'not_authorized');
});

const key='a'.repeat(64),usage={total_tokens:321,prompt_tokens:200,completion_tokens:121};
async function armedFixture(){
  const f=await fixture();
  const s=await configureDreamTide(f.db,f.cid,{...config,allowExtra:true,execution:{...config.execution,extraPerDay:2}},modelId,{expectedRevision:f.opts.revision,enable:true,now:due-86400000,deviceGrant:{digest:await deviceKeyDigest(key),requestLimit:4}});
  const base={revision:s.revision,modelId,deviceKey:key};
  const send=(value)=>deviceDreamAction(f.env,f.cid,{...base,...value},due,()=>due);
  return {...f,send,base};
}
const call=(id,name,args)=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
test('online device authorization, durable tool delivery and note readback',async()=>{
  const {db,cid,send}=await armedFixture();
  assert.equal((await send({action:'claim',deviceKey:'b'.repeat(64)})).reason,'not_authorized');
  const started=await send({action:'claim'});assert.equal(started.ok,true);
  assert.ok(started.tools.some(t=>t.function.name==='dream_write_note'));
  assert.equal(started.requestLimit,4);
  const claim_id=started.claim.claimId;
  const action=(v)=>send({claim_id,...v});
  assert.equal((await action({action:'step',step:0,finish:'stop',usage,calls:[]})).ok,false);
  assert.equal((await action({action:'reserve',step:0})).ok,true);
  assert.equal((await action({action:'reserve',step:0})).ok,false);
  const result=await action({action:'step',step:0,finish:'tool_calls',usage,calls:[
    call('note','dream_write_note',{body:'一封真实在线手记'}),
    call('extra','dream_schedule_extra',{at:new Date(due+3600000).toISOString()}),
    call('forbidden','delete_conversation',{id:cid})
  ]});
  assert.equal(result.ok,true);
  assert.equal(JSON.parse(result.results[0].content).ok,true);
  assert.equal(JSON.parse(result.results[1].content).ok,true);
  assert.equal(JSON.parse(result.results[2].content).ok,false);
  assert.equal((await action({action:'step',step:0,finish:'tool_calls',usage,calls:[call('duplicate','dream_write_note',{body:'不可重复'})]})).ok,false);
  assert.equal((await action({action:'reserve',step:1})).ok,true);
  assert.equal((await action({action:'step',step:1,finish:'stop',usage:{total_tokens:123},calls:[]})).ok,true);
  assert.equal((await action({action:'reserve',step:2})).ok,false);
  const end=await action({action:'finish',completed:true});
  assert.equal(end.status,'completed');assert.equal(end.extraScheduled,true);
  const note=await db.prepare('SELECT body FROM dream_tide_notes WHERE claim_id=?').bind(claim_id).first();
  assert.equal(note.body,'一封真实在线手记');
  const run=await db.prepare('SELECT status,result_json FROM dream_tide_runs WHERE claim_id=?').bind(claim_id).first();
  assert.equal(run.status,'completed');assert.equal(JSON.parse(run.result_json).total_tokens,444);
  assert.equal((await send({action:'claim'})).ok,false);
  const {readDreamArchive,prepareDreamArchive}=await import('../functions/dream-tide-archive.js');
  const snapshot=await readDreamArchive(db,cid);
  assert.equal(snapshot.notes[0].body,'一封真实在线手记');
  assert.equal(snapshot.steps.length,2);assert.equal(snapshot.tools.length,2);
  assert.equal(snapshot.settings.modelId,modelId);
  const encoded=JSON.stringify(snapshot);
  for(const forbidden of ['device_digest','device_request_limit','device_dispatch_done',key,await deviceKeyDigest(key)])assert.equal(encoded.includes(forbidden),false);
  const restored=new D1Database();
  // Parent chat restore creates the conversation separately; this fixture
  // restores the independent wake module with original IDs in a fresh DB.
  await restored.batch(await prepareDreamArchive(restored,cid,snapshot));
  const state=await restored.prepare('SELECT enabled,device_digest,device_request_limit FROM dream_tide_arms WHERE conversation_id=?').bind(cid).first();
  assert.equal(state.enabled,0);assert.equal(state.device_digest,null);assert.equal(state.device_request_limit,null);
  assert.equal((await restored.prepare('SELECT body FROM dream_tide_notes WHERE claim_id=?').bind(claim_id).first()).body,'一封真实在线手记');
  assert.equal((await deviceDreamAction({COAST_CHAT_DB:restored,COAST_DEVICE_DREAM_TIDE_ENABLED:'true'},cid,{action:'claim',revision:'old',modelId,deviceKey:key},due,()=>due)).reason,'not_authorized');
  const columns=await db.prepare('SELECT device_digest,device_request_limit FROM dream_tide_arms WHERE conversation_id=?').bind(cid).first();
  assert.equal(columns.device_digest,await deviceKeyDigest(key));
  assert.equal(columns.device_request_limit,4);
});
test('unknown usage never authorizes tools or further inference',async()=>{
  const {db,send}=await armedFixture();
  const started=await send({action:'claim'}),claim_id=started.claim.claimId;
  const action=v=>send({claim_id,...v});
  assert.equal((await action({action:'reserve',step:0})).ok,true);
  const step=await action({action:'step',step:0,finish:'tool_calls',usage:null,calls:[call('note','dream_write_note',{body:'不能写'})]});
  assert.equal(step.canContinue,false);assert.equal(JSON.parse(step.results[0].content).ok,false);
  assert.equal((await action({action:'reserve',step:1})).ok,false);
  assert.equal((await action({action:'finish',completed:true})).status,'failed');
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM dream_tide_notes').first()).n,0);
});
test('revocation rejects a device heartbeat and further step reservation',async()=>{
  const {db,cid,base,send}=await armedFixture();
  const started=await send({action:'claim'});
  assert.equal(started.ok,true);
  assert.equal(await disarmDreamTide(db,cid,base.revision),true);
  assert.equal((await send({action:'heartbeat',claim_id:started.claim.claimId})).ok,false);
  assert.equal((await send({action:'reserve',step:0,claim_id:started.claim.claimId})).ok,false);
});

test('owner route separates device authorization from cloud scheduling and checks native origin',async()=>{
  const db=new D1Database(),cv=await createConversation(db,'device route','main');
  const env={COAST_CHAT_DB:db,COAST_DEVICE_DREAM_TIDE_ENABLED:'true',COAST_DREAM_TIDE_ENABLED:'false',COAST_DREAM_TIDE_SCHEDULER:'false'};
  const base='/api/chat/dream-tide',url='https://coast.test'+base;
  const body={conversation_id:cv.id,revision:null,action:'arm',config,modelId,confirmExecution:true,confirmPlanSoftBudget:true,planRequestLimit:4,deviceKey:key};
  const send=(payload,opts={})=>routeChatApi(new Request(url+(opts.path||''),{method:'POST',headers:{'Content-Type':'application/json',Origin:opts.origin||'https://coast.test',...(opts.native===false?{}:{'X-Coast-Client':'native-android'})},body:JSON.stringify(payload)}),opts.env||env);
  assert.equal((await send(body,{native:false})).status,409);
  assert.equal((await send(body,{origin:'https://other.test'})).status,403);
  assert.equal((await send({...body,confirmPlanSoftBudget:false})).status,400);
  assert.equal((await send(body,{env:{...env,COAST_DEVICE_DREAM_TIDE_ENABLED:'false'}})).status,409);
  const armed=await send(body);assert.equal(armed.status,200);
  const state=(await armed.json()).settings;assert.equal(state.enabled,true);
  const status=await (await routeChatApi(new Request(url+'?conversation_id='+cv.id),env)).json();
  assert.equal(status.planExecutionAvailable,true);assert.equal(status.schedulerConfigured,false);
  const claim={conversation_id:cv.id,action:'claim',revision:state.revision,modelId,deviceKey:'b'.repeat(64)};
  assert.equal((await send(claim,{path:'/device',native:false})).status,403);
  assert.equal((await (await send(claim,{path:'/device'})).json()).reason,'not_authorized');
  assert.equal((await send({...body,revision:state.revision,action:'disarm'})).status,200);
  const stored=await db.prepare('SELECT enabled,device_digest,device_request_limit FROM dream_tide_arms WHERE conversation_id=?').bind(cv.id).first();
  assert.equal(stored.enabled,0);assert.equal(stored.device_digest,null);assert.equal(stored.device_request_limit,null);
});


test('device phases and scoped GET recovery distinguish missing delivery from model reservation',async()=>{
  const {db,cid,env,send}=await armedFixture();
  const {recoverDreamTide}=await import('../functions/dream-tide-ledger.js');
  const {readDreamActivity}=await import('../functions/dream-tide-records.js');
  const started=await send({action:'claim'}),claim_id=started.claim.claimId;
  assert.equal(started.ok,true);
  let [run]=await readDreamActivity(db,cid);
  assert.equal(run.result.phase,'claim_response_ready');assert.equal(run.steps.length,0);
  assert.equal(run.result.limits.request_limit,4);
  assert.equal((await send({action:'received',claim_id})).ok,true);
  assert.equal((await send({action:'heartbeat',claim_id})).ok,true);
  [run]=await readDreamActivity(db,cid);
  assert.equal(run.result.phase,'device_received');assert.equal(run.result.heartbeat_at,due);
  assert.equal(await recoverDreamTide(db,due+1800000,1800000,cid),0);
  const unrelated=await createConversation(db,'unrelated wake','main');
  assert.equal(await recoverDreamTide(db,due+1800001,1800000,unrelated.id),0);
  assert.equal(await recoverDreamTide(db,due+1800001,1800000,cid),1);
  [run]=await readDreamActivity(db,cid);
  assert.equal(run.status,'interrupted');assert.equal(run.result.reason,'heartbeat_expired');
  assert.equal(run.result.last_activity_at,due);assert.equal(run.result.heartbeat_at,due);
  assert.equal(run.steps.length,0);assert.equal((await send({action:'reserve',claim_id,step:0})).ok,false);
  assert.equal((await send({action:'claim'})).ok,false);
});

test('activity GET recovers only stale claims and reports the durable reason',async()=>{
  const {db,cid,env,send}=await armedFixture();
  const started=await send({action:'claim'});assert.equal(started.ok,true);
  // Set a stale heartbeat on this test fixture only, independently of wall-clock date.
  await db.prepare("UPDATE dream_tide_runs SET updated_at=? WHERE claim_id=?").bind(Date.now()-1800001,started.claim.claimId).run();
  const res=await routeChatApi(new Request('https://coast.test/api/chat/dream-tide/activity?conversation_id='+cid),env);
  assert.equal(res.status,200);const data=await res.json();assert.equal(data.items[0].status,'interrupted');
  assert.equal(data.items[0].result.reason,'heartbeat_expired');assert.equal(data.items[0].steps.length,0);
});
