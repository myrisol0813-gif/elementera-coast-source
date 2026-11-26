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


// Durable server-side reservation and canonical commit use real SQLite via D1.
const {D1Database}=await import('./d1-helper.mjs');
const {createConversation,writeConversationState,readConversationState}=await import('../functions/chat-store.js');
const {acquireReplyRun,reserveReplyStep,claimReplyStep,commitReplyStep,settleReplyRun,recoverStaleReplyRuns}=await import('../functions/chat-reply-run.js');
const db=new D1Database(),cv=await createConversation(db,'sequence','main');
const ident={conversationId:cv.id,turnId:'durable-turn',userVariantId:'durable-user',sequenceId:'durable-seq'};
const base={context_settings:{reply_sequence_enabled:true,reply_sequence_tool_budget:0},turns:[{id:ident.turnId,user:{variants:[{id:ident.userVariantId,content:'hello'}]}}]};
await writeConversationState(db,cv.id,base);
const quota={maxMessages:2,toolBudget:12,tokenBudget:200};
assert.equal(await acquireReplyRun(db,ident,quota),true);
assert.equal(await acquireReplyRun(db,{...ident,sequenceId:'racing'},quota),false);
await assert.rejects(()=>writeConversationState(db,cv.id,base),e=>e.type==='history_changed');
assert.equal(await reserveReplyStep(db,ident,'durable-first',0),true);
assert.equal(await reserveReplyStep(db,ident,'durable-other',0),false);
const claimed=await claimReplyStep(db,ident,'durable-first');
assert.deepEqual(claimed,{index:0,mayContinue:true,toolBudget:0,tokenBudget:200,previous:[]});
assert.equal(await claimReplyStep(db,ident,'durable-first'),null);
assert.ok(await commitReplyStep(db,ident,'durable-first',{id:'durable-first',content:'first',finish_reason:'stop'},{tool_calls:0,total_tokens:80,continue_requested:true}));
assert.equal(await reserveReplyStep(db,ident,'durable-second',1),true);
assert.deepEqual(await claimReplyStep(db,ident,'durable-second'),{index:1,mayContinue:false,toolBudget:0,tokenBudget:120,previous:[{id:'durable-first',content:'first'}]});
assert.ok(await commitReplyStep(db,ident,'durable-second',{id:'durable-second',content:'second',finish_reason:'stop'},{tool_calls:0,total_tokens:40,continue_requested:false}));
assert.equal(await settleReplyRun(db,ident,'completed'),true);
assert.equal(await acquireReplyRun(db,ident,quota),false);
const canonical=await readConversationState(db,cv.id);
assert.deepEqual(canonical.turns[0].assistant.variantsByUserVariant['0'].map(v=>[v.id,v.content,v.reply_sequence.index]),[['durable-first','first',0],['durable-second','second',1]]);
await assert.rejects(()=>writeConversationState(db,cv.id,base),e=>e.type==='reply_group_history_changed');
const half=structuredClone(canonical);half.turns[0].assistant.variantsByUserVariant['0'].pop();
await assert.rejects(()=>writeConversationState(db,cv.id,half,{deleteRevision:canonical.updated_at}),e=>e.type==='reply_group_history_changed');
const interrupted={...ident,sequenceId:'interrupted-seq'};
assert.equal(await acquireReplyRun(db,interrupted,quota),true);
assert.equal(await reserveReplyStep(db,interrupted,'uncertain',0),true);
assert.ok(await claimReplyStep(db,interrupted,'uncertain'));
assert.equal(await recoverStaleReplyRuns(db,Date.now()+31*60*1000),1);
assert.equal(await claimReplyStep(db,interrupted,'uncertain'),null);
assert.equal(await acquireReplyRun(db,interrupted,quota),false);
assert.equal(await commitReplyStep(db,interrupted,'uncertain',{id:'uncertain',content:'late',finish_reason:'stop'},{tool_calls:0,total_tokens:1}),null);

