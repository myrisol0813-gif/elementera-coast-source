import assert from 'node:assert/strict';
import {runReplySequence,makeContinueReplyControl,replySequenceLimit,selectedReplyGroup} from '../elementera-mcp/deploy-pages/public/features/chat/chat-reply-sequence.js';
function fixture(overrides={}){
  const events=[],controller=new AbortController();let n=0,acquired=false;
  const config={conversationId:'window',turnId:'turn',userVariantId:'user',sequenceId:'sequence',maxMessages:3,signal:controller.signal,
    newMessageId:()=>String(++n),
    acquire:async id=>{events.push(['acquire',id.sequenceId]);if(acquired)return false;acquired=true;return true;},
    reserve:async step=>{events.push(['reserve',step.messageId]);return true;},
    invoke:async(step,previous)=>{events.push(['invoke',step.messageId,previous.map(x=>x.id)]);return {successful:true,continueRequested:true,content:'reply '+step.messageId};},
    commit:async(step,result)=>{events.push(['commit',step.messageId]);return {id:step.messageId,content:result.content};},
    settle:async receipt=>events.push(['settle',receipt.status,receipt.pending?.messageId]),
    organize:async receipt=>events.push(['organize',receipt.messages.map(x=>x.id)]),...overrides};
  return {events,config,controller};
}
const f=fixture(),result=await runReplySequence(f.config);
assert.equal(result.status,'limit_reached');
assert.deepEqual(result.messages.map(x=>x.id),['1','2','3']);
assert.deepEqual(f.events,[['acquire','sequence'],['reserve','1'],['invoke','1',[]],['commit','1'],['reserve','2'],['invoke','2',['1']],['commit','2'],['reserve','3'],['invoke','3',['1','2']],['commit','3'],['settle','limit_reached',undefined],['organize',['1','2','3']]]);
assert.equal((await runReplySequence(f.config)).status,'not_acquired');
const stop=fixture({invoke:async()=>({successful:true,continueRequested:false})});
assert.equal((await runReplySequence(stop.config)).messages.length,1);
const revoke=fixture({canContinue:async()=>false});
assert.equal((await runReplySequence(revoke.config)).status,'permission_or_budget');
assert.equal(revoke.events.filter(x=>x[0]==='invoke').length,1);
const lost=fixture({reserve:async step=>step.index===0});
assert.equal((await runReplySequence(lost.config)).status,'reservation_lost');
assert.equal(lost.events.filter(x=>x[0]==='invoke').length,1);
const failure=fixture({invoke:async step=>{if(step.index===1)throw Error('provider');return {successful:true,continueRequested:true};}});
assert.equal((await runReplySequence(failure.config)).status,'failed');
assert.deepEqual(failure.events.slice(-2),[['settle','failed','2'],['organize',['1']]]);
const unconfirmed=fixture({commit:async()=>null});
assert.equal((await runReplySequence(unconfirmed.config)).status,'failed');
assert.equal(unconfirmed.events.filter(x=>x[0]==='organize').length,0);
const cancelled=fixture();cancelled.config.invoke=async()=>{cancelled.controller.abort();return {successful:true,continueRequested:true};};
assert.equal((await runReplySequence(cancelled.config)).status,'cancelled');
assert.equal(cancelled.events.filter(x=>x[0]==='reserve').length,1);
const control=makeContinueReplyControl(true);
const call={function:{name:'continue_reply',arguments:'{}'}};
assert.equal(control.requested(),false);assert.equal(control.execute({...call,function:{...call.function,arguments:'{"extra":1}'}}).ok,false);
assert.equal(control.execute(call).ok,true);assert.equal(control.requested(),true);assert.equal(control.execute(call).ok,false);
assert.deepEqual(makeContinueReplyControl(false).tools,[]);
assert.throws(()=>replySequenceLimit(0));assert.throws(()=>replySequenceLimit(21));
const {normalizeState:client}=await import('../elementera-mcp/deploy-pages/public/features/chat-state.js');
const {normalizeState:server}=await import('../functions/chat-store.js');
const v=(id,index)=>({id,content:id,reply_sequence:{id:'group',index}});
const group=[{id:'old',content:'old'},v('first',0),v('second',1)];
const raw={turns:[{id:'turn',user:{variants:[{id:'user',content:'hello'}]},assistant:{activeByUserVariant:{0:2},variantsByUserVariant:{0:group}}}]};
const normalized=server(client(raw));
const variants=normalized.turns[0].assistant.variantsByUserVariant['0'];
assert.deepEqual(selectedReplyGroup(variants,2).map(x=>x.id),['first','second']);
assert.deepEqual(selectedReplyGroup(variants,0).map(x=>x.id),['old']);
assert.deepEqual(client(normalized),normalized);
assert.throws(()=>selectedReplyGroup([v('missing-first',1)],0));
assert.equal(server({turns:[{...raw.turns[0],user:{variants:[v('user',0)]}}]}).turns[0].user.variants[0].reply_sequence,undefined);
console.log('real reply sequence contract: ok');
