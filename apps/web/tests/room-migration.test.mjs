import assert from 'node:assert/strict';
import {
  ensureChatSchema,
  listConversations,
  readConversationState,
} from '../functions/chat-store.js';
import { legacyRoomMigrationId } from '../functions/room-conversation-migration.js';
import { D1Database } from './d1-helper.mjs';

const db = new D1Database();
db.database.exec(`
  CREATE TABLE coast_radio_messages (
    id TEXT PRIMARY KEY,
    actor TEXT,
    surface TEXT,
    text TEXT,
    display_author TEXT,
    model_label TEXT,
    withdrawn_at INTEGER,
    created_at INTEGER
  );
  CREATE TABLE coast_lighthouse_letters (
    id TEXT PRIMARY KEY,
    actor TEXT,
    surface TEXT,
    subject TEXT,
    body TEXT,
    display_author TEXT,
    model_label TEXT,
    created_at INTEGER
  );
`);

const radioInsert = db.database.prepare(`INSERT INTO coast_radio_messages
  (id, actor, surface, text, display_author, model_label, withdrawn_at, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
radioInsert.run('legacy-radio-owner', 'owner', 'web_manual', '屋主在旧共通聊天室留下第一句话。', '屋主', null, null, 1000);
radioInsert.run('legacy-radio-api-1', 'model_partner', 'coast_api', '旧 API 模型伙伴回了第一句。', 'API 模型伙伴 ✦', 'openai/gpt-4.1-nano', null, 2000);
radioInsert.run('legacy-radio-official', 'model_partner', 'official_mcp', '官端 ChatGPT 从旧共通聊天室入口发来一句。', 'ChatGPT-5.6 Thinking 回潮≋', 'GPT-5.6 Thinking', null, 3000);
radioInsert.run('legacy-radio-api-2', 'api', 'coast_api', '旧 API 模型伙伴也回应了官端这一句。', 'API 模型伙伴 ✦', 'openai/gpt-4.1-nano', null, 4000);

const lighthouseInsert = db.database.prepare(`INSERT INTO coast_lighthouse_letters
  (id, actor, surface, subject, body, display_author, model_label, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
lighthouseInsert.run('legacy-light-owner', 'owner', 'web_manual', '旧 MCP 对话区的屋主来信', '这是原来的 MCP 对话区正文。', '屋主', null, 1500);
lighthouseInsert.run('legacy-light-official', 'model_partner', 'official_mcp', '旧 MCP 对话区的官端来信', '官端这封信也必须原样搬走。', 'ChatGPT-5.6 Thinking 回潮≋', 'GPT-5.6 Thinking', 2500);

await ensureChatSchema(db);

const conversations = await listConversations(db);
const radio = conversations.find((item) => item.room_type === 'radio');
const lighthouse = conversations.find((item) => item.room_type === 'lighthouse');
assert.ok(radio, 'legacy radio rows must create one typed radio conversation');
assert.ok(lighthouse, 'legacy lighthouse rows must create one typed lighthouse conversation');
assert.equal(radio.title, '共通聊天室｜旧房迁移');
assert.equal(lighthouse.title, 'MCP 对话区｜旧房迁移');

const radioState = await readConversationState(db, radio.id);
assert.equal(radioState.turns.length, 2, 'two legacy user-side radio messages should become two turns');
const firstRadioUser = radioState.turns[0].user.variants[0];
const firstRadioAssistant = radioState.turns[0].assistant.variantsByUserVariant['0'][0];
assert.equal(firstRadioUser.content, '屋主在旧共通聊天室留下第一句话。');
assert.equal(firstRadioUser.message_source, 'owner_web');
assert.equal(firstRadioAssistant.content, '旧 API 模型伙伴回了第一句。');
assert.equal(firstRadioAssistant.generation_source, 'radio');

const officialRadioUser = radioState.turns[1].user.variants[0];
const officialRadioAssistant = radioState.turns[1].assistant.variantsByUserVariant['0'][0];
assert.equal(officialRadioUser.content, '官端 ChatGPT 从旧共通聊天室入口发来一句。');
assert.equal(officialRadioUser.message_source, 'official_mcp', 'legacy official MCP radio must remain user-like, not become an assistant branch');
assert.equal(officialRadioUser.display_author, 'ChatGPT-5.6 Thinking 回潮≋');
assert.equal(officialRadioUser.source_model_label, 'GPT-5.6 Thinking');
assert.equal(officialRadioAssistant.content, '旧 API 模型伙伴也回应了官端这一句。');

const lighthouseState = await readConversationState(db, lighthouse.id);
assert.equal(lighthouseState.turns.length, 2);
assert.match(lighthouseState.turns[0].user.variants[0].content, /旧 MCP 对话区的屋主来信[\s\S]*这是原来的 MCP 对话区正文/);
assert.equal(lighthouseState.turns[0].user.variants[0].message_source, 'owner_web');
assert.match(lighthouseState.turns[1].user.variants[0].content, /旧 MCP 对话区的官端来信[\s\S]*官端这封信也必须原样搬走/);
assert.equal(lighthouseState.turns[1].user.variants[0].message_source, 'official_mcp');
assert.equal(lighthouseState.turns[1].user.variants[0].display_author, 'ChatGPT-5.6 Thinking 回潮≋');
assert.deepEqual(lighthouseState.turns[1].assistant.variantsByUserVariant['0'], [], 'lighthouse migration must not invent an assistant reply');

for (const oldTable of ['coast_radio_messages', 'coast_lighthouse_letters']) {
  assert.equal(
    db.database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(oldTable),
    undefined,
    `${oldTable} should be dropped only after successful migration`,
  );
}
assert.equal(
  db.database.prepare('SELECT id FROM schema_migrations WHERE id = ?').get(legacyRoomMigrationId).id,
  legacyRoomMigrationId,
);

await ensureChatSchema(db);
const afterSecondEnsure = await listConversations(db);
assert.equal(afterSecondEnsure.filter((item) => item.room_type === 'radio').length, 1);
assert.equal(afterSecondEnsure.filter((item) => item.room_type === 'lighthouse').length, 1);

console.log('room-migration: ok');