const {executeDurableReplyRun,canonicalReplyContext}=await import('../functions/chat-reply-run.js');
const third={...ident,sequenceId:'real-runner'};
const invoked=[],events=[];
const runResult=await executeDurableReplyRun(db,third,{maxMessages:3,toolBudget:8,tokenBudget:1000},{
  newMessageId:()=> 'runner-'+(invoked.length+1),
  emit:(event,data)=>events.push([event,data]),
  async invoke(step,delta){
    assert.deepEqual(canonicalReplyContext(step.state,third,8),[{role:'user',content:'hello'}]);
    invoked.push(step.previous.map(v=>v.content));
    delta('partial');
    return {variant:{id:step.messageId,content:'runner text '+step.index,finish_reason:'stop'},receipt:{tool_calls:0,total_tokens:10,continue_requested:step.index===0}};
  }
});
assert.deepEqual(runResult,{status:'completed',saved:2});
assert.deepEqual(invoked,[[],['runner text 0']]);
assert.deepEqual(events.map(e=>e[0]),['reply_group_start','reply_begin','reply_delta','reply_committed','reply_begin','reply_delta','reply_committed']);
assert.deepEqual(events.filter(e=>e[0]==='reply_committed').map(e=>e[1].history.turns[0].assistant.variantsByUserVariant['0'].filter(v=>v.reply_sequence?.id===third.sequenceId).length),[1,2]);

// HTTP route invokes the actual formal-provider adapter with a synthetic
// provider. Verify the next independent request reads the first saved reply.
const {routeChatApi}=await import('../functions/chat-router.js');
const routeDb=new D1Database(),routeCv=await createConversation(routeDb,'route','main');
const routeIdentity={conversation_id:routeCv.id,source_turn_id:'route-turn',user_variant_id:'route-user',sequence_id:'route-sequence'};
await writeConversationState(routeDb,routeCv.id,{context_settings:{reply_sequence_enabled:true,reply_sequence_tool_budget:0},turns:[{id:'route-turn',user:{variants:[{id:'route-user',content:'original human'}]}}]});
const routeEnv={COAST_CHAT_DB:routeDb,OPENROUTER_API_KEY:'synthetic-key',COAST_REPLY_SEQUENCE_EXPERIMENTAL:'true'};
const crossCv=await createConversation(routeDb,'cross fixture','main');
await writeConversationState(routeDb,crossCv.id,{turns:[{id:'cross-turn',user:{variants:[{id:'cross-user',content:'selected cross-window text'}]}}]});
const {saveMysticDogtalk,getMysticDogtalk}=await import('../functions/dogtalk-store.js');
const draftScope={room_scope:'conversation',conversation_id:routeCv.id};
await saveMysticDogtalk(routeDb,{...draftScope,body:'original authorized draft',read_mode:'read_now'});
const routeBody={...routeIdentity,cross_window:{mode:'manual',messages:[{conversation_id:crossCv.id,message_id:'cross-user'}]},model:'openai/gpt-4.1-nano',settings:{streamingEnabled:false,contextBudget:6000},budget:{maxMessages:2,toolBudget:0,tokenBudget:48000}};
const makeRequest=()=>new Request('https://coast.test/api/chat/reply-sequence',{method:'POST',headers:{Origin:'https://coast.test','Content-Type':'application/json'},body:JSON.stringify(routeBody)});
assert.equal((await routeChatApi(makeRequest(),{...routeEnv,COAST_REPLY_SEQUENCE_EXPERIMENTAL:'false'})).status,409);
const routeFetch=globalThis.fetch,payloads=[];
try{
  globalThis.fetch=async(url,options={})=>{
    if(String(url).includes('/models?'))return new Response(JSON.stringify({data:[{id:'openai/gpt-4.1-nano',name:'fixture',architecture:{output_modalities:['text']},pricing:{prompt:'0.1',completion:'0.2'},supported_parameters:['tools','tool_choice']}]}),{headers:{'Content-Type':'application/json'}});
    const payload=JSON.parse(options.body);payloads.push(payload);
    const n=payloads.length;
    assert.ok(payload.messages.some(m=>typeof m.content==='string'&&m.content.includes('original authorized draft')));
    assert.ok(!payload.messages.some(m=>typeof m.content==='string'&&m.content.includes('fresh unsubmitted draft')));
    if(n===2)await saveMysticDogtalk(routeDb,{...draftScope,body:'fresh unsubmitted draft',read_mode:'read_now'});
    assert.ok(payload.messages.some(m=>typeof m.content==='string'&&m.content.includes('selected cross-window text')));
    if(n===3){
      const persisted=await readConversationState(routeDb,routeCv.id);
      assert.equal(persisted.turns[0].assistant.variantsByUserVariant['0'][0].content,'first actual reply');
      assert.deepEqual(payload.messages.filter(m=>m.role==='assistant').map(m=>m.content),['first actual reply']);
      assert.equal(payload.messages.filter(m=>m.role==='user').length,1);
    }
    return new Response(JSON.stringify({model:'openai/gpt-4.1-nano',usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120},choices:[n===1?
      {finish_reason:'tool_calls',message:{content:null,tool_calls:[{id:'continue-fixture',type:'function',function:{name:'continue_reply',arguments:'{}'}}]}}:
      {finish_reason:'stop',message:{content:n===2?'first actual reply':'second actual reply'}}]}),{headers:{'Content-Type':'application/json'}});
  };
  const response=await routeChatApi(makeRequest(),routeEnv);
  assert.equal(response.status,200);
  const wire=await response.text();
  assert.equal((wire.match(/event: reply_committed/g)||[]).length,2,wire.slice(-800));
  assert.match(wire,/event: reply_group_end/);
  assert.equal(payloads.length,3);
  assert.deepEqual((await readConversationState(routeDb,routeCv.id)).turns[0].assistant.variantsByUserVariant['0'].map(v=>v.content),['first actual reply','second actual reply']);
}finally{globalThis.fetch=routeFetch;}

