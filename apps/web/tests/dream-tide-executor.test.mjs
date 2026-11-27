import test from 'node:test';
import assert from 'node:assert/strict';
import {D1Database} from './d1-helper.mjs';
import {createConversation,writeConversationState,readConversationState} from '../functions/chat-store.js';
import {armDreamTide,disarmDreamTide} from '../functions/dream-tide-ledger.js';
import {executeDreamTide} from '../functions/dream-tide-executor.js';
import {readDreamActivity,readDreamNotes,replyDreamNote,readDreamHistory} from '../functions/dream-tide-records.js';
const t=Date.parse,armAt=t('2026-11-26T00:00:00Z'),due=t('2026-11-27T01:00:00Z'),model='fixture/model';
const execution={tokenBudget:8000,outputLimit:500,toolBudget:4,readTurns:5,invitation:'自由探索，不必写小笺。',readHistory:true,writeNote:true,includeTime:true,includePrevious:true,includeReplies:true,extraPerDay:2};
async function fixture(overrides={}){
  const db=new D1Database(),cv=await createConversation(db,'dream','main'),other=await createConversation(db,'other','main');
  const cid=cv.id;
  await writeConversationState(db,cid,{turns:[{id:'turn-one',user:{variants:[{id:'u-one',content:'window-original',created_at:new Date(armAt).toISOString()}]},assistant:{variantsByUserVariant:{0:[{id:'a-one',content:'answer-original',created_at:new Date(armAt+1).toISOString()}]}}}]});
  await writeConversationState(db,other.id,{turns:[{id:'secret',user:{variants:[{id:'u-secret',content:'other-window-secret'}]}}]});
  const rev=await armDreamTide(db,cid,{timeZone:'Asia/Shanghai',dailyTime:'09:00',allowExtra:true,execution:{...execution,...overrides}},model,armAt);
  const env={COAST_CHAT_DB:db,COAST_DREAM_TIDE_ENABLED:'true'};
  const prepare=async(env,input)=>({modelId:input.model,payload:{model:input.model,messages:input.messages,tools:input.tools,max_tokens:input.settings.max_tokens}});
  const opts={currentModelId:model,busy:false,now:due,clock:()=>due,prepare};
  return {db,cid,other,rev,env,opts};
}
const usage={prompt_tokens:100,completion_tokens:20,total_tokens:120,cost:0.002};
const toolCall=(id,name,args)=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
const response=(calls=[],u=usage)=>({model,usage:u,choices:[{finish_reason:calls.length?'tool_calls':'stop',message:{content:'',tool_calls:calls}}]});
test('explicit gating and quiet completion with no fabricated human turn',async()=>{
  const {env,db,cid,opts}=await fixture();let called=0;
  const invoke=async(env,payload)=>{called++;assert.equal(payload.messages[0].role,'system');assert.equal(payload.messages.length,1);assert.ok(!JSON.stringify(payload).includes('window-original'));return response();};
  assert.equal((await executeDreamTide({...env,COAST_DREAM_TIDE_ENABLED:'false'},cid,{...opts,invoke})).status,'disabled_or_busy');
  assert.equal(called,0);
  const out=await executeDreamTide(env,cid,{...opts,invoke});assert.equal(out.status,'completed');assert.equal(out.total_tokens,120);
  assert.equal(called,1);assert.equal((await readDreamNotes(db,cid)).length,0);
  assert.equal((await readDreamActivity(db,cid))[0].steps.length,1);
  assert.equal((await readConversationState(db,cid)).turns.length,1);
  assert.equal((await executeDreamTide(env,cid,{...opts,invoke})).status,'not_due');assert.equal(called,1);
});
test('model reads scoped originals, writes optional note, human reply never wakes; actual usage recorded',async()=>{
  const {env,db,cid,other,opts}=await fixture();let n=0;
  const invoke=async(env,payload)=>{
    n++;assert.ok(!JSON.stringify(payload).includes('other-window-secret'));
    if(n===1)return response([toolCall('r','dream_read_history',{mode:'window',start:0,count:1})]);
    if(n===2){assert.ok(JSON.stringify(payload.messages).includes('answer-original'));return response([toolCall('n','dream_write_note',{body:'一张小笺'}),toolCall('s','dream_schedule_extra',{at:new Date(due+3600000).toISOString()})]);}
    return response();
  };
  const out=await executeDreamTide(env,cid,{...opts,invoke});assert.equal(out.status,'completed');assert.equal(out.extraScheduled,true);assert.equal(out.tool_calls,3);assert.equal(out.total_tokens,360);assert.equal(n,3);
  const activity=(await readDreamActivity(db,cid))[0];assert.equal(activity.result.extra_scheduled,true);assert.deepEqual(activity.tools.map(x=>[x.tool_name,x.status]),[['dream_read_history','completed'],['dream_write_note','completed'],['dream_schedule_extra','completed']]);
  assert.ok(!JSON.stringify(activity.tools).includes('window-original'));assert.ok(!JSON.stringify(activity.tools).includes('一张小笺'));
  const notes=await readDreamNotes(db,cid);assert.equal(notes[0].body,'一张小笺');
  assert.equal(await replyDreamNote(db,other.id,out.claimId,'wrong','wrong',due+1),false);
  assert.equal(await replyDreamNote(db,cid,out.claimId,'reply','回笺',due+1),true);
  assert.equal(await replyDreamNote(db,cid,out.claimId,'reply','回笺',due+1),false);
  assert.equal((await readDreamNotes(db,cid))[0].replies[0].body,'回笺');assert.equal(n,3);
  const later=await executeDreamTide(env,cid,{...opts,now:due+3600000,clock:()=>due+3600000,invoke:async(env,payload)=>{assert.ok(JSON.stringify(payload.messages).includes('回笺'));return response();}});
  assert.equal(later.status,'completed');assert.equal((await readDreamActivity(db,cid)).length,2);
});
test('uncertain usage or revoked authorization never runs requested tools or retries',async()=>{
  const {env,db,cid,rev,opts}=await fixture();let n=0;
  const out=await executeDreamTide(env,cid,{...opts,invoke:async()=>{n++;return response([toolCall('n','dream_write_note',{body:'not saved'})],null);}});
  assert.equal(out.status,'failed');assert.equal(out.total_tokens,null);assert.equal(n,1);assert.equal((await readDreamNotes(db,cid)).length,0);
  const tomorrow=due+86400000;
  const cancelled=await executeDreamTide(env,cid,{...opts,now:tomorrow,clock:()=>tomorrow,invoke:async()=>{await disarmDreamTide(db,cid,rev);return response([toolCall('n2','dream_write_note',{body:'revoked'})]);}});
  assert.equal(cancelled.status,'cancelled');assert.equal((await readDreamNotes(db,cid)).length,0);
});
test('since previous selection only includes messages in time interval',async()=>{
  const {db,cid}=await fixture();
  assert.equal((await readDreamHistory(db,cid,{mode:'since_previous',since:null})).reason,'no_previous_wake');
  const range=await readDreamHistory(db,cid,{mode:'since_previous',since:armAt,until:due,maxTurns:3,count:1});
  assert.deepEqual(range.turns[0].messages.map(m=>m.content),['answer-original']);
});

