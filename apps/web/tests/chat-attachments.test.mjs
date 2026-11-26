import { attachImageTool } from '../functions/chat-image-tool.js';
import { performFormalChatWithTools } from '../functions/models/model-formal-chat-core.js';
import { D1Database } from './d1-helper.mjs';
import { createConversation, readConversationState, writeConversationState, writeProfile } from '../functions/chat-store.js';
import {
  applyChatAttachmentsToMessages,
  attachmentDeskReceipt,
  attachmentReceiptOnFailure,
  deleteChatAttachment,
  getChatAttachmentRecord,
  listChatAttachmentMetadata,
  uploadChatAttachment,
  saveGeneratedImageOriginal,
  runManualImageGeneration,
} from '../functions/chat-attachments.js';
import assert from 'node:assert/strict';

const original = [
  { role: 'system', content: 'system' },
  { role: 'user', content: '帮我看一下' },
];
const resolved = {
  attachments: [
    { id: 'att-image', type: 'image', name: 'cat.png' },
    { id: 'att-text', type: 'file', name: 'notes.md' },
    { id: 'att-pdf', type: 'file', name: 'book.pdf' },
  ],
  delivered: [
    { id: 'att-image', name: 'cat.png', type: 'image', mode: 'vision' },
    { id: 'att-text', name: 'notes.md', type: 'file', mode: 'text' },
  ],
  not_delivered: [
    { id: 'att-pdf', name: 'book.pdf', reason: 'file_type_unsupported' },
  ],
  vision: { supported: true, images_delivered: 1 },
  text_blocks: ['【文件：notes.md】\nhello coast'],
  image_parts: [{
    type: 'image_url',
    image_url: { url: 'data:image/png;base64,aGVsbG8=' },
  }],
};

const messages = applyChatAttachmentsToMessages(original, resolved);
assert.equal(original[1].content, '帮我看一下', 'attachment delivery does not mutate assembled context');
assert.equal(Array.isArray(messages[1].content), true);
assert.equal(messages[1].content[0].type, 'text');
assert.match(messages[1].content[0].text, /【文件：notes\.md】/);
assert.match(messages[1].content[0].text, /book\.pdf 未递给模型：file_type_unsupported/);
assert.equal(messages[1].content[1].type, 'image_url');

const receipt = attachmentDeskReceipt(resolved);
assert.equal(receipt.uploaded, 3);
assert.equal(receipt.delivered_to_model, 2);
assert.equal(receipt.vision.images_delivered, 1);
assert.equal(receipt.not_delivered[0].reason, 'file_type_unsupported');
const rejected = attachmentReceiptOnFailure(receipt, { type: 'context_window_estimate_exceeded', details: { continuation: false } });
assert.equal(rejected.uploaded, 3);
assert.equal(rejected.delivered_to_model, 0);
assert.equal(rejected.delivered.length, 0);
assert.equal(rejected.not_delivered.length, 3);
assert.equal(rejected.vision.images_delivered, 0);
assert.equal(receipt.delivered_to_model, 2, 'original receipt stays intact');
assert.equal(attachmentReceiptOnFailure(receipt, { type: 'context_window_estimate_exceeded', details: { continuation: true } }), receipt,
  'a stopped continuation does not erase attachments delivered in the first request');

const fileOnly = applyChatAttachmentsToMessages(
  [{ role: 'user', content: '总结' }],
  {
    attachments: [{ id: 'att-text', type: 'file', name: 'notes.md' }],
    delivered: [{ id: 'att-text', name: 'notes.md', type: 'file', mode: 'text' }],
    not_delivered: [],
    vision: { supported: false, images_delivered: 0 },
    text_blocks: ['【文件：notes.md】\nhello'],
    image_parts: [],
  },
);
assert.equal(typeof fileOnly[0].content, 'string');
assert.match(fileOnly[0].content, /hello/);

console.log('chat-attachments: ok');


const db = new D1Database();
const conversation = await createConversation(db, '附件测试', 'main');
const largeBytes = new Uint8Array(3_200_123);
for (let index = 0; index < largeBytes.length; index += 65537) largeBytes[index] = index % 251;
const uploaded = await uploadChatAttachment(db, conversation.id, {
  name: 'large.bin',
  type: 'application/octet-stream',
  size: largeBytes.length,
  async arrayBuffer() { return largeBytes.buffer.slice(0); },
});
assert.equal(uploaded.size, largeBytes.length);
const chunkRows = db.database.prepare('SELECT chunk_index, length(data) AS bytes FROM chat_attachment_chunks WHERE attachment_id = ? ORDER BY chunk_index').all(uploaded.id);
assert.equal(chunkRows.length, 3, 'files larger than a D1 row are stored in bounded chunks');
assert.ok(chunkRows.every((row) => row.bytes <= 1_500_000));
const restored = await getChatAttachmentRecord(db, conversation.id, uploaded.id);
const restoredBytes = new Uint8Array(restored.data);
assert.equal(restoredBytes.length, largeBytes.length);
for (let index = 0; index < largeBytes.length; index += 65537) assert.equal(restoredBytes[index], largeBytes[index]);
await deleteChatAttachment(db, conversation.id, uploaded.id);
assert.equal(db.database.prepare('SELECT count(*) AS count FROM chat_attachment_chunks WHERE attachment_id = ?').get(uploaded.id).count, 0);
assert.equal(db.database.prepare('SELECT count(*) AS count FROM chat_attachments WHERE id = ?').get(uploaded.id).count, 0);

