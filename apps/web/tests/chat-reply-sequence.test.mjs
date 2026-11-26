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
const {acquireReplyRun,reserveReplyStep,claimReplyStep,commitReplyStep,settleReplyRun,recoverStaleReplyRuns,refreshReplyClaim}=await import('../functions/chat-reply-run.js');
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
const clock=Date.now();
assert.equal(await refreshReplyClaim(db,interrupted,'not-owned',clock+29*60*1000),false);
assert.equal(await refreshReplyClaim(db,interrupted,'uncertain',clock+29*60*1000),true);
assert.equal(await recoverStaleReplyRuns(db,clock+31*60*1000),0);
assert.equal(await recoverStaleReplyRuns(db,clock+60*60*1000),1);
assert.equal(await refreshReplyClaim(db,interrupted,'uncertain',clock+61*60*1000),false);
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
const routeEnv={COAST_CHAT_DB:routeDb,OPENROUTER_API_KEY:'synthetic-key'};
const crossCv=await createConversation(routeDb,'cross fixture','main');
await writeConversationState(routeDb,crossCv.id,{turns:[{id:'cross-turn',user:{variants:[{id:'cross-user',content:'selected cross-window text'}]}}]});
const {saveMysticDogtalk,getMysticDogtalk}=await import('../functions/dogtalk-store.js');
const draftScope={room_scope:'conversation',conversation_id:routeCv.id};
await saveMysticDogtalk(routeDb,{...draftScope,body:'original authorized draft',read_mode:'read_now'});
const routeBody={...routeIdentity,cross_window:{mode:'manual',messages:[{conversation_id:crossCv.id,message_id:'cross-user'}]},model:'openai/gpt-4.1-nano',settings:{streamingEnabled:false,contextBudget:6000},budget:{maxMessages:2,toolBudget:0,tokenBudget:48000}};
const makeRequest=()=>new Request('https://coast.test/api/chat/reply-sequence',{method:'POST',headers:{Origin:'https://coast.test','Content-Type':'application/json'},body:JSON.stringify(routeBody)});
assert.equal((await routeChatApi(makeRequest(),{...routeEnv,COAST_REPLY_SEQUENCE_EXPERIMENTAL:'false'})).status,409);
const planRequest=new Request('https://coast.test/api/chat/reply-sequence',{method:'POST',headers:{Origin:'https://coast.test','Content-Type':'application/json'},body:JSON.stringify({...routeBody,model:'chatgpt-plan:gpt-5.6-sol'})});
const planResponse=await routeChatApi(planRequest,routeEnv);
assert.equal(planResponse.status,409);
assert.match(await planResponse.text(),/reply_sequence_plan_unavailable/);
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

