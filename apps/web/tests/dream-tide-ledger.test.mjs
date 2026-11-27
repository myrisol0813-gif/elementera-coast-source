import test from 'node:test';
import assert from 'node:assert/strict';
import {D1Database} from './d1-helper.mjs';
import {createConversation} from '../functions/chat-store.js';
import {normalizeDreamConfig,armDreamTide,disarmDreamTide,setDreamTideExtra,claimDreamTide,dreamTideClaimAuthorized,heartbeatDreamTide,settleDreamTide,recoverDreamTide} from '../functions/dream-tide-ledger.js';
const t=Date.parse, armedAt=t('2026-11-26T00:00:00Z'), due=t('2026-11-27T01:00:00Z');
const config={timeZone:'Asia/Shanghai',dailyTime:'09:00',allowExtra:true};
const model='fixture/model';
async function fixture(){
  const db=new D1Database(),c=await createConversation(db,'Dream tide fixture','main');
  const rev=await armDreamTide(db,c.id,config,model,armedAt);
  assert.ok(rev);
  return {db,cid:c.id,rev};
}
test('only an armed ordinary window and current model may claim; concurrent polls cannot duplicate',async()=>{
  const {db,cid}=await fixture();
  assert.equal(await claimDreamTide(db,cid,{now:due,currentModelId:model}),null);
  assert.equal(await claimDreamTide(db,cid,{now:due,currentModelId:'other',busy:false}),null);
  const radio=await createConversation(db,'Radio','radio');
  assert.equal(await armDreamTide(db,radio.id,config,model,armedAt),null);
  const results=await Promise.all(Array.from({length:5},()=>claimDreamTide(db,cid,{now:due,currentModelId:model,busy:false})));
  const claims=results.filter(Boolean);
  assert.equal(claims.length,1);
  const [claim]=claims;
  assert.equal(claim.key,'daily:2026-11-27');
  assert.equal(await dreamTideClaimAuthorized(db,claim),true);
  assert.equal(await armDreamTide(db,cid,config,model,due),null);
  assert.equal(await settleDreamTide(db,claim,'completed',due+1),true);
  assert.equal(await settleDreamTide(db,claim,'completed',due+2),false);
  assert.equal(await claimDreamTide(db,cid,{now:due+3,currentModelId:model,busy:false}),null);
});
test('recovery consumes uncertain slots, heartbeat prevents premature recovery and disarm revokes claims',async()=>{
  const {db,cid,rev}=await fixture();
  const claim=await claimDreamTide(db,cid,{now:due,currentModelId:model,busy:false});
  assert.ok(claim);
  assert.equal(await heartbeatDreamTide(db,claim,due+100),true);
  assert.equal(await recoverDreamTide(db,due+150,100),0);
  assert.equal(await recoverDreamTide(db,due+250,100),1);
  assert.equal(await heartbeatDreamTide(db,claim,due+251),false);
  assert.equal(await settleDreamTide(db,claim,'completed',due+251),false);
  assert.equal(await claimDreamTide(db,cid,{now:due+251,currentModelId:model,busy:false}),null);
  const next=await claimDreamTide(db,cid,{now:due+86400000,currentModelId:model,busy:false});
  assert.ok(next);
  assert.equal(await disarmDreamTide(db,cid,rev),true);
  assert.equal(await dreamTideClaimAuthorized(db,next),false);
  assert.equal(await heartbeatDreamTide(db,next,due+86400001),false);
  assert.equal(await settleDreamTide(db,next,'cancelled',due+86400001),true);
  assert.equal(await claimDreamTide(db,cid,{now:due+172800000,currentModelId:model,busy:false}),null);
});
test('extra appointment is optional and consumed without rewriting daily slot',async()=>{
  const {db,cid,rev}=await fixture();
  assert.equal(await setDreamTideExtra(db,cid,rev,'extra-one',due+60,armedAt),true);
  assert.equal(await setDreamTideExtra(db,cid,rev,'other',due+90,armedAt),false);
  const daily=await claimDreamTide(db,cid,{now:due+60,currentModelId:model,busy:false});
  assert.equal(daily.kind,'daily');
  assert.equal(await claimDreamTide(db,cid,{now:due+60,currentModelId:model,busy:false}),null);
  await settleDreamTide(db,daily,'completed',due+61);
  const extra=await claimDreamTide(db,cid,{now:due+62,currentModelId:model,busy:false});
  assert.equal(extra.key,'extra:extra-one');
  await settleDreamTide(db,extra,'completed',due+63);
  assert.equal(await setDreamTideExtra(db,cid,rev,'extra-one',due+100,due+64),false);
  assert.equal(await claimDreamTide(db,cid,{now:due+100,currentModelId:model,busy:false}),null);
});

