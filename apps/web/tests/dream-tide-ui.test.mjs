import test from 'node:test';
import assert from 'node:assert/strict';
import {createDreamTideViews} from '../elementera-mcp/deploy-pages/public/features/dream-tide.js';
test('dream pages stay read-only until an explicit action and escape stored text',async()=>{
  const views=new Map(),calls=[];
  const original=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{
    calls.push([String(url),options?.method||'GET']);
    const items=String(url).includes('/notes')?[{claim_id:'x',model_id:'fixture/model',created_at:0,body:'<img src=x onerror=alert(1)>',replies:[{created_at:0,body:'<script>alert(1)</script>'}]}]:[];
    return new Response(JSON.stringify(String(url).includes('/notes')||String(url).includes('/activity')?{ok:true,items,nextOffset:null}:{ok:true,settings:{enabled:false,revision:null,config:null},executionAvailable:false,schedulerConfigured:false}));
  };
  try{
    createDreamTideViews({router:{register:(id,fn)=>views.set(id,fn)},chat:{getCurrentConversationId:()=>'window',getProfile:()=>({current_chat_model:'fixture/model'})},toast:()=>{}});
    const settings=await views.get('dream-tide')({conversationId:'window'});
    assert.ok(settings.body.includes('保存设置（不启用）'));
    assert.ok(!settings.body.includes('保存并授权唤醒'));
    const notes=await views.get('dream-tide-notes')({conversationId:'window'});
    assert.ok(notes.body.includes('&lt;img'));assert.ok(!notes.body.includes('<img src=x'));
    assert.ok(!notes.body.includes('<script>'));
    assert.ok(notes.body.includes('不立即唤醒模型'));
    const activity=await views.get('dream-tide-activity')({conversationId:'window'});assert.ok(activity.body.includes('还没有活动记录'));
    assert.equal(calls.length,3);assert.ok(calls.every(c=>c[1]==='GET'&&c[0].includes('conversation_id=window')));
  }finally{globalThis.fetch=original;}
});

test('window entry pins the originating window and refuses a stale-window mutation',async()=>{
  let current='a',route=null;const views=new Map(),calls=[],toasts=[];
  const router={register:(id,fn)=>views.set(id,fn),open:async(name,params)=>{route={name,params};},current:()=>route};
  const original=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{calls.push([String(url),options?.method||'GET']);return new Response(JSON.stringify({ok:true,settings:{enabled:false,revision:null,config:null},executionAvailable:false,schedulerConfigured:false}));};
  try{
    const controller=createDreamTideViews({router,chat:{getCurrentConversationId:()=>current,getProfile:()=>({current_chat_model:'fixture/model'})},toast:m=>toasts.push(m)});
    await controller.open('a');assert.equal(route.params.conversationId,'a');
    await views.get('dream-tide')(route.params);
    current='b';await controller.handleAction('save',{});assert.equal(calls.length,1);
    assert.ok(toasts[0].includes('窗口已切换'));
    await controller.handleAction('notes',{});assert.equal(route.name,'dream-tide');
    await controller.open('b');assert.equal(route.params.conversationId,'b');
    await controller.handleAction('notes',{});assert.deepEqual(route,{name:'dream-tide-notes',params:{conversationId:'b'}});
  }finally{globalThis.fetch=original;}
});
