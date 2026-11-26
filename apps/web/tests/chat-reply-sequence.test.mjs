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

const {contextMessages}=await import('../elementera-mcp/deploy-pages/public/features/chat/chat-context.js');
const {activeMessages}=await import('../elementera-mcp/deploy-pages/public/features/chat-state.js');
const target={id:'next-turn',user:{variants:[{id:'next-user',content:'next question'}]},assistant:{activeByUserVariant:{0:0},variantsByUserVariant:{0:[{id:'failed',content:'not part of retry'}]}}};
const oldTurn={id:'older-turn',user:{variants:[{id:'older-user',content:'older question'}]},assistant:{variantsByUserVariant:{0:[{id:'older-answer',content:'older answer'}]}}};
const history={turns:[oldTurn,raw.turns[0],target]};
assert.deepEqual(contextMessages(history,target.id,{recentTurns:2}).map(x=>[x.role,x.content]),[['user','hello'],['assistant','first'],['assistant','second'],['user','next question']]);
assert.deepEqual(contextMessages(history,target.id,{recentTurns:1}).map(x=>x.content),['next question']);
assert.deepEqual(activeMessages(raw).map(x=>x.content),['hello','first','second']);
const alternative={...raw.turns[0],assistant:{...raw.turns[0].assistant,activeByUserVariant:{0:0}}};
assert.deepEqual(contextMessages({turns:[alternative,target]},target.id,{recentTurns:2}).map(x=>x.content),['hello','old','next question']);
assert.deepEqual(contextMessages({turns:[raw.turns[0]]},'turn',{recentTurns:2}).map(x=>x.content),['hello']);

const {replyAlternatives}=await import('../elementera-mcp/deploy-pages/public/features/chat/chat-reply-sequence.js');
const {switchVariant,deleteActiveAssistantVariant,appendAssistantVariant,activeBranch}=await import('../elementera-mcp/deploy-pages/public/features/chat-state.js');
assert.equal(replyAlternatives(variants).length,2);
const switched=switchVariant(raw,'turn','assistant','previous');
assert.equal(activeBranch(switched.turns[0]).assistant.id,'old');
const back=switchVariant(switched,'turn','assistant','next');
assert.equal(activeBranch(back.turns[0]).assistant.id,'second');
const deleted=deleteActiveAssistantVariant(back,'turn');
assert.deepEqual(activeBranch(deleted.turns[0]).assistants.map(x=>x.id),['old']);
const full={turns:[{...raw.turns[0],assistant:{activeByUserVariant:{0:19},variantsByUserVariant:{0:[...group,...Array.from({length:17},(_,i)=>({id:'legacy-'+i,content:'legacy'}))]}}}]};
const rejected=appendAssistantVariant(full,'turn',{id:'new',content:'new'});
assert.equal(rejected.variant,null);
assert.equal(activeBranch(rejected.state.turns[0]).assistants.length,20);

const {resolveReplySequenceBudget,remainingReplySequenceBudget}=await import('../elementera-mcp/deploy-pages/public/features/chat/chat-reply-sequence.js');
const globalBudget={replySequenceMaxMessages:5,replySequenceToolBudget:18,replySequenceTokenBudget:12000};
const override={reply_sequence_enabled:true,reply_sequence_max_messages:4,reply_sequence_tool_budget:0,reply_sequence_token_budget:9000};
assert.deepEqual(server(client({context_settings:override})).context_settings,{reality_enabled:false,reality_fields:[],short_reply_mode:false,...override,weather_city:''});
const budget=resolveReplySequenceBudget(globalBudget,override,18);
assert.deepEqual(budget,{enabled:true,maxMessages:2,toolBudget:0,tokenBudget:9000});
assert.equal(resolveReplySequenceBudget(globalBudget,{},0).maxMessages,1);
assert.equal(resolveReplySequenceBudget(globalBudget,override,20).maxMessages,0);
assert.deepEqual(remainingReplySequenceBudget(budget,[{toolCalls:0,totalTokens:6000},{toolCalls:0,totalTokens:3000}]),{known:true,tools:0,tokens:0});
assert.equal(remainingReplySequenceBudget(budget,[{toolCalls:0}]).known,false);
assert.equal(resolveReplySequenceBudget(globalBudget,{reply_sequence_enabled:true,reply_sequence_max_messages:-1},0).maxMessages,5);