console.log('chat-attachments-storage: ok');


await assert.rejects(
  () => listChatAttachmentMetadata(db, conversation.id, Array.from({ length: 13 }, (_, index) => `att-${index + 1}`)),
  (error) => error?.type === 'too_many_attachments'
    && error?.status === 400
    && error?.message === '每轮最多 12 个附件。',
);

const generatedTurn='generated-turn-fixture', generatedMessage='generated-assistant-fixture';
await writeConversationState(db,conversation.id,{turns:[{id:generatedTurn,user:{variants:[{id:'generated-user-fixture',content:'draw'}]}}]});
const generatedPng=Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,6,0,0,0]);
const savedImage=await saveGeneratedImageOriginal(db,{conversationId:conversation.id,turnId:generatedTurn,messageId:generatedMessage,generated:{bytes:generatedPng,mime:'image/png',provider:'openrouter',requested_model:'fixture/image:free',reported_model:'fixture/image:free',cost_usd:0,prompt:'draw a wolf'},visionSupported:true});
const savedOriginal=await getChatAttachmentRecord(db,conversation.id,savedImage.attachment.id);
assert.equal(savedOriginal.turn_id,generatedTurn);
assert.deepEqual(new Uint8Array(savedOriginal.data),generatedPng);
assert.equal(savedImage.readback.receipt.status,'prepared');
assert.equal(savedImage.attachment.image_generation.message_id,generatedMessage);
assert.equal(savedImage.attachment.image_generation.cost_usd,0);
await writeConversationState(db,conversation.id,{turns:[{id:generatedTurn,user:{variants:[{id:'generated-user-fixture',content:'draw'}]},assistant:{variantsByUserVariant:{0:[{id:generatedMessage,content:'',attachments:[savedImage.attachment]}]}}}]});
const persistedImage=(await readConversationState(db,conversation.id)).turns[0].assistant.variantsByUserVariant['0'][0].attachments[0];
assert.deepEqual(persistedImage,savedImage.attachment);
await assert.rejects(()=>saveGeneratedImageOriginal(db,{conversationId:conversation.id,turnId:'missing-turn',messageId:generatedMessage,generated:{}}),e=>e.type==='generated_source_invalid');

const jobDb=new D1Database();
const jobChat=await createConversation(jobDb,'图像任务','main');
await writeConversationState(jobDb,jobChat.id,{turns:[{id:'job-turn',user:{variants:[{id:'job-user',content:'draw'}]}}]});
const jobEnv={COAST_CHAT_DB:jobDb,OPENROUTER_API_KEY:'test-key'};
const mockDiscover=async(_,key)=>{assert.equal(key,'test-key');return [{id:'fixture/paid'},{id:'fixture/image:free'}]};
const jobInput={conversation_id:jobChat.id,turn_id:'job-turn',user_variant_id:'job-user',message_id:'job-assistant',prompt:'draw a wolf'};
let jobCalls=0;
const mockGenerate=async(config,input)=>{jobCalls++;assert.equal(config.allowPaid,true);assert.equal(config.model,'fixture/paid');assert.equal(input.prompt,'draw a wolf');const pending=(await readConversationState(jobDb,jobChat.id)).turns[0].assistant.variantsByUserVariant['0'][0];assert.equal(pending.finish_reason,'image_pending');return {bytes:generatedPng,mime:'image/png',provider:'openrouter',requested_model:config.model,reported_model:config.model,cost_usd:0.025,prompt:input.prompt}};
await assert.rejects(()=>runManualImageGeneration(jobEnv,jobInput,{generate:mockGenerate,discover:mockDiscover}),e=>e.type==='image_not_configured');
await writeProfile(jobDb,{current_image_model:'fixture/missing',model_box:{image:['fixture/missing']}});
await assert.rejects(()=>runManualImageGeneration(jobEnv,jobInput,{generate:mockGenerate,discover:mockDiscover}),e=>e.type==='image_model_unavailable');
await writeProfile(jobDb,{current_image_model:'fixture/paid',model_box:{image:['fixture/paid']}});
const jobResult=await runManualImageGeneration(jobEnv,jobInput,{generate:mockGenerate,discover:mockDiscover});
assert.equal(jobResult.history.turns[0].assistant.variantsByUserVariant['0'][0].content,'');
assert.equal(jobResult.history.turns[0].assistant.variantsByUserVariant['0'][0].finish_reason,'stop');
assert.deepEqual(jobResult.history.turns[0].assistant.variantsByUserVariant['0'][0].attachments,[jobResult.attachment]);
assert.deepEqual(new Uint8Array((await getChatAttachmentRecord(jobDb,jobChat.id,jobResult.attachment.id)).data),generatedPng);
assert.equal(jobResult.readback.status,'vision_unknown');
assert.equal(jobResult.attachment.image_generation.cost_usd,0.025);
await assert.rejects(()=>runManualImageGeneration(jobEnv,jobInput,{generate:mockGenerate,discover:mockDiscover}),e=>e.type==='image_already_reserved');
assert.equal(jobCalls,1);
await assert.rejects(()=>runManualImageGeneration(jobEnv,{...jobInput,message_id:'job-failed'},{discover:mockDiscover,generate:async()=>{throw Error('private upstream error')}}),e=>e.type==='image_generation_failed');
assert.equal((await readConversationState(jobDb,jobChat.id)).turns[0].assistant.variantsByUserVariant['0'][1].finish_reason,'image_failed');
assert.equal(jobDb.database.prepare('SELECT count(*) AS n FROM chat_attachments').get().n,1);