test('explicit autonomous modules and ordinary registered reading, independent library creation, no fake turn or leaked receipt',async()=>{
  const {env,db,cid,opts,rev}=await fixture({allowLibrary:true,allowLibraryWrite:true,allowMemory:false,allowCalendar:true,includeCustom:true,includeSteps:true,toolBudget:4,tokenBudget:22000});
  const {writeCustomInstructions}=await import('../functions/memory-store.js');
  const {createLibraryBook,listLibraryNotes,writeLibraryNote}=await import('../functions/tidal-library.js');
  const {claimDreamTide}=await import('../functions/dream-tide-ledger.js');
  await writeCustomInstructions(db,{content:'explicit-custom-fixture'});
  const book=await createLibraryBook(db,{title:'fixture-book',format:'txt',chapters:[{title:'Chapter',body:'original page fixture'}]});
  let n=0;
  const out=await executeDreamTide(env,cid,{...opts,invoke:async(_,payload)=>{
    n++;const wire=JSON.stringify(payload.messages);
    if(n===1){
      assert.ok(wire.includes('explicit-custom-fixture'));assert.ok(wire.includes('未取得设备'));
      const names=payload.tools.map(t=>t.function.name);
      assert.ok(names.includes('library_read')&&names.includes('library_write')&&names.includes('calendar_list'));
      assert.ok(!names.includes('memory_search')&&!names.includes('independent_web_search')&&!names.includes('read_mystic_dogtalk'));
      return response([toolCall('r','library_read',{book_id:book.id,chapter_index:0})]);
    }
    if(n===2){assert.ok(wire.includes('original page fixture'));return response([toolCall('w','library_write',{action:'create',book_id:book.id,kind:'reflection',body:'independent note fixture'})]);}
    return response();
  }});
  assert.equal(out.status,'completed');assert.equal(n,3);
  const notes=await listLibraryNotes(db,{book_id:book.id});
  assert.equal(notes.length,1);assert.equal(notes[0].author,'assistant');assert.equal(notes[0].source_turn_id,null);
  const activity=(await readDreamActivity(db,cid))[0];
  assert.equal(activity.tools[1].receipt.record_id,notes[0].id);
  assert.ok(!JSON.stringify(activity.tools).includes('independent note fixture'));assert.ok(!JSON.stringify(activity.tools).includes('original page fixture'));
  assert.equal((await readConversationState(db,cid)).turns.length,1);
  const claim=await claimDreamTide(db,cid,{now:due+86400000,currentModelId:model,busy:false});
  assert.ok(claim);await disarmDreamTide(db,cid,rev);
  await assert.rejects(()=>writeLibraryNote(db,{book_id:book.id,kind:'reflection',body:'revoked note'},{author:'assistant',conversation_id:cid,autonomous_claim:claim}),/权限已撤回/);
  assert.equal((await listLibraryNotes(db,{book_id:book.id})).length,1);
});
test('disabled modules never attach documents or expose unapproved common tools',async()=>{
  const {env,db,cid,opts}=await fixture({includeCustom:false,allowLibrary:false,allowMemory:false});
  const {writeCustomInstructions}=await import('../functions/memory-store.js');
  await writeCustomInstructions(db,{content:'must-not-inject'});
  const out=await executeDreamTide(env,cid,{...opts,invoke:async(_,payload)=>{
    assert.ok(!JSON.stringify(payload).includes('must-not-inject'));
    assert.ok(!payload.tools.some(t=>['memory_search','library_read','library_write'].includes(t.function.name)));
    return response();
  }});
  assert.equal(out.status,'completed');
});

