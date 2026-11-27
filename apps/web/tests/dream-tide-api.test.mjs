import test from 'node:test';
import assert from 'node:assert/strict';
import {D1Database} from './d1-helper.mjs';
import {createConversation} from '../functions/chat-store.js';
import {routeChatApi,isChatApiPath} from '../functions/chat-router.js';
import {readDreamSettings,configureDreamTide,claimDreamTide,settleDreamTide} from '../functions/dream-tide-ledger.js';
import {writeDreamNote} from '../functions/dream-tide-records.js';
import {runDreamTideTick} from '../functions/dream-tide-scheduler.js';
const modelId='fixture/model',config={timeZone:'UTC',dailyTime:'09:00',allowExtra:false,execution:{tokenBudget:8000,outputLimit:500,toolBudget:3,readTurns:5,invitation:'自行活动',writeNote:true}};
const due=Date.parse('2026-11-27T09:00:00Z');
const base='/api/chat/dream-tide';
async function fixture(){
  const db=new D1Database(),cv=await createConversation(db,'dream','main'),radio=await createConversation(db,'radio','radio');
  const env={COAST_CHAT_DB:db,COAST_DREAM_TIDE_ENABLED:'true',COAST_DREAM_TIDE_SCHEDULER:'true',COAST_DREAM_TIDE_MAX_RUNS_PER_TICK:'2'};
  const cid=cv.id;
  const req=(path,body,origin='https://coast.test')=>new Request('https://coast.test'+path,body===undefined?{}:{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const send=(value,e=env)=>routeChatApi(req(base,{conversation_id:cid,...value}),e);
  return {db,cid,radio,env,req,send};
}
test('draft cannot execute; explicit arming, revision and owner-window checks',async()=>{
  const {db,cid,radio,env,req,send}=await fixture();
  assert.ok(isChatApiPath(base+'/reply'));
  assert.equal((await routeChatApi(req(base,{conversation_id:cid,action:'save'},'https://other.test'),env)).status,403);
  assert.equal((await routeChatApi(req(base+'?conversation_id='+radio.id),env)).status,404);
  let response=await send({action:'save',revision:null,config,modelId},{...env,COAST_DREAM_TIDE_ENABLED:'false'});
  assert.equal(response.status,200);let saved=(await response.json()).settings;
  assert.equal(saved.enabled,false);
  assert.equal((await send({action:'arm',revision:saved.revision,config,modelId})).status,409);
  assert.equal((await send({action:'arm',revision:saved.revision,config,modelId,confirmExecution:true},{...env,COAST_DREAM_TIDE_SCHEDULER:'false'})).status,409);
  assert.equal((await send({action:'save',revision:null,config,modelId})).status,409);
  response=await send({action:'arm',revision:saved.revision,config,modelId,confirmExecution:true});
  assert.equal(response.status,200);saved=(await response.json()).settings;assert.equal(saved.enabled,true);
  response=await send({action:'disarm',revision:saved.revision});assert.equal(response.status,200);
  assert.equal((await readDreamSettings(db,cid)).enabled,false);
  assert.equal((await send({action:'arm',revision:saved.revision,config,modelId,confirmExecution:true})).status,409);
});
test('notes pagination and reply retries are scoped and do not schedule',async()=>{
  const {db,cid,env,req}=await fixture();
  await configureDreamTide(db,cid,config,modelId,{enable:true,now:due-86400000});
  const claim=await claimDreamTide(db,cid,{now:due,currentModelId:modelId,busy:false});
  assert.ok(claim);assert.ok(await writeDreamNote(db,claim,'原笺',due));
  await settleDreamTide(db,claim,'completed',due);
  const v={conversation_id:cid,claim_id:claim.claimId,reply_id:'reply-one',body:'回笺'};
  const reply=()=>routeChatApi(req(base+'/reply',v),env);
  assert.equal((await reply()).status,200);
  assert.equal((await (await reply()).json()).duplicate,true);
  assert.equal((await routeChatApi(req(base+'/reply',{...v,body:'different'}),env)).status,409);
  const notes=await (await routeChatApi(req(base+'/notes?conversation_id='+cid+'&limit=1'),env)).json();
  assert.equal(notes.items[0].replies.length,1);assert.equal(notes.nextOffset,1);
  assert.equal((await (await routeChatApi(req(base+'/notes?conversation_id='+cid+'&offset=1'),env)).json()).items.length,0);
  assert.equal((await readDreamSettings(db,cid)).extraAt,null);
});
test('trusted scheduler only dispatches due armed windows, obeys deployment cap and keeps exact revision/model',async()=>{
  const {db,cid,env}=await fixture();
  const saved=await configureDreamTide(db,cid,config,modelId,{enable:true,now:due-86400000});
  const next=await createConversation(db,'later','main');
  await configureDreamTide(db,next.id,{...config,dailyTime:'23:00'},modelId,{enable:true,now:due-86400000});
  const draft=await createConversation(db,'draft','main');
  await configureDreamTide(db,draft.id,config,modelId,{enable:false,now:due-86400000});
  const calls=[];
  const execute=async(env,window,opts)=>{
    calls.push({window,opts});
    const claim=await claimDreamTide(db,window,opts);assert.ok(claim);
    await settleDreamTide(db,claim,'completed',due);
    return {status:'completed'};
  };
  assert.equal((await runDreamTideTick({...env,COAST_DREAM_TIDE_SCHEDULER:'false'},{now:due,execute})).attempts,0);
  assert.equal((await runDreamTideTick({...env,COAST_DREAM_TIDE_MAX_RUNS_PER_TICK:''},{now:due,execute})).attempts,0);
  const tick=await runDreamTideTick(env,{now:due,execute});assert.equal(tick.completed,1);
  assert.equal(calls[0].window,cid);assert.equal(calls[0].opts.expectedRevision,saved.revision);assert.equal(calls[0].opts.currentModelId,modelId);
  assert.equal((await runDreamTideTick(env,{now:due+1,execute})).attempts,0);
});

test('a long scheduled activity cannot start another window using a stale time',async()=>{
  const {db,cid,env}=await fixture();
  const next=await createConversation(db,'quiet-after-first','main');
  const quietConfig={...config,quietHours:{start:'09:01',end:'10:00'}};
  // Stable lexicographic dispatch order is intentionally irrelevant: both
  // windows become quiet before the first activity returns.
  for(const id of [cid,next.id])await configureDreamTide(db,id,quietConfig,modelId,{enable:true,now:due-86400000});
  let live=due;
  const calls=[];
  const execute=async(_env,window,opts)=>{
    calls.push(window);
    const claim=await claimDreamTide(db,window,opts);assert.ok(claim);
    live=due+120000;
    assert.equal(opts.clock(),live);
    assert.ok(await settleDreamTide(db,claim,'completed',opts.clock()));
    return {status:'completed'};
  };
  const tick=await runDreamTideTick(env,{clock:()=>live,execute});
  assert.equal(tick.completed,1);assert.equal(tick.attempts,1);assert.equal(calls.length,1);
  const deferred=calls[0]===cid?next.id:cid;
  assert.equal((await runDreamTideTick(env,{clock:()=>live,execute})).attempts,0);
  const remaining=await db.prepare("SELECT COUNT(*) AS n FROM dream_tide_runs WHERE conversation_id=?").bind(deferred).first();
  assert.equal(remaining.n,0);
});
test('scheduled Worker uses live time rather than a frozen explicit now',async()=>{
  const {readFile}=await import('node:fs/promises');
  const source=await readFile(new URL('../workers/dream-tide-worker.js',import.meta.url),'utf8');
  assert.match(source,/runDreamTideTick\(env\)/);
  const {default:worker}=await import('../workers/dream-tide-worker.js');
  assert.equal(worker.fetch().status,404);
  let pending;
  await worker.scheduled({}, {}, {waitUntil(p){pending=p;}});
  assert.ok(pending instanceof Promise);
  await pending;
});
