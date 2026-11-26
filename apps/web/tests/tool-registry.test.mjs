import assert from 'node:assert/strict';
import { createConversation } from '../functions/chat-store.js';
import { createEntry } from '../functions/memory-store.js';
import {
  executeModelTool,
  executeRegisteredTool,
  listRegisteredMcpTools,
  listRegisteredTools,
  resolveToolSelection,
} from '../functions/tool-registry.js';
import { listToolRuns, summarizeToolValue } from '../functions/tool-run-log.js';
import { D1Database } from './d1-helper.mjs';

const db = new D1Database();
const conversation = await createConversation(db, 'Registry 私人草稿');
const backendTools = listRegisteredTools({ permission: 'owner', surface: 'main_chat' });
assert.ok(backendTools.some((tool) => tool.tool_key === 'calendar.list'));
assert.ok(backendTools.some((tool) => tool.tool_key === 'voice.create'));
assert.ok(backendTools.some((tool) => tool.tool_key === 'memory.search'));
assert.ok(backendTools.some((tool) => tool.tool_key === 'vault.search'));
assert.ok(backendTools.some((tool) => tool.tool_key === 'vault.read'));
assert.equal(backendTools.find((tool) => tool.tool_key === 'memory.write_candidate').display_name, '放入待确认区');

const selection = resolveToolSelection({ permission: 'owner', surface: 'main_chat' });
assert.ok(selection.modelVisibleTools.some((tool) => tool.function.name === 'calendar_list'));
assert.ok(selection.modelVisibleTools.some((tool) => tool.function.name === 'library_read'));
assert.ok(selection.modelVisibleTools.some((tool) => tool.function.name === 'memory_search'));
assert.ok(selection.modelVisibleTools.some((tool) => tool.function.name === 'vault_search_index'));
assert.ok(selection.modelVisibleTools.some((tool) => tool.function.name === 'vault_read_selected'));

assert.deepEqual(
  selection.modelVisibleToolRecords.map((tool) => tool.model_name),
  selection.modelVisibleTools.map((tool) => tool.function.name),
);
assert.deepEqual(selection.backendTools, backendTools);
assert.equal(Object.hasOwn(selection, 'tools'), false);
assert.equal(Object.hasOwn(selection, 'modelTools'), false);

const mcpTools = listRegisteredMcpTools();
assert.deepEqual(mcpTools.map((tool) => tool.name), [
  'list_radio_messages',
  'list_lighthouse_letters',
  'read_mystic_dogtalk',
  'search_authorized_memory',
  'send_radio_message',
  'write_lighthouse_letter',
  'list_daily_moments',
  'create_daily_moment',
  'list_daily_diaries',
  'create_daily_diary',
  'list_calendar_entries', 'create_calendar_entry', 'update_calendar_entry', 'delete_calendar_entry',
  'create_voice_clip', 'list_library_books', 'read_library_chapter', 'list_library_notes', 'write_library_note',
  'search_coast_treasures', 'read_coast_treasures',
]);
for (const tool of mcpTools) {
  assert.equal(typeof tool.tool_key, 'string');
  assert.equal(typeof tool.description, 'string');
  assert.equal(tool.inputSchema.type, 'object');
}
assert.equal(mcpTools.find((tool) => tool.name === 'create_daily_moment').inputSchema.properties.image_refs, undefined);
assert.equal(mcpTools.find((tool) => tool.name === 'create_daily_diary').inputSchema.properties.image_refs, undefined);

await createEntry(db, {
  conversation_id: conversation.id,
  scope: 'conversation',
  entry_type: 'memory',
  title: '干净工具结果',
  life_core: '模型只应看见这张简洁记忆纸条。',
  content: '数据库里的完整记忆正文不应带着字段名重新进入模型。',
});
const modelMemoryResult = await executeModelTool(db, {
  id: 'memory-call-1',
  function: { name: 'memory_search', arguments: JSON.stringify({ query: '干净工具结果', scope: 'conversation', limit: 5 }) },
}, {
  env: { COAST_CHAT_DB: db }, permission: 'owner', surface: 'main_chat', room_scope: 'conversation', actor: 'model_partner', conversation_id: conversation.id,
});
assert.deepEqual(Object.keys(modelMemoryResult).sort(), ['count', 'memories', 'vector_enabled']);
assert.match(modelMemoryResult.memories[0], /干净工具结果｜模型只应看见这张简洁记忆纸条/);
assert.doesNotMatch(JSON.stringify(modelMemoryResult), /conversation_id|scope|source|priority|freshness|confidence|usage_hint|avoid_hint/);
const memorySearchRun = (await listToolRuns(db)).find((run) => run.tool_key === 'memory.search');
assert.match(JSON.stringify(memorySearchRun.input_summary), /content_redacted/);
assert.doesNotMatch(JSON.stringify(memorySearchRun), /模型只应看见这张简洁记忆纸条|数据库里的完整记忆正文/);

const visitorTools = listRegisteredTools({ permission: 'visitor', surface: 'mailbox_visitor', visitorId: 'visitor-a' });
assert.equal(visitorTools.some((tool) => tool.owner_only), false);
assert.equal(visitorTools.some((tool) => tool.tool_key.startsWith('calendar.')), false);