test('ordinary chat readback remains independent of scheduling and rechecks permission',async()=>{
  const {env,db,cid,other,opts,rev}=await fixture();
  const {resolveToolSelection,executeModelTool}=await import('../functions/tool-registry-core.js');
  const {readDreamChatHistory}=await import('../functions/dream-tide-readback.js');
  let calls=0;
  const out=await executeDreamTide(env,cid,{...opts,invoke:async()=>++calls===1?response([toolCall('n','dream_write_note',{body:'readback-private-fixture'})]):response()});
  assert.equal(out.status,'completed');
  await disarmDreamTide(db,cid,rev);
  const ctx={permission:'owner',surface:'main_chat',conversation_id:cid,dream_readback_enabled:true,env};
  assert.ok(resolveToolSelection(ctx).modelVisibleTools.some(t=>t.function.name==='dream_readback'));
  assert.ok(!resolveToolSelection({...ctx,dream_readback_enabled:false}).modelVisibleTools.some(t=>t.function.name==='dream_readback'));
  await assert.rejects(()=>readDreamChatHistory(db,cid,{kind:'notes'}),/未授权/);
  const history=await readConversationState(db,cid);
  await writeConversationState(db,cid,{...history,context_settings:{...history.context_settings,dream_readback_enabled:true}});
  const data=await executeModelTool(db,toolCall('r','dream_readback',{kind:'notes'}),ctx);
  assert.equal(data.items[0].body,'readback-private-fixture');
  assert.equal(data.reference_only,true);
  await assert.rejects(()=>executeModelTool(db,toolCall('r2','dream_readback',{kind:'notes',conversation_id:other.id}),ctx));
  await assert.rejects(()=>executeModelTool(db,toolCall('r3','dream_readback',{kind:'notes'}),{...ctx,conversation_id:other.id}),/未授权/);
  await writeConversationState(db,cid,{...history,context_settings:{}});
  await assert.rejects(()=>executeModelTool(db,toolCall('r4','dream_readback',{kind:'notes'}),ctx),/未授权/);
  assert.equal(calls,2);
});
