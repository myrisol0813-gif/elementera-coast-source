import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createConversation } from '../functions/chat-store.js';
import { readSoil, writeSoil, listSoilSnapshots, saveSoilSnapshot, allSoilSnapshots } from '../functions/memory-store.js';
import { routeMemoryApi } from '../functions/memory-router.js';

class Statement {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...params) { return new Statement(this.db, this.sql, params); }
  async run() {
    const result = this.db.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: result.changes || 0 } };
  }
  async first() { return this.db.prepare(this.sql).get(...this.params) || null; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.params) }; }
}
class D1 {
  constructor() { this.database = new DatabaseSync(':memory:'); }
  prepare(sql) { return new Statement(this.database, sql); }
  async batch(statements) {
    this.database.exec('BEGIN');
    try {
      const results = [];
      for (const stmt of statements) results.push(await stmt.run());
      this.database.exec('COMMIT');
      return results;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

const db = new D1();
const conversation = await createConversation(db, '留在原地的思维壤');
const first = { turn_id: 'turn-one', assistant: { id: 'assistant-one', model_id: 'gpt-soil' } };
const second = { turn_id: 'turn-two', assistant: { id: 'assistant-two', model_id: 'gpt-soil' } };

await writeSoil(db, conversation.id, {
  current_text: '第一轮的当前',
  afterthoughts: ['第一轮的余思'],
  organized_through_turn_id: first.turn_id,
}, { automatic: true, snapshotBranch: first });
let result = await listSoilSnapshots(db, conversation.id);
assert.equal(result.snapshots.length, 1);
assert.deepEqual(result.snapshots[0].afterthoughts, ['第一轮的余思']);
assert.equal(result.snapshots[0].assistant_message_id, 'assistant-one');

await writeSoil(db, conversation.id, {
  current_text: '第二轮的当前',
  afterthoughts: ['第二轮的余思'],
  organized_through_turn_id: second.turn_id,
}, { automatic: true, snapshotBranch: second });
result = await listSoilSnapshots(db, conversation.id);
assert.equal(result.snapshots.length, 2);
assert.equal(result.snapshots.find(s => s.assistant_message_id === 'assistant-one').current_text, '第一轮的当前');
assert.equal(result.snapshots.find(s => s.assistant_message_id === 'assistant-two').current_text, '第二轮的当前');

await saveSoilSnapshot(db, conversation.id, first, { current_text: '重复写入应被拒绝覆盖', afterthoughts: [], revision: 55 });
result = await listSoilSnapshots(db, conversation.id);
assert.equal(result.snapshots.length, 2);
assert.equal(result.snapshots.find(s => s.assistant_message_id === 'assistant-one').current_text, '第一轮的当前');

await writeSoil(db, conversation.id, {
  current_text: '我手动改了最新活壤',
  manual_locked: true,
});
assert.equal((await readSoil(db, conversation.id)).current_text, '我手动改了最新活壤');
result = await listSoilSnapshots(db, conversation.id);
assert.equal(result.snapshots.find(s => s.assistant_message_id === 'assistant-two').current_text, '第二轮的当前');

const response = await routeMemoryApi(
  new Request('https://coast.test/api/memory/soil?conversation_id=' + encodeURIComponent(conversation.id)),
  { COAST_CHAT_DB: db }
);
assert.equal(response.status, 200);
const json = await response.json();
assert.equal(json.history.length, 2);
assert.equal(json.history_truncated, false);
assert.equal(json.soil.current_text, '我手动改了最新活壤');
// UI API may be bounded, but a full export must recover every immutable layer.
const insert = db.database.prepare(`INSERT INTO conversation_soil_snapshots (
 conversation_id, turn_id, assistant_message_id, current_text,
 afterthoughts_json, revision, model_label, display_author, created_at
) VALUES (?, ?, ?, ?, '[]', 1, 'test', 'test', ?)`);
for (let i = 0; i < 1001; i += 1) {
  insert.run(conversation.id, 'turn-stress-' + i, 'assistant-stress-' + i, '历史-' + i, i + 1);
}
const bounded = await listSoilSnapshots(db, conversation.id);
assert.equal(bounded.snapshots.length, 1000);
assert.equal(bounded.truncated, true);
assert.ok(bounded.next_offset != null);
const complete = await allSoilSnapshots(db, conversation.id);
assert.equal(complete.length, 1003);
assert.ok(complete.some(item => item.assistant_message_id === 'assistant-one'));
assert.ok(complete.some(item => item.assistant_message_id === 'assistant-stress-0'));
console.log('soil-history: ok');