await executeRegisteredTool(db, 'dogtalk.save', {
  body: '这句私人草稿不能进工具日志。', true_core: '只留此刻温度。', read_mode: 'keep_private',
}, {
  permission: 'owner', surface: 'main_chat', room_scope: 'conversation', actor: 'owner', conversation_id: conversation.id, source_turn_id: 'registry-dogtalk-turn',
});
const dogtalkRun = (await listToolRuns(db)).find((run) => run.tool_key === 'dogtalk.save');
assert.match(JSON.stringify(dogtalkRun.input_summary), /dogtalk_content_redacted/);
assert.doesNotMatch(JSON.stringify(dogtalkRun), /这句私人草稿|只留此刻温度/);

await assert.rejects(() => executeRegisteredTool(db, 'mailbox.reply', { content: '这是不得进入日志的访客正文' }, {
  permission: 'owner', surface: 'official_mcp', room_scope: 'mailbox', actor: 'official_mcp',
}));
const mailboxFailure = (await listToolRuns(db, { status: 'error', tool_key: 'mailbox.reply' }))[0];
assert.doesNotMatch(JSON.stringify(mailboxFailure), /不得进入日志的访客正文/);
const mailboxSummary = summarizeToolValue('mailbox.reply', { content: '绝对不能进日志的访客正文', thought_soil: { current_text: '也不能进日志' }, batch_id: 'batch-1', ok: true });
assert.doesNotMatch(mailboxSummary, /绝对不能|也不能/);
assert.match(mailboxSummary, /mailbox_content_redacted/);

console.log('tool-registry: ok');

// Both portrait documents retain owner confirmation; only enabled candidates are exposed.
const portraitDb = new D1Database();
const portraitContext = { permission: 'owner', surface: 'main_chat', global_excerpt_write_enabled: true, user_portrait_write_enabled: true, cross_window_mode: 'model_decides' };
const portraitTools = resolveToolSelection(portraitContext).modelVisibleTools.map(t => t.function.name);
for (const name of ['global_excerpt_propose','user_portrait_propose','library_books','library_read','library_notes','library_write','voice_create']) assert.ok(portraitTools.includes(name), name);
assert.ok(!resolveToolSelection({...portraitContext,user_portrait_write_enabled:false}).modelVisibleTools.some(t => t.function.name === 'user_portrait_propose'));
const portraitCall = { id: 'portrait-test', function: { name: 'user_portrait_propose', arguments: JSON.stringify({proposed_body:'Synthetic confirmed profile',reason:'Stable observation'}) } };
const { readUserPortrait, listUserPortraitCandidates, confirmUserPortraitCandidate, setUserPortraitWriteEnabled } = await import('../functions/memory-store.js');
const candidate = await executeModelTool(portraitDb, portraitCall, portraitContext);
assert.equal(candidate.status,'pending');
assert.equal((await readUserPortrait(portraitDb)).body,'');
assert.equal((await listUserPortraitCandidates(portraitDb))[0].id,candidate.candidate_id);
await confirmUserPortraitCandidate(portraitDb,candidate.candidate_id,{});
assert.equal((await readUserPortrait(portraitDb)).body,'Synthetic confirmed profile');
await setUserPortraitWriteEnabled(portraitDb,false);
await assert.rejects(() => executeModelTool(portraitDb,portraitCall,portraitContext));
console.log('user portrait candidate lifecycle: ok');

// The model discovers a real book ID before reading or writing anchored notes.
const libraryDb = new D1Database();
const { createLibraryBook } = await import('../functions/tidal-library.js');
const fixtureBook = await createLibraryBook(libraryDb,{title:'Synthetic reader fixture',format:'txt',chapters:[{title:'Chapter 1',body:'First paragraph.'}]});
const libraryContext = {permission:'owner',surface:'main_chat'};
const libraryCall = (name,args) => executeModelTool(libraryDb,{id:'test-'+name,function:{name,arguments:JSON.stringify(args)}},libraryContext);
const shelf = await libraryCall('library_books',{book_id:null});
const actualBookId = shelf.books.find(b=>b.title==='Synthetic reader fixture').id;
assert.equal(actualBookId,fixtureBook.id);
const toc = await libraryCall('library_books',{book_id:actualBookId});
const chapterIndex = toc.book.chapters[0].chapter_index;
const page = await libraryCall('library_read',{book_id:actualBookId,chapter_index:chapterIndex,start_paragraph:null,limit:null});
assert.equal(page.paragraphs[0].text,'First paragraph.');
await assert.rejects(()=>libraryCall('library_read',{book_id:actualBookId,chapter_index:null}));
await libraryCall('library_write',{action:'create',kind:'highlight',book_id:actualBookId,chapter_index:chapterIndex,paragraph_index:0,start_offset:0,end_offset:5});
await libraryCall('library_write',{action:'create',kind:'annotation',book_id:actualBookId,chapter_index:chapterIndex,paragraph_index:0,body:'A note'});
await libraryCall('library_write',{action:'create',kind:'reflection',book_id:actualBookId,body:'A reflection'});
const notes = await libraryCall('library_notes',{book_id:actualBookId,chapter_index:null});
assert.deepEqual(notes.notes.map(n=>n.kind).sort(),['annotation','highlight','reflection']);
assert.equal(notes.notes.find(n=>n.kind==='highlight').quote,'First');
console.log('model library discovery, reading and note roundtrip: ok');