test('missed extra appointment is not replayed and cannot block future appointments',async()=>{
  const {db,cid,rev}=await fixture();
  assert.equal(await setDreamTideExtra(db,cid,rev,'missed',due+60,armedAt),true);
  const tomorrow=due+86400000;
  const daily=await claimDreamTide(db,cid,{now:tomorrow,currentModelId:model,busy:false});
  assert.equal(daily.kind,'daily');
  await settleDreamTide(db,daily,'completed',tomorrow+1);
  assert.equal(await claimDreamTide(db,cid,{now:tomorrow+2,currentModelId:model,busy:false}),null);
  assert.equal(await setDreamTideExtra(db,cid,rev,'new',tomorrow+100,tomorrow+2),true);
  const extra=await claimDreamTide(db,cid,{now:tomorrow+100,currentModelId:model,busy:false});
  assert.equal(extra.key,'extra:new');
});

test('ordinary, grouped and dream admissions exclude each other atomically',async()=>{
  const {db,cid}=await fixture();
  const {writeConversationState}=await import('../functions/chat-store.js');
  const {acquireReplyRun,settleReplyRun}=await import('../functions/chat-reply-run.js');
  const {acquireSingleChatRun,releaseSingleChatRun,heartbeatSingleChatRun,recoverSingleChatRuns}=await import('../functions/chat-single-run.js');
  const identity={conversationId:cid,turnId:'turn',userVariantId:'user',sequenceId:'group'};
  await writeConversationState(db,cid,{context_settings:{reply_sequence_enabled:true},turns:[{id:'turn',user:{variants:[{id:'user',content:'hello'}]}}]});
  const budget={maxMessages:2,toolBudget:0,tokenBudget:200};
  const claim=await acquireSingleChatRun(db,cid,due);
  assert.ok(claim);
  assert.equal(await acquireSingleChatRun(db,cid,due),null);
  assert.equal(await acquireReplyRun(db,identity,budget),false);
  assert.equal(await claimDreamTide(db,cid,{now:due,currentModelId:model,busy:false}),null);
  assert.equal(await heartbeatSingleChatRun(db,claim,due+100),true);
  assert.equal(await recoverSingleChatRuns(db,due+150,100),0);
  assert.equal(await releaseSingleChatRun(db,claim),true);
  assert.equal(await acquireReplyRun(db,identity,budget),true);
  assert.equal(await acquireSingleChatRun(db,cid,due),null);
  assert.equal(await claimDreamTide(db,cid,{now:due,currentModelId:model,busy:false}),null);
  await settleReplyRun(db,identity,'cancelled');
  const dream=await claimDreamTide(db,cid,{now:due,currentModelId:model,busy:false});
  assert.ok(dream);
  assert.equal(await acquireSingleChatRun(db,cid,due),null);
  assert.equal(await acquireReplyRun(db,{...identity,sequenceId:'other'},budget),false);
  assert.equal(await settleDreamTide(db,dream,'completed',due+1),true);
  const next=await acquireSingleChatRun(db,cid,due+2);
  assert.ok(next);
  assert.equal(await releaseSingleChatRun(db,claim),false);
  assert.equal(await recoverSingleChatRuns(db,due+200,100),1);
  assert.equal(await heartbeatSingleChatRun(db,next,due+201),false);
});

test('owner-defined larger execution budgets are accepted without truncation',()=>{
  const execution={tokenBudget:2000000,outputLimit:100000,toolBudget:200,readTurns:500,extraPerDay:200,voiceLimit:200,imageLimit:200,invitation:'fixture'};
  const normalized=normalizeDreamConfig({...config,execution}).execution;
  for(const [key,value] of Object.entries(execution))assert.equal(normalized[key],value);
  assert.throws(()=>normalizeDreamConfig({...config,execution:{...execution,outputLimit:2147483647}}));
});
