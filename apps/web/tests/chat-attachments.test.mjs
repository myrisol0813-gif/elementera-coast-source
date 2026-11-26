import { D1Database } from './d1-helper.mjs';
import { createConversation, readConversationState, writeConversationState } from '../functions/chat-store.js';
import {
  applyChatAttachmentsToMessages,
  attachmentDeskReceipt,
  attachmentReceiptOnFailure,
  deleteChatAttachment,
  getChatAttachmentRecord,
  listChatAttachmentMetadata,
  uploadChatAttachment,
  saveGeneratedImageOriginal,
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
