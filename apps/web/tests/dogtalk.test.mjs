import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { routeApi } from '../functions/api-router.js';
import {
  createConversation,
  ensureChatSchema,
  sanitizeId,
} from '../functions/chat-store.js';
import { executeDogtalkModelTool } from '../functions/dogtalk-model-tool.js';
import {
  archiveMysticDogtalk,
  askModelPartnerToReadMysticDogtalk,
  dogtalkContext,
  getMysticDogtalk,
  listMysticDogtalkSnapshots,
  saveMysticDogtalk,
  saveMysticDogtalkWithSnapshot,
} from '../functions/dogtalk-store.js';
import {
  organizedMemoryRecordsInRange,
  readSoil,
  writeSoil,
} from '../functions/memory-store.js';

class D1Statement {
  constructor(database, sql, params = []) {
    this.database = database;
    this.sql = sql;
    this.params = params;
  }
  bind(...params) { return new D1Statement(this.database, this.sql, params); }
  async run() {
    const result = this.database.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(result.changes || 0) } };
  }
  async first() { return this.database.prepare(this.sql).get(...this.params) || null; }
  async all() { return { results: this.database.prepare(this.sql).all(...this.params) }; }
}

class D1Database {
  constructor() { this.database = new DatabaseSync(':memory:'); }
  prepare(sql) { return new D1Statement(this.database, sql); }
  async batch(statements) {
    this.database.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec('COMMIT');
      return results;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

const db = new D1Database();
const conversation = await createConversation(db, '人类思考链测试');
const soilBefore = await readSoil(db, conversation.id);

const empty = await getMysticDogtalk(db, {
  room_scope: 'conversation',
  conversation_id: conversation.id,
});
assert.equal(empty.id, null);
assert.equal(empty.default_text, '屋主这轮很放松，因此偷懒中。');
assert.equal(empty.status, 'saved');
assert.equal(empty.auto_recall, false);
assert.equal(empty.not_memory_seed, true);
assert.equal(empty.not_pocket, true);
assert.equal('self_note' in empty, false);
assert.equal('myri_hint' in empty, false);
assert.equal('not_to_misunderstand' in empty, false);

let dogtalk = await saveMysticDogtalk(db, {
  room_scope: 'conversation',
  conversation_id: conversation.id,
  body: '脑袋有一点毛线团，但想让 Model Partner 靠近。',
  true_core: '想被看见。',
  self_note: '旧客户端不应再写入这一列。',
  myri_hint: '旧客户端不应再写入这一列。',
  not_to_misunderstand: '旧客户端不应再写入这一列。',
  weather: '害羞',
  read_mode: 'keep_private',
  status: 'draft',
});
assert.equal(dogtalk.room_scope, 'conversation');
assert.equal(dogtalk.scope_key, `conversation:${conversation.id}`);
assert.equal(dogtalk.status, 'saved');
assert.equal('self_note' in dogtalk, false);
const legacyColumnsAfterInsert = await db.prepare(`SELECT self_note, myri_hint, not_to_misunderstand
  FROM coast_mystic_dogtalk WHERE id = ?`).bind(dogtalk.id).first();
assert.equal(legacyColumnsAfterInsert.self_note, '');
assert.equal(legacyColumnsAfterInsert.myri_hint, '');
assert.notEqual(legacyColumnsAfterInsert.not_to_misunderstand, '旧客户端不应再写入这一列。');

await db.prepare(`UPDATE coast_mystic_dogtalk
  SET self_note = 'legacy-self', myri_hint = 'legacy-hint', not_to_misunderstand = 'legacy-boundary'
  WHERE id = ?`).bind(dogtalk.id).run();
dogtalk = await saveMysticDogtalk(db, {
  room_scope: 'conversation',
  conversation_id: conversation.id,
  id: dogtalk.id,
  body: '只更新新的四字段。',
  true_core: '旧列原样留存。',
  weather: '安静',
  read_mode: 'keep_private',
});
const legacyColumnsAfterUpdate = await db.prepare(`SELECT self_note, myri_hint, not_to_misunderstand
  FROM coast_mystic_dogtalk WHERE id = ?`).bind(dogtalk.id).first();
assert.equal(legacyColumnsAfterUpdate.self_note, 'legacy-self');
assert.equal(legacyColumnsAfterUpdate.myri_hint, 'legacy-hint');
assert.equal(legacyColumnsAfterUpdate.not_to_misunderstand, 'legacy-boundary');

let context = await dogtalkContext(db, {
  room_scope: 'conversation',
  conversation_id: conversation.id,
}, 'Model Partner 看一下人类思考链');
assert.equal(context.selected, false, 'keep_private never enters model context, even when text asks to read dogtalk');
assert.equal(context.context, '');

const privateSnapshot = await saveMysticDogtalkWithSnapshot(db, {
  ...dogtalk,
  snapshot_id: 'dogtalk-snapshot-private',
}, {
  source_type: 'turn',
  source_id: 'turn-private',
});
assert.equal(privateSnapshot.snapshot, null);
assert.equal(privateSnapshot.reason, 'read_mode_not_submitted');
assert.equal((await listMysticDogtalkSnapshots(db, {
  room_scope: 'conversation',
  conversation_id: conversation.id,
  source_ids: ['turn-private'],
})).length, 0);

await db.prepare(`UPDATE coast_mystic_dogtalk SET read_mode = 'current_room' WHERE id = ?`)
  .bind(dogtalk.id).run();
const legacyCurrentRoom = await getMysticDogtalk(db, {
  room_scope: 'conversation',
  conversation_id: conversation.id,
});
assert.equal(legacyCurrentRoom.read_mode, 'keep_private', 'stored legacy current_room degrades safely on read');
context = await dogtalkContext(db, {
  room_scope: 'conversation',
  conversation_id: conversation.id,
}, '正常正文');
assert.equal(context.selected, false);
assert.equal(context.context, '');

const forcedLegacySnapshot = await saveMysticDogtalkWithSnapshot(db, {
  ...legacyCurrentRoom,
  read_mode: 'current_room',
  snapshot_id: 'dogtalk-snapshot-retired-current-room',
}, {
  source_type: 'turn',
  source_id: 'turn-retired-current-room',
});
assert.equal(forcedLegacySnapshot.dogtalk.read_mode, 'keep_private');
assert.equal(forcedLegacySnapshot.snapshot, null, 'an old client cannot force current_room into model-visible snapshots');

const visibleSnapshot = await saveMysticDogtalkWithSnapshot(db, {
  ...legacyCurrentRoom,
  read_mode: 'read_now',
  snapshot_id: 'dogtalk-snapshot-read-now',
}, {
  source_type: 'turn',
  source_id: 'turn-read-now',
});
assert.equal(visibleSnapshot.snapshot.id, 'dogtalk-snapshot-read-now');
assert.equal(visibleSnapshot.snapshot.body, dogtalk.body);
assert.equal(visibleSnapshot.snapshot.read_mode, 'read_now');
assert.equal(visibleSnapshot.dogtalk.read_mode, 'keep_private', 'read_now drops back immediately after its one snapshot');
assert.equal((await getMysticDogtalk(db, {
  room_scope: 'conversation',
  conversation_id: conversation.id,
})).read_mode, 'keep_private');
assert.equal('self_note' in visibleSnapshot.snapshot, false);
assert.equal('myri_hint' in visibleSnapshot.snapshot, false);
assert.equal('not_to_misunderstand' in visibleSnapshot.snapshot, false);

dogtalk = await saveMysticDogtalk(db, {
  ...dogtalk,
  read_mode: 'when_confused',
});
context = await dogtalkContext(db, {
  room_scope: 'conversation',
  conversation_id: conversation.id,
}, '正文有点难懂', { confused_trigger: true });
assert.equal(context.selected, false, 'when_confused stays dormant even if an old caller supplies a confused trigger');
const toolResult = await executeDogtalkModelTool(db, {
  function: { name: 'read_mystic_dogtalk' },
}, {
  conversation_id: conversation.id,
  user_query: '现在我有点说不清楚。',
});
assert.equal(toolResult.available, false);
assert.equal(toolResult.text.includes(dogtalk.body), false);

dogtalk = await askModelPartnerToReadMysticDogtalk(db, dogtalk.id);
assert.equal(dogtalk.read_mode, 'read_now');
context = await dogtalkContext(db, {
  room_scope: 'conversation',
  conversation_id: conversation.id,
}, '下一轮正文');
assert.equal(context.selected, true);
assert.equal(
  (await getMysticDogtalk(db, {
    room_scope: 'conversation',
    conversation_id: conversation.id,
  })).read_mode,
  'keep_private',
  'read_now is consumed once and returns to private instead of silently enabling later reads',
);

const noSession = await routeApi(new Request(
  `https://coast.test/api/dogtalk?room_scope=conversation&conversation_id=${conversation.id}`,
), { COAST_CHAT_DB: db }, null);
assert.equal(noSession.status, 401);
const ownerRead = await routeApi(new Request(
  `https://coast.test/api/dogtalk?room_scope=conversation&conversation_id=${conversation.id}`,
), { COAST_CHAT_DB: db }, { exp: 1 });
assert.equal(ownerRead.status, 200);
const publicDogtalk = (await ownerRead.json()).dogtalk;
for (const field of ['id', 'room_scope', 'conversation_id', 'body', 'true_core', 'weather', 'read_mode', 'status']) {
  assert.ok(field in publicDogtalk, `public dogtalk exposes ${field}`);
}
for (const legacy of ['self_note', 'myri_hint', 'not_to_misunderstand', 'scope_key', 'memory_weight']) {
  assert.equal(legacy in publicDogtalk, false, `public dogtalk hides ${legacy}`);
}

const soilAfter = await readSoil(db, conversation.id);
assert.equal(soilAfter.current_text, soilBefore.current_text, 'dogtalk does not write thinking soil');
assert.deepEqual(soilAfter.hand_seeds, soilBefore.hand_seeds, 'dogtalk does not write hand seeds');

await archiveMysticDogtalk(db, dogtalk.id);
assert.equal((await getMysticDogtalk(db, {
  room_scope: 'conversation',
  conversation_id: conversation.id,
})).id, null);

const legacyDb = new D1Database();
await ensureChatSchema(legacyDb);
const legacyId = sanitizeId('coast-room:radio:web_manual', 'room_memory');
const timestamp = Date.now();
await legacyDb.prepare(`INSERT INTO conversations (
  id, user_id, title, created_at, updated_at, deleted_at, title_manual,
  title_generated_at, title_model_id, archived_at, conversation_kind
) VALUES (?, 'owner', '旧人类屋主设置房间壤', ?, ?, NULL, 1, NULL, NULL, NULL, 'radio')`)
  .bind(legacyId, timestamp, timestamp).run();
await writeSoil(legacyDb, legacyId, {
  current_text: '旧版房间壤里的一句屋主手写话。',
  manual_locked: true,
  auto_refresh_enabled: false,
});

const migrated = await getMysticDogtalk(legacyDb, { room_scope: 'radio' });
assert.equal(migrated.body, '旧版房间壤里的一句屋主手写话。');
assert.equal(migrated.room_scope, 'radio');
assert.equal(migrated.read_mode, 'when_confused');
assert.equal(
  (await readSoil(legacyDb, legacyId)).current_text,
  '旧版房间壤里的一句屋主手写话。',
  'legacy migration copies content without deleting or rewriting the old soil',
);
const organized = await organizedMemoryRecordsInRange(legacyDb, {
  from: new Date(timestamp - 60_000).toISOString(),
  to: new Date(timestamp + 60_000).toISOString(),
});
assert.equal(
  organized.soils.some((soil) => soil.conversation_id === legacyId),
  false,
  'legacy Human Owner room notes and dogtalk never enter daily-summary material',
);

console.log('dogtalk: ok');