const {uploadOwnerSticker}=await import('../functions/sticker-library.js');
const {getChatAttachmentRecord}=await import('../functions/chat-attachments.js');
const mediaCv=await createConversation(routeDb,'group media route','main');
const png=Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,6,0,0,0]);
const sticker=await uploadOwnerSticker(routeDb,{name:'group.png',mime:'image/png',description:'group media',bytes:png},{actor:'owner'});
await writeConversationState(routeDb,mediaCv.id,{context_settings:{reply_sequence_enabled:true,sticker_send_enabled:true},turns:[{id:'media-turn',user:{variants:[{id:'media-user',content:'hello'}]}}]});
const mediaBody={conversation_id:mediaCv.id,source_turn_id:'media-turn',user_variant_id:'media-user',sequence_id:'media-run',model:'openai/gpt-4.1-nano',settings:{streamingEnabled:false,contextBudget:6000},budget:{maxMessages:2,toolBudget:2,tokenBudget:48000}};
let mediaCalls=0;
try{
  globalThis.fetch=async(url,options={})=>{
    if(String(url).includes('/models?'))return new Response(JSON.stringify({data:[{id:'openai/gpt-4.1-nano',name:'fixture',architecture:{input_modalities:['text'],output_modalities:['text']},pricing:{prompt:'0.1',completion:'0.2'},supported_parameters:['tools','tool_choice']}]}),{headers:{'Content-Type':'application/json'}});
    const payload=JSON.parse(options.body);mediaCalls++;
    if(mediaCalls===1)assert.ok(payload.tools.some(t=>t.function?.name==='sticker_send'));
    if(mediaCalls===3){
      const first=(await readConversationState(routeDb,mediaCv.id)).turns[0].assistant.variantsByUserVariant['0'][0];
      assert.equal(first.content,'');assert.equal(first.attachments.length,1);
      assert.ok(payload.messages.some(m=>typeof m.content==='string'&&m.content.includes('本组前序媒体')&&m.content.includes(first.id)));
    }
    const choice=mediaCalls===1?{finish_reason:'tool_calls',message:{content:null,tool_calls:[
      {id:'sticker-call',type:'function',function:{name:'sticker_send',arguments:JSON.stringify({sticker_id:sticker.id})}},
      {id:'more-call',type:'function',function:{name:'continue_reply',arguments:'{}'}}
    ]}}:{finish_reason:'stop',message:{content:mediaCalls===2?'':'after sticker'}};
    return new Response(JSON.stringify({model:mediaBody.model,usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120},choices:[choice]}),{headers:{'Content-Type':'application/json'}});
  };
  const response=await routeChatApi(new Request('https://coast.test/api/chat/reply-sequence',{method:'POST',headers:{Origin:'https://coast.test','Content-Type':'application/json'},body:JSON.stringify(mediaBody)}),routeEnv);
  const events=await response.text();assert.equal((events.match(/event: reply_committed/g)||[]).length,2,events.slice(-1500));
  const group=(await readConversationState(routeDb,mediaCv.id)).turns[0].assistant.variantsByUserVariant['0'];
  assert.equal(group.length,2);assert.equal(group[1].content,'after sticker');
  assert.deepEqual(new Uint8Array((await getChatAttachmentRecord(routeDb,mediaCv.id,group[0].attachments[0].id)).data),png);
  assert.equal(group[1].desk_slip.reply_sequence_previous[0].media_receipt.not_delivered[0].reason,'model_no_vision');
}finally{globalThis.fetch=routeFetch;}

 // Three independent messages: saved sticker, generated image, then text.
 // Use real route/storage/tool adapters and only replace provider HTTP.
 {
  const {writeProfile}=await import('../functions/chat-store.js');
  const {fetchModelCatalog}=await import('../functions/models/model-catalog.js');
  const cv=await createConversation(routeDb,'mixed vision group','main');
  const visionModel='openai/gpt-4.1-mini',imageModel='openai/gpt-image-1';
  await writeProfile(routeDb,{current_chat_model:visionModel,current_image_model:imageModel});
  await writeConversationState(routeDb,cv.id,{context_settings:{reply_sequence_enabled:true,sticker_send_enabled:true},turns:[{id:'mixed-turn',user:{variants:[{id:'mixed-user',content:'hello'}]}}]});
  const imageBase64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
  const stickerBase64=Buffer.from(png).toString('base64');
  const stickerUrl='data:image/png;base64,'+stickerBase64,imageUrl='data:image/png;base64,'+imageBase64;
  const urls=payload=>payload.messages.flatMap(m=>Array.isArray(m.content)?m.content.filter(p=>p.type==='image_url').map(p=>p.image_url.url):[]);
  const call=(id,name,args)=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
  let chatCalls=0,imageCalls=0;
  const answer=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
  try{
    globalThis.fetch=async(url,options={})=>{
      if(String(url).endsWith('/images/models'))return answer({data:[{id:imageModel,architecture:{output_modalities:['image']}}]});
      if(String(url).endsWith('/images')){
        imageCalls++;assert.deepEqual(JSON.parse(options.body),{model:imageModel,prompt:'a tiny blue square',n:1});
        return answer({model:imageModel,data:[{b64_json:imageBase64}],usage:{cost:0.01}});
      }
      if(String(url).includes('/models?'))return answer({data:[{id:visionModel,name:'vision fixture',architecture:{input_modalities:['text','image'],output_modalities:['text']},pricing:{prompt:'0.1',completion:'0.2'},supported_parameters:['tools','tool_choice']}]});
      assert.ok(String(url).includes('/chat/completions'),String(url));
      const payload=JSON.parse(options.body);chatCalls++;
      assert.equal(payload.model,visionModel);
      if(chatCalls===1)assert.ok(payload.tools.some(t=>t.function?.name==='sticker_send'));
      if(chatCalls===3){
        assert.ok(payload.tools.some(t=>t.function?.name==='image_generate'));
        assert.ok(urls(payload).includes(stickerUrl));
      }
      if(chatCalls===4)assert.ok(urls(payload).includes(imageUrl));
      if(chatCalls===5){
        const stored=(await readConversationState(routeDb,cv.id)).turns[0].assistant.variantsByUserVariant['0'];
        assert.equal(stored.filter(v=>v.reply_sequence?.id==='mixed-group').length,2);
        assert.ok(stored.filter(v=>!v.reply_sequence).every(v=>v.finish_reason==='image_tool_ready'));
        assert.ok(urls(payload).includes(stickerUrl));assert.ok(urls(payload).includes(imageUrl));
        assert.ok(payload.messages.some(m=>Array.isArray(m.content)&&m.content.some(p=>p.type==='text'&&p.text.includes('非人类新发言'))));
      }
      const choices=chatCalls===1?[call('mixed-sticker','sticker_send',{sticker_id:sticker.id}),call('mixed-next-a','continue_reply',{})]:
        chatCalls===3?[call('mixed-image','image_generate',{prompt:'a tiny blue square'}),call('mixed-next-b','continue_reply',{})]:[];
      return answer({model:visionModel,usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120},choices:[choices.length?{finish_reason:'tool_calls',message:{content:null,tool_calls:choices}}:{finish_reason:'stop',message:{content:chatCalls===5?'after both originals':''}}]});
    };
    await fetchModelCatalog(routeEnv,true);
    const request=new Request('https://coast.test/api/chat/reply-sequence',{method:'POST',headers:{Origin:'https://coast.test','Content-Type':'application/json'},body:JSON.stringify({conversation_id:cv.id,source_turn_id:'mixed-turn',user_variant_id:'mixed-user',sequence_id:'mixed-group',model:visionModel,image_tool_enabled:true,image_model_id:imageModel,settings:{streamingEnabled:false,contextBudget:6000},budget:{maxMessages:3,toolBudget:4,tokenBudget:48000}})});
    const response=await routeChatApi(request,routeEnv),wire=await response.text();
    const end=wire.match(/event: reply_group_end\ndata: ([^\n]+)/)?.[1];
    const summary=end?JSON.parse(end):{};
    assert.equal((wire.match(/event: reply_committed/g)||[]).length,3,JSON.stringify({status:summary.status,error_type:summary.error_type,message:summary.message,chatCalls,imageCalls}));
    assert.equal(chatCalls,5);assert.equal(imageCalls,1);
    const group=(await readConversationState(routeDb,cv.id)).turns[0].assistant.variantsByUserVariant['0'];
    assert.deepEqual(group.map(v=>v.content),['','','after both originals']);
    assert.equal(group[0].attachments.length,1);assert.equal(group[1].attachments.length,1);
    for(const [index,bytes] of [[0,png],[1,Uint8Array.from(Buffer.from(imageBase64,'base64'))]]){
      assert.deepEqual(new Uint8Array((await getChatAttachmentRecord(routeDb,cv.id,group[index].attachments[0].id)).data),bytes);
      const receipt=group[2].desk_slip.reply_sequence_previous[index].media_receipt;
      assert.equal(receipt.delivered_to_model,1);assert.equal(receipt.vision.images_delivered,1);
      assert.equal(receipt.delivered[0].id,group[index].attachments[0].id);
    }
  }finally{globalThis.fetch=routeFetch;}
 }