const toolChat=await createConversation(jobDb,'自主绘图','main');
const toolHistory={turns:[{id:'tool-turn',user:{variants:[{id:'tool-user',content:'draw'}]},assistant:{variantsByUserVariant:{0:[{id:'tool-assistant',content:'',finish_reason:'image_tool_ready'}]}}}]};
await writeConversationState(jobDb,toolChat.id,toolHistory);
const toolArgs={conversationId:toolChat.id,turnId:'tool-turn',messageId:'tool-assistant',roomType:'main',chatModel:'openai/gpt-fixture',enabled:true};
const fakeBase={tools:[{type:'function',function:{name:'fixture_tool',parameters:{type:'object',properties:{}}}}],executeTool:async()=>({ok:true})};
const visionCatalog={groups:{openai_chat:[{id:'openai/gpt-fixture',architecture:{input_modalities:['text','image']}}]}};
let imageCalls=0;
const deps={catalog:async()=>visionCatalog,discover:mockDiscover,generate:async(c,p)=>{imageCalls++;return {bytes:generatedPng,mime:'image/png',provider:'openrouter',requested_model:c.model,prompt:p.prompt,cost_usd:0.025}}};
const tool=await attachImageTool(jobEnv,fakeBase,toolArgs,deps);
assert.equal(tool.tools.at(-1).function.name,'image_generate');
const denied=await attachImageTool(jobEnv,fakeBase,{...toolArgs,enabled:false},deps);
assert.equal(denied,fakeBase);
const originalFetch=globalThis.fetch;
let requests=[];
try{
  globalThis.fetch=async(url,options={})=>{
    if(String(url).includes('/models?'))return new Response(JSON.stringify({data:[{id:'openai/gpt-fixture',name:'GPT fixture',architecture:{input_modalities:['text','image'],output_modalities:['text']},supported_parameters:['tools','tool_choice']}]}));
    const p=JSON.parse(options.body);requests.push(p);
    if(requests.length===1)return new Response(JSON.stringify({model:'openai/gpt-fixture',choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id:'img-call',type:'function',function:{name:'image_generate',arguments:JSON.stringify({prompt:'a wolf'})}}]}}]}));
    assert.equal(p.messages.at(-2).role,'tool');
    assert.doesNotMatch(p.messages.at(-2).content,/base64|data:image/);
    assert.equal(p.messages.at(-1).role,'user');
    assert.equal(p.messages.at(-1).content[1].image_url.url,'data:image/png;base64,'+btoa(String.fromCharCode(...generatedPng)));
    return new Response(JSON.stringify({model:'openai/gpt-fixture',choices:[{finish_reason:'stop',message:{role:'assistant',content:''}}]}));
  };
  const result=await performFormalChatWithTools(jobEnv,{model:'openai/gpt-fixture',messages:[{role:'user',content:'draw'}],tools:tool.tools},{executeTool:tool.executeTool,takePrivateContinuation:tool.takePrivateContinuation,hasGeneratedImage:tool.hasGeneratedImage});
  assert.equal(result.message.content,'');
  assert.equal(result.tool_results[0].result.status,'saved');
  assert.doesNotMatch(JSON.stringify(result),/data:image|base64/);
  assert.equal(requests.length,2);
}finally{globalThis.fetch=originalFetch;}
assert.equal(imageCalls,1);
assert.equal((await tool.executeTool({function:{name:'image_generate',arguments:'{"prompt":"again"}'}})).ok,false);
assert.equal(tool.takePrivateContinuation().length,0);
const afterImage=(await readConversationState(jobDb,toolChat.id)).turns[0].assistant.variantsByUserVariant['0'][0];
assert.equal(afterImage.finish_reason,'image_saved');
assert.equal(afterImage.attachments.length,1);
const oldClient=structuredClone(toolHistory);
oldClient.turns[0].assistant.variantsByUserVariant[0][0].finish_reason='stop';
oldClient.turns[0].assistant.variantsByUserVariant[0][0].content='Here is your picture.';
const merged=await writeConversationState(jobDb,toolChat.id,oldClient);
assert.deepEqual(merged.turns[0].assistant.variantsByUserVariant['0'][0].attachments,afterImage.attachments);
assert.equal(merged.turns[0].assistant.variantsByUserVariant['0'][0].content,'Here is your picture.');
