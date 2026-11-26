import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { appendAssistantVariant, appendTurn, createState, updateAssistantVariant } from '../elementera-mcp/deploy-pages/public/features/chat-state.js';
import { createChatRender } from '../elementera-mcp/deploy-pages/public/features/chat/chat-render.js';

const window = new Window({ url: 'http://coast.test/' });
window.document.body.innerHTML = '<div id="messageScroller"><div id="messages"></div></div>';
Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: window });
Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: window.document });
globalThis.requestAnimationFrame = (callback) => { callback(Date.now()); return 1; };
window.requestAnimationFrame = globalThis.requestAnimationFrame;

const user = appendTurn(createState(), '测试流式');
const appended = appendAssistantVariant(user.state, user.turn.id, { content: '正在连接当前模型……' });
const runtime = {
  currentId: 'conv-local',
  histories: new Map([['conv-local', appended.state]]),
  conversations: [],
  rikkahubAttachments: new Map(),
  generation: { conversationId: 'conv-local', turnId: user.turn.id, userIndex: appended.userIndex, assistantIndex: appended.assistantIndex },
  profile: { assistant_avatar_dataurl: '' },
  memory: null,
};
const ui = {
  messages: window.document.querySelector('#messages'),
  scroller: window.document.querySelector('#messageScroller'),
};
const renderer = createChatRender({ runtime, ui, closeMenu: () => undefined, roomTypeLabels: { main: '主聊天' } });
renderer.renderMessages('conv-local');
const articleBefore = ui.messages.querySelector('.message.assistant');
const actionsBefore = articleBefore.querySelector('.message-actions');

const partial = updateAssistantVariant(
  appended.state,
  user.turn.id,
  appended.userIndex,
  appended.assistantIndex,
  { content: '海岸', errorDetail: '', model_id: 'openai/gpt-5.5', generation_source: 'chat' },
);
runtime.histories.set('conv-local', partial);
assert.equal(renderer.patchAssistantStreamingText('conv-local', user.turn.id, '海岸', { loading: true }), true);
const articleAfter = ui.messages.querySelector('.message.assistant');
assert.strictEqual(articleAfter, articleBefore, 'delta patch must preserve assistant article');
assert.strictEqual(articleAfter.querySelector('.message-actions'), actionsBefore, 'delta patch must preserve actions');
assert.equal(articleAfter.querySelector('.assistant-text').textContent, '海岸');
assert.ok(articleAfter.querySelector('.typing-cursor'));

renderer.patchAssistantStreamingText('conv-local', user.turn.id, '海岸二', { errorDetail: '暂存错误', loading: true });
assert.equal(articleAfter.querySelector('.assistant-text').textContent, '海岸二暂存错误');
assert.equal(articleAfter.querySelector('.message-error')?.textContent, '暂存错误');

runtime.generation = null;
runtime.histories.set('conv-local', updateAssistantVariant(
  partial,
  user.turn.id,
  appended.userIndex,
  appended.assistantIndex,
  { content: '海岸二', errorDetail: '' },
));
renderer.renderMessages('conv-local');
assert.equal(ui.messages.querySelector('.assistant-text').textContent, '海岸二');
assert.equal(ui.messages.querySelector('.typing-cursor'), null);

const flowSource = await readFile(new URL('../elementera-mcp/deploy-pages/public/features/chat/chat-stream-flow.js', import.meta.url), 'utf8');
const deltaStart = flowSource.indexOf("if (item.event === 'delta')");
const usageStart = flowSource.indexOf("if (item.event === 'usage')");
assert.ok(deltaStart >= 0 && usageStart > deltaStart);
const deltaSource = flowSource.slice(deltaStart, usageStart);
assert.match(deltaSource, /\{ render: false \}/);
assert.match(deltaSource, /patchAssistantStreamingText/);
assert.doesNotMatch(deltaSource, /renderMessages/);

const generationSource = await readFile(new URL('../elementera-mcp/deploy-pages/public/features/chat/chat-generation.js', import.meta.url), 'utf8');
const clearAt = generationSource.indexOf('runtime.generation = null;', generationSource.indexOf('if (runtime.deletedIds.has'));
const finalRenderAt = generationSource.indexOf('renderMessages(conversationId);', clearAt);
assert.ok(clearAt >= 0 && finalRenderAt > clearAt, 'done/error/abort path must keep final full render');
console.log('streaming-local-render: ok');

const {selectedAssistantMessage,toggleAssistantReaction,activeBranch}=await import('../elementera-mcp/deploy-pages/public/features/chat-state.js');
const {createChatActions}=await import('../elementera-mcp/deploy-pages/public/features/chat/chat-actions.js');
const grouped=appendTurn(createState(),'group test');
const gid=grouped.turn.id;
const a=appendAssistantVariant(grouped.state,gid,{id:'group-first',content:'first',model_id:'fixture/first',reply_sequence:{id:'seq',index:0}});
const b=appendAssistantVariant(a.state,gid,{id:'group-second',content:'second',model_id:'fixture/second',reply_sequence:{id:'seq',index:1}});
runtime.histories.set('conv-local',b.state);
runtime.generation={conversationId:'conv-local',turnId:gid,userIndex:b.userIndex,assistantIndex:b.assistantIndex};
let soils=0;
runtime.memory={renderSoilEntry:()=>{soils++;return ''}};
renderer.renderMessages();
const rows=[...ui.messages.querySelectorAll('.message.assistant')];
assert.deepEqual(rows.map(r=>r.dataset.messageId),['group-first','group-second']);
assert.equal(soils,1);
assert.equal(rows[0].querySelector('.typing-cursor'),null);
assert.ok(rows[1].querySelector('.typing-cursor'));
assert.equal(rows[0].querySelector('[data-action="chat:regenerate"]'),null);
assert.ok(rows[1].querySelector('[data-action="chat:regenerate"]'));
renderer.patchAssistantStreamingText('conv-local',gid,'second delta',{messageId:'group-second'});
assert.equal(rows[0].querySelector('.assistant-text').textContent,'first');
assert.equal(rows[1].querySelector('.assistant-text').textContent,'second delta');
runtime.generation=null;
let copied='',notice='';
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:async text=>{copied=text}}}});
const ctl=createChatActions({runtime,ui,toast:text=>{notice=text},currentHistory:()=>runtime.histories.get('conv-local'),setHistory:(id,s)=>runtime.histories.set(id,s),renderMessages:()=>renderer.renderMessages(),saveHistory:async()=>{},generationDetail:v=>v.model_id});
await ctl.handleAction('copy',rows[0].querySelector('[data-action="chat:copy"]'));
assert.equal(copied,'first');
await ctl.handleAction('generation-detail',rows[0].querySelector('[data-action="chat:generation-detail"]'));
assert.equal(notice,'fixture/first');
await ctl.handleAction('like',rows[0].querySelector('[data-action="chat:like"]'));
const selected=activeBranch(runtime.histories.get('conv-local').turns[0]);
assert.equal(selected.assistants[0].liked,true);
assert.equal(selected.assistants[1].liked,false);
assert.equal(selectedAssistantMessage(b.state.turns[0],'not-selected'),null);
assert.deepEqual(toggleAssistantReaction(b.state,gid,'liked','not-selected'),b.state);