{
  const cv=await createConversation(routeDb,'stale device budget','main');
  const ident={conversationId:cv.id,turnId:'limit-turn',userVariantId:'limit-user',sequenceId:'limit-group'};
  await writeConversationState(routeDb,cv.id,{context_settings:{reply_sequence_enabled:true,reply_sequence_max_messages:8,reply_sequence_tool_budget:24,reply_sequence_token_budget:48000},turns:[{id:ident.turnId,user:{variants:[{id:ident.userVariantId,content:'hello'}]}}]});
  assert.equal(await acquireReplyRun(routeDb,ident,{maxMessages:1,toolBudget:0,tokenBudget:2000}),true);
  assert.equal(await reserveReplyStep(routeDb,ident,'limit-message',0),true);
  const claim=await claimReplyStep(routeDb,ident,'limit-message');
  assert.equal(claim.mayContinue,false);assert.equal(claim.toolBudget,0);assert.equal(claim.tokenBudget,2000);
  assert.equal(await settleReplyRun(routeDb,ident,'cancelled'),true);
}


// Cloud Native plan protocol: the actual model calls remain on the device.
// Simulate only device-reported results, never make a real provider request.
{
  const cv=await createConversation(routeDb,'native plan group','main');
  const model='chatgpt-plan:gpt-5.6-sol';
  const body={conversation_id:cv.id,source_turn_id:'plan-turn',user_variant_id:'plan-user',sequence_id:'plan-group',model,
    settings:{recentTurns:8,contextBudget:6000,toolCallLimit:4,worldbookEnabled:false},budget:{maxMessages:3,toolBudget:2,tokenBudget:1000}};
  const env={COAST_CHAT_DB:routeDb};
  const request=(value,path='/api/chat/native-reply-sequence')=>new Request('https://coast.test'+path,{method:'POST',headers:{Origin:'https://coast.test','Content-Type':'application/json'},body:JSON.stringify({...body,...value})});
  const action=async(action,extra={},status=200)=>{
    const r=await routeChatApi(request({action,...extra}),env);
    const raw=await r.text();assert.equal(r.status,status,raw.slice(0,1200));return JSON.parse(raw);
  };
  await writeConversationState(routeDb,cv.id,{context_settings:{reply_sequence_enabled:true,sticker_send_enabled:true,short_reply_mode:true},
    turns:[{id:'plan-turn',user:{variants:[{id:'plan-user',content:'hello plan'}]}}]});
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>{throw Error('unexpected provider request in native plan protocol');};
  try{
    assert.equal((await action('start')).max_messages,3);
    await action('start',{},409);
    const first=await action('next',{message_id:'plan-a',index:0});
    assert.ok(first.may_continue);assert.equal(first.token_budget,1000);
    assert.ok(first.context.tools.some(t=>t.name==='sticker_send'));
    assert.ok(first.context.desk_slip.response_mode.short_reply_mode);
    await action('next',{message_id:'plan-other',index:0},409);
    assert.equal((await action('heartbeat',{message_id:'plan-a'})).ok,true);
    const toolBody={model:'gpt-5.6-sol',message_id:'plan-a',reply_sequence_id:'plan-group',tool_index:0,
      tool_call:{id:'native-sticker',type:'function',function:{name:'sticker_send',arguments:JSON.stringify({sticker_id:sticker.id})}}};
    const tool=await routeChatApi(request(toolBody,'/api/chat/native-tool'),env);
    const toolResult=await tool.json();assert.equal(tool.status,200);assert.equal(toolResult.ok,true,JSON.stringify(toolResult));
    assert.equal((await routeChatApi(request(toolBody,'/api/chat/native-tool'),env)).status,409);
    const variant={id:'plan-a',content:'first plan reply',model_id:model,finish_reason:'stop',desk_slip:first.context.desk_slip};
    await action('commit',{message_id:'plan-a',variant,receipt:{tool_calls:0,total_tokens:100,continue_requested:true}},409);
    const committed=await action('commit',{message_id:'plan-a',variant,receipt:{tool_calls:1,total_tokens:100,continue_requested:true}});
    assert.equal(committed.continue_requested,true);
    assert.equal(committed.history.turns[0].assistant.variantsByUserVariant['0'][0].attachments.length,1);
    await action('commit',{message_id:'plan-a',variant,receipt:{tool_calls:1,total_tokens:100,continue_requested:true}},409);
    const second=await action('next',{message_id:'plan-b',index:1});
    assert.equal(second.tool_budget,1);assert.equal(second.token_budget,900);
    assert.ok(second.context.model_messages.some(m=>m.role==='assistant'&&m.content==='first plan reply'));
    assert.ok(second.context.model_messages.some(m=>Array.isArray(m.content)&&m.content.some(p=>p.type==='image_url')));
    assert.equal(second.context.desk_slip.reply_sequence_previous[0].message_id,'plan-a');
    const secondCommit=await action('commit',{message_id:'plan-b',variant:{id:'plan-b',content:'second plan reply',model_id:model,finish_reason:'stop',desk_slip:second.context.desk_slip},receipt:{tool_calls:0,total_tokens:null,continue_requested:true}});
    assert.equal(secondCommit.continue_requested,false,'missing usage must stop even if control requests more');
    await action('next',{message_id:'plan-c',index:2},409);
    await action('settle',{status:'permission_or_budget'});
    const group=(await readConversationState(routeDb,cv.id)).turns[0].assistant.variantsByUserVariant['0'];
    assert.deepEqual(group.map(v=>v.content),['first plan reply','second plan reply']);
    assert.deepEqual(group.map(v=>v.reply_sequence.index),[0,1]);
    const prepare={trigger:'reply',reply_sequence_id:'plan-group',model,plan_phase:'prepare'};
    const prepared=await organizeConversationSoil(env,cv.id,prepare);
    assert.equal(prepared.skipped,false,JSON.stringify(prepared));
    assert.ok(prepared.prompt.includes('first plan reply')&&prepared.prompt.includes('second plan reply'));
    assert.equal((await organizeConversationSoil(env,cv.id,prepare)).reason,'reply_sequence_already_claimed_or_unsettled');
    const result={current_text:'two plan replies organized',afterthoughts:[],memory_candidates:[],seed_candidates:[],
      user_portrait:{should_update:false},self_portrait:{should_update:false}};
    const commit={...prepare,plan_phase:'commit',expected_turn_id:prepared.expected_turn_id,expected_assistant_id:prepared.expected_assistant_id,
      expected_history_revision:prepared.expected_history_revision,expected_soil_revision:prepared.expected_soil_revision,result_text:JSON.stringify(result)};
    const paper=await organizeConversationSoil(env,cv.id,commit);
    assert.equal(paper.soil.current_text,result.current_text);
    assert.equal((await organizeConversationSoil(env,cv.id,commit)).reason,'reply_sequence_plan_commit_unconfirmed');
  }finally{globalThis.fetch=originalFetch;}
}
console.log('native plan cloud group: ok');
