import { D1Database } from './d1-helper.mjs';
import { createConversation } from '../functions/chat-store.js';
import {
  applyChatAttachmentsToMessages,
  attachmentDeskReceipt,
  deleteChatAttachment,
  getChatAttachmentRecord,
  listChatAttachmentMetadata,
  uploadChatAttachment,
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