const {claimReplyRunSoil,finishReplyRunSoil}=await import('../functions/chat-reply-run.js');
const {visibleCompletedTurns,soilTurnDigest,organizeConversationSoil}=await import('../functions/memory/memory-soil-organizer.js');
const groupBranch=visibleCompletedTurns(await readConversationState(routeDb,routeCv.id)).at(-1);
const groupDigest=soilTurnDigest(groupBranch,6000);
assert.deepEqual(groupDigest.assistant_messages.map(m=>m.content),['first actual reply','second actual reply']);
assert.equal(groupDigest.assistant.message_id,groupDigest.assistant_messages[1].message_id);
const soilTail=groupBranch.assistant.id;
assert.equal(await claimReplyRunSoil(routeDb,routeCv.id,'route-sequence',soilTail),true);
assert.equal(await claimReplyRunSoil(routeDb,routeCv.id,'route-sequence',soilTail),false);
assert.equal(await finishReplyRunSoil(routeDb,routeCv.id,'route-sequence','done'),true);
assert.equal((await organizeConversationSoil(routeEnv,routeCv.id,{trigger:'reply',reply_sequence_id:'route-sequence'})).reason,'reply_sequence_already_claimed_or_unsettled');
assert.equal((await organizeConversationSoil(routeEnv,routeCv.id,{trigger:'reply'})).reason,'reply_sequence_not_current');

const deskGroup=(await readConversationState(routeDb,routeCv.id)).turns[0].assistant.variantsByUserVariant['0'];
assert.equal(deskGroup[0].desk_slip.reply_sequence_previous,undefined);
assert.deepEqual(deskGroup[1].desk_slip.reply_sequence_previous,[{message_id:deskGroup[0].id,content:deskGroup[0].content}]);

assert.ok(deskGroup.every(v=>v.desk_slip.cross_window.messages.some(g=>g.messages.some(m=>m.message_id==='cross-user'))));

assert.equal((await getMysticDogtalk(routeDb,draftScope)).read_mode,'read_now');
assert.equal((await getMysticDogtalk(routeDb,draftScope)).body,'fresh unsubmitted draft');
assert.ok(deskGroup.every(v=>v.desk_slip.dogtalk.context.includes('original authorized draft')));
