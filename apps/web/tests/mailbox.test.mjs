import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  createMailboxSession,
  verifyMailboxSession,
  verifyPassphraseHash,
} from '../functions/mailbox-auth.js';
import { routeMailboxApi } from '../functions/mailbox-api.js';
import { VISITOR_MODEL_PARTNER_PROMPT_V1 } from '../functions/visitor-model-partner-prompt.js';
import { listCoastMcpTools } from '../functions/mcp-tools.js';
import { routeOwnerMailboxApi } from '../functions/owner-mailbox-api.js';
import { roomAccess } from '../functions/surface-access-rules.js';
import { mailboxMigrationIds, ensureMailboxSchema } from '../functions/mailbox-schema.js';
import {
  deleteVisibleVisitorNotebookEntry,
  editMailboxMessage,
  fetchUnrepliedMailbox,
  loginMailboxVisitor,
  mailboxMessages,
  mailboxOwnerSummary,
  mailboxPatrolReport,
  mailboxVisitorStatus,
  ownerMailboxVisitors,
  registerMailboxVisitor,
  removeMailboxAccount,
  removeMailboxMessage,
  replyToMailboxVisitor,
  resolveMailboxPocket,
  sendMailboxMessage,
  visibleVisitorMemory,
} from '../functions/mailbox-service.js';

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
  constructor() {
    this.database = new DatabaseSync(':memory:');
    this.database.exec('PRAGMA foreign_keys = ON');
  }
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

function requestWithToken(path, token, options = {}) {
  return new Request(`https://coast.test${path}`, {
    ...options,
    headers: {
      Cookie: `__Host-coast_mailbox=${token}`,
      Origin: 'https://coast.test',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
}

function nextSoil(label, candidates = []) {
  return {
    current_text: `${label}的当前承接。`,
    hand_seeds: [{
      name: `${label}当前活跃线索`,
      life_core: `${label}仍想继续谈创作。`,
      usage_hint: '下一封自然接续。',
      avoid_hint: '不要当成固定人格标签。',
    }],
    do_not_repeat: `${label}已经知道这里不是实时聊天。`,
    pocket_candidates: candidates,
  };
}

const visitorAccess = roomAccess('mailbox_visitor', { permission: 'visitor', visitorId: 'visitor-isolation-test' });
assert.equal(visitorAccess.ownerOnly, false);
assert.equal(visitorAccess.visitorBound, true);
assert.equal(visitorAccess.soil, 'mailbox_visitor');
assert.equal(visitorAccess.memory, 'visitor_only');
assert.deepEqual(visitorAccess.worldbook, ['visitor', 'both']);
assert.deepEqual(visitorAccess.backendTools, []);
assert.deepEqual(visitorAccess.modelVisibleTools, []);
assert.equal(visitorAccess.worldbook.includes('owner'), false);

const db = new D1Database();
const env = {
  COAST_CHAT_DB: db,
  COAST_SESSION_SECRET: 'mailbox-test-session-secret-'.repeat(3),
};

await ensureMailboxSchema(db);
for (const table of [
  'mailbox_visitors',
  'mailbox_messages',
  'mailbox_reply_queue',
  'visitor_notebook_entries',
  'mailbox_thinking_notes',
  'mailbox_thought_soils',
  'mailbox_memory_pockets',
  'mailbox_patrol_batches',
]) {
  assert.ok(db.database.prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?').get('table', table));
}
assert.deepEqual(mailboxMigrationIds, [
  'mailbox-friend-chat-v1',
  'mailbox-room-memory-v2',
  'mailbox-test-data-reset-20260920',
]);
for (const migrationId of mailboxMigrationIds) {
  assert.equal(
    db.database.prepare('SELECT id FROM schema_migrations WHERE id = ?').get(migrationId).id,
    migrationId,
  );
}

const legacyDb = new D1Database();
legacyDb.database.exec(`
  CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);
  CREATE TABLE unrelated_main_data (id TEXT PRIMARY KEY, body TEXT NOT NULL);
  INSERT INTO unrelated_main_data VALUES ('keep-me', '主海岸数据不能被信箱清理碰到');
  CREATE TABLE mailbox_visitors (
    id TEXT PRIMARY KEY, display_name TEXT NOT NULL, preferred_name TEXT,
    passphrase_hash TEXT NOT NULL UNIQUE, passphrase_lookup TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_seen_at TEXT,
    is_active INTEGER NOT NULL DEFAULT 1, allow_memory INTEGER NOT NULL DEFAULT 1,
    privacy_level TEXT NOT NULL DEFAULT 'sealed', note_for_owner TEXT
  );
  CREATE TABLE mailbox_messages (
    id TEXT PRIMARY KEY, visitor_id TEXT NOT NULL, role TEXT NOT NULL,
    content TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    status TEXT NOT NULL, reply_batch_id TEXT, is_visible_to_owner INTEGER NOT NULL DEFAULT 0,
    safety_flag TEXT, FOREIGN KEY(visitor_id) REFERENCES mailbox_visitors(id)
  );
  CREATE TABLE visitor_notebook_entries (
    id TEXT PRIMARY KEY, visitor_id TEXT NOT NULL, content TEXT NOT NULL,
    source_message_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 1, visibility TEXT NOT NULL DEFAULT 'model_partner_only',
    archived INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(visitor_id) REFERENCES mailbox_visitors(id),
    FOREIGN KEY(source_message_id) REFERENCES mailbox_messages(id)
  );
  CREATE TABLE mailbox_thinking_notes (
    id TEXT PRIMARY KEY, visitor_id TEXT NOT NULL, content TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, source_message_id TEXT,
    archived INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(visitor_id) REFERENCES mailbox_visitors(id),
    FOREIGN KEY(source_message_id) REFERENCES mailbox_messages(id)
  );
  INSERT INTO mailbox_visitors VALUES (
    'legacy-visitor', '旧访客', NULL, 'legacy-hash', 'legacy-lookup',
    '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', NULL,
    1, 1, 'sealed', NULL
  );
  INSERT INTO mailbox_messages VALUES (
    'legacy-reply', 'legacy-visitor', 'model_partner', '旧回信',
    '2026-08-01T01:00:00.000Z', '2026-08-01T01:00:00.000Z',
    'sent', NULL, 0, NULL
  );
  INSERT INTO mailbox_thinking_notes VALUES (
    'legacy-soil', 'legacy-visitor', '旧版小纸条迁入滚动壤。',
    '2026-08-01T01:00:00.000Z', '2026-08-01T01:00:00.000Z', 'legacy-reply', 0
  );
  INSERT INTO visitor_notebook_entries VALUES (
    'legacy-memory', 'legacy-visitor', '旧版访客记事完整保留。', 'legacy-reply',
    '2026-08-01T01:00:00.000Z', '2026-08-01T01:00:00.000Z', 1,
    'visitor_visible', 0
  );
`);
await ensureMailboxSchema(legacyDb);
for (const table of [
  'mailbox_visitors',
  'mailbox_messages',
  'mailbox_reply_queue',
  'visitor_notebook_entries',
  'mailbox_thinking_notes',
  'mailbox_thought_soils',
  'mailbox_memory_pockets',
  'mailbox_patrol_batches',
]) {
  assert.equal(
    legacyDb.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
    0,
    `${table} should be empty after the one-time mailbox test-data reset`,
  );
}
assert.equal(
  legacyDb.database.prepare('SELECT body FROM unrelated_main_data WHERE id = ?').get('keep-me').body,
  '主海岸数据不能被信箱清理碰到',
);
assert.equal(
  legacyDb.database.prepare('SELECT id FROM schema_migrations WHERE id = ?')
    .get('mailbox-test-data-reset-20260920').id,
  'mailbox-test-data-reset-20260920',
);

const alice = await registerMailboxVisitor(db, env, {
  display_name: '星星',
  preferred_name: '小星',
  passphrase: '潮声-37',
  allow_memory: true,
});
const bob = await registerMailboxVisitor(db, env, {
  display_name: '苔藓',
  passphrase: '石阶-73',
  allow_memory: false,
});
assert.equal(alice.privacy_level, 'sealed');
assert.equal(bob.allow_memory, false);
assert.equal(db.database.prepare('SELECT COUNT(*) AS count FROM mailbox_thought_soils').get().count, 2);
const storedAlice = db.database.prepare('SELECT * FROM mailbox_visitors WHERE id = ?').get(alice.id);
assert.match(storedAlice.passphrase_hash, /^pbkdf2-sha256\$100000\$/);
assert.equal(storedAlice.passphrase_hash.includes('潮声-37'), false);
assert.equal(storedAlice.passphrase_lookup.includes('潮声-37'), false);
assert.equal(await verifyPassphraseHash('潮声-37', storedAlice.passphrase_hash, env), true);
assert.equal(await verifyPassphraseHash('错误暗号', storedAlice.passphrase_hash, env), false);
assert.equal(await verifyPassphraseHash('潮声-37', storedAlice.passphrase_hash, {
  COAST_SESSION_SECRET: 'different-mailbox-test-secret-'.repeat(3),
}), false, 'the server secret must pepper the stored verifier');
assert.equal(await verifyPassphraseHash(
  '潮声-37',
  storedAlice.passphrase_hash.replace('$100000$', '$120000$'),
  env,
), false, 'Workers-incompatible PBKDF2 work factors must be rejected before derivation');
await assert.rejects(
  () => registerMailboxVisitor(db, env, { display_name: '重复来客', passphrase: '潮声-37' }),
  (error) => error.type === 'mailbox_passphrase_exists' && error.status === 409,
);
assert.equal((await loginMailboxVisitor(db, env, ' 潮声-37 ')).id, alice.id);
await assert.rejects(
  () => loginMailboxVisitor(db, env, '错误暗号'),
  (error) => error.type === 'mailbox_passphrase_invalid' && error.status === 401,
);

const mailboxLoginResponse = await routeMailboxApi(new Request(
  'https://coast.test/api/mailbox/login',
  {
    method: 'POST',
    headers: { Origin: 'https://coast.test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ passphrase: '潮声-37' }),
  },
), env);
assert.equal(mailboxLoginResponse.status, 200);
assert.match(mailboxLoginResponse.headers.get('set-cookie'), /^__Host-coast_mailbox=/);
assert.match(mailboxLoginResponse.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Strict/);
const mailboxLoginBody = await mailboxLoginResponse.json();
assert.equal(mailboxLoginBody.visitor_id, alice.id);
assert.equal('passphrase' in mailboxLoginBody, false);
const mailboxCrossOriginRegister = await routeMailboxApi(new Request(
  'https://coast.test/api/mailbox/register',
  {
    method: 'POST',
    headers: { Origin: 'https://elsewhere.test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ display_name: '跨站', passphrase: '不应登记' }),
  },
), env);
assert.equal(mailboxCrossOriginRegister.status, 403);

const aliceToken = await createMailboxSession(alice.id, env);
const bobToken = await createMailboxSession(bob.id, env);
const aliceRequest = requestWithToken('/api/mailbox/messages', aliceToken);
assert.equal((await verifyMailboxSession(aliceRequest, env)).visitor_id, alice.id);
const tampered = `${aliceToken.slice(0, -1)}${aliceToken.endsWith('A') ? 'B' : 'A'}`;
assert.equal(await verifyMailboxSession(requestWithToken('/mailbox', tampered), env), null);

const aliceFirst = await sendMailboxMessage(db, alice.id, '只属于星星的第一封密封来信。');
const aliceSecond = await sendMailboxMessage(db, alice.id, '只属于星星的第二封密封来信。');
const bobFirst = await sendMailboxMessage(db, bob.id, '只属于苔藓的密封来信。');
assert.equal((await mailboxMessages(db, alice.id)).length, 2);
assert.equal((await mailboxMessages(db, alice.id)).some((message) => message.content.includes('苔藓')), false);
assert.equal(
  db.database.prepare('SELECT COUNT(*) AS count FROM mailbox_reply_queue WHERE visitor_id = ?').get(alice.id).count,
  1,
  'one visitor must keep one open queue row instead of one row per message',
);

const editedFirst = await editMailboxMessage(db, alice.id, aliceFirst.id, '星星编辑后的第一封密封来信。');
assert.equal(editedFirst.status, 'waiting_for_model_partner');
assert.equal(editedFirst.content, '星星编辑后的第一封密封来信。');
await assert.rejects(
  () => editMailboxMessage(db, bob.id, aliceFirst.id, '不应跨房编辑。'),
  (error) => error.type === 'mailbox_message_not_editable',
);
await assert.rejects(
  () => removeMailboxMessage(db, bob.id, aliceFirst.id),
  (error) => error.type === 'mailbox_message_not_found',
);

const originalPrepare = db.prepare.bind(db);
const patrolQueries = [];
db.prepare = (sql) => {
  patrolQueries.push(String(sql));
  return originalPrepare(sql);
};
const patrol = await fetchUnrepliedMailbox(db, { message_limit: 60 });
db.prepare = originalPrepare;
assert.equal(patrol.visitor_count, 2);
assert.equal(patrol.message_count, 3);
assert.equal(
  patrolQueries.filter((sql) => /SELECT COUNT\(\*\) AS count FROM mailbox_messages\s+WHERE visitor_id/.test(sql)).length,
  0,
  'patrol pending counts must be collected with the bounded queue query, not one query per visitor',
);
assert.equal(
  patrolQueries.filter((sql) => /AS pending_message_count[\s\S]*LIMIT \?/.test(sql)).length,
  1,
  'patrol queue selection must include pending counts and an internal visitor limit',
);
const alicePatrol = patrol.visitors.find((visitor) => visitor.visitor_id === alice.id);
const bobPatrol = patrol.visitors.find((visitor) => visitor.visitor_id === bob.id);
assert.equal(alicePatrol.pending_message_count, 2);
assert.equal(bobPatrol.pending_message_count, 1);
assert.deepEqual(alicePatrol.recent_messages.map((message) => message.visitor_id), [alice.id, alice.id]);
assert.deepEqual(bobPatrol.recent_messages.map((message) => message.visitor_id), [bob.id]);
assert.deepEqual(bobPatrol.visitor_notebook_entries, []);
assert.deepEqual(bobPatrol.pending_memory_pockets, []);
assert.equal(alicePatrol.thought_soil.visitor_id, alice.id);

const aliceReply = await replyToMailboxVisitor(db, {
  batch_id: patrol.batch_id,
  queue_id: alicePatrol.queue_id,
  visitor_id: alice.id,
  content: '这是只写回星星房间的 模型伙伴回信。',
  thought_soil: nextSoil('星星', [
    {
      title: '星星意象',
      life_core: '喜欢在创作里使用星星意象。',
      content: '小星在这轮谈到了自己反复使用的星星意象。',
      usage_hint: '讨论创作时可以自然记得。',
      source_excerpt: '创作中的星光',
    },
    {
      title: '轻量称呼',
      life_core: '更喜欢被叫作小星。',
      content: '登记称呼与聊天称呼一致。',
    },
  ]),
  model_label: 'GPT-5.6 Thinking',
  model_nickname: '雾灯',
  source_conversation_id: 'official-conversation-a',
  source_turn_id: 'official-turn-a',
  tool_call_id: 'mailbox-reply-a-1',
});
assert.equal(aliceReply.pending_pocket_count, 2);
assert.equal(aliceReply.pending_pockets.length, 2);
assert.deepEqual(
  aliceReply.pending_pockets.map((pocket) => pocket.visitor_id),
  [alice.id, alice.id],
);
assert.equal(aliceReply.thought_soil.current_text, '星星的当前承接。');
assert.equal(aliceReply.thought_soil.hand_seeds.length, 1);
assert.equal(aliceReply.thought_soil.model_label, 'GPT-5.6 Thinking');
assert.equal(aliceReply.memory_candidates_skipped, 0);

const bobReply = await replyToMailboxVisitor(db, {
  batch_id: patrol.batch_id,
  queue_id: bobPatrol.queue_id,
  visitor_id: bob.id,
  content: '这是只写回苔藓房间的 模型伙伴回信。',
  thought_soil: nextSoil('苔藓', [{
    title: '不应落袋',
    life_core: '访客没有允许长期记忆。',
    content: '这条只能留在滚动整理当前对话的纸条展示层。',
  }]),
  model_label: 'GPT-5.6 Thinking',
  tool_call_id: 'mailbox-reply-b-1',
});
assert.equal(bobReply.pending_pocket_count, 0);
assert.deepEqual(bobReply.pending_pockets, []);
assert.equal(bobReply.memory_candidates_skipped, 1);
assert.equal(bobReply.thought_soil.current_text, '苔藓的当前承接。');

const aliceMemoryBeforeResolve = await visibleVisitorMemory(db, alice.id);
assert.equal(aliceMemoryBeforeResolve.entries.length, 0, 'soil candidates must not bypass the pending bag');
assert.equal(aliceMemoryBeforeResolve.pending_pockets.length, 2);
const starPocket = aliceMemoryBeforeResolve.pending_pockets.find((pocket) => pocket.title === '星星意象');
const namePocket = aliceMemoryBeforeResolve.pending_pockets.find((pocket) => pocket.title === '轻量称呼');
await assert.rejects(
  () => resolveMailboxPocket(db, {
    visitor_id: bob.id,
    pocket_id: starPocket.id,
    action: 'discard',
  }),
  (error) => error.type === 'mailbox_pocket_not_found',
  '待确认区不得跨访客处理',
);
const crossPocketResolve = await routeMailboxApi(requestWithToken(
  `/api/mailbox/memory/pockets/${encodeURIComponent(starPocket.id)}/resolve`,
  bobToken,
  { method: 'POST', body: JSON.stringify({ action: 'remember' }) },
), env);
assert.ok([404, 409].includes(crossPocketResolve.status), '访客 REST 不得处理其他访客的候选');
const rememberPocketResponse = await routeMailboxApi(requestWithToken(
  `/api/mailbox/memory/pockets/${encodeURIComponent(starPocket.id)}/resolve`,
  aliceToken,
  { method: 'POST', body: JSON.stringify({ action: 'remember' }) },
), env);
assert.equal(rememberPocketResponse.status, 200);
const rememberedStar = await rememberPocketResponse.json();
assert.equal(rememberedStar.entry.title, '星星意象');
assert.equal(rememberedStar.entry.visibility, 'visitor_visible');
assert.equal((await resolveMailboxPocket(db, {
  visitor_id: alice.id,
  pocket_id: starPocket.id,
  action: 'remember',
})).idempotent, true);
const discardPocketResponse = await routeMailboxApi(requestWithToken(
  `/api/mailbox/memory/pockets/${encodeURIComponent(namePocket.id)}/resolve`,
  aliceToken,
  { method: 'POST', body: JSON.stringify({ action: 'discard' }) },
), env);
assert.equal(discardPocketResponse.status, 200);
assert.equal((await discardPocketResponse.json()).entry, null);
const aliceMemory = await visibleVisitorMemory(db, alice.id);
assert.equal(aliceMemory.pending_pockets.length, 0);
assert.equal(aliceMemory.entries.length, 1);
assert.equal(aliceMemory.entries[0].title, '星星意象');
assert.equal(JSON.stringify(aliceMemory.entries).includes('轻量称呼'), false);
assert.deepEqual((await visibleVisitorMemory(db, bob.id)).entries, []);

const report = await mailboxPatrolReport(db, { batch_id: patrol.batch_id });
assert.deepEqual({
  visitor_count: report.visitor_count,
  message_count: report.message_count,
  reply_count: report.reply_count,
  failure_count: report.failure_count,
  needs_owner_attention_count: report.needs_owner_attention_count,
}, {
  visitor_count: 2,
  message_count: 3,
  reply_count: 2,
  failure_count: 0,
  needs_owner_attention_count: 0,
});
assert.equal(report.summary.includes('只属于星星'), false);
assert.equal(report.summary.includes('只属于苔藓'), false);
assert.equal((await mailboxVisitorStatus(db, alice.id)).pending_count, 0);

await deleteVisibleVisitorNotebookEntry(db, alice.id, aliceMemory.entries[0].id);
assert.deepEqual((await visibleVisitorMemory(db, alice.id)).entries, []);

const editedAfterReply = await editMailboxMessage(db, alice.id, aliceFirst.id, '第一封在回信后再次编辑。');
assert.equal(editedAfterReply.status, 'waiting_for_model_partner');
assert.equal((await mailboxMessages(db, alice.id)).some((message) => message.role === 'model_partner'), true, 'a shared batch reply remains while another source letter still exists');
const deletedSecond = await removeMailboxMessage(db, alice.id, aliceSecond.id);
assert.ok(deletedSecond.related_reply_id, 'deleting the last source letter for a batch also removes that reply');
assert.equal((await mailboxMessages(db, alice.id)).some((message) => message.role === 'model_partner'), false);
assert.equal((await mailboxVisitorStatus(db, alice.id)).pending_count, 1);

const stalePatrol = await fetchUnrepliedMailbox(db);
const staleAlice = stalePatrol.visitors.find((visitor) => visitor.visitor_id === alice.id);
const concurrentAlice = await sendMailboxMessage(db, alice.id, '巡信取件后抵达的新信。');
await assert.rejects(
  () => replyToMailboxVisitor(db, {
    batch_id: stalePatrol.batch_id,
    queue_id: staleAlice.queue_id,
    visitor_id: alice.id,
    content: '不应覆盖新信的旧上下文回复。',
    thought_soil: nextSoil('过期批次'),
    model_label: 'GPT-5.6 Thinking',
  }),
  (error) => error.type === 'mailbox_patrol_stale' && error.status === 409,
);
await removeMailboxMessage(db, alice.id, concurrentAlice.id);
assert.equal((await mailboxVisitorStatus(db, alice.id)).pending_count, 1);

const visitorApiResponse = await routeMailboxApi(aliceRequest, env);
assert.equal(visitorApiResponse.status, 200);
const visitorApiBody = await visitorApiResponse.json();
assert.ok(visitorApiBody.messages.every((message) => message.visitor_id === alice.id));
assert.equal(JSON.stringify(visitorApiBody).includes('只属于苔藓'), false);
const memoryApiResponse = await routeMailboxApi(requestWithToken('/api/mailbox/memory', aliceToken), env);
assert.equal(memoryApiResponse.status, 200);
assert.equal((await memoryApiResponse.json()).memory.thought_soil.visitor_id, alice.id);

const apiEditResponse = await routeMailboxApi(requestWithToken(
  `/api/mailbox/messages/${encodeURIComponent(aliceFirst.id)}`,
  aliceToken,
  { method: 'PATCH', body: JSON.stringify({ content: '通过 REST 编辑的来信。' }) },
), env);
assert.equal(apiEditResponse.status, 200);
assert.equal((await apiEditResponse.json()).message.content, '通过 REST 编辑的来信。');
const crossVisitorDelete = await routeMailboxApi(requestWithToken(
  `/api/mailbox/messages/${encodeURIComponent(aliceFirst.id)}`,
  bobToken,
  { method: 'DELETE' },
), env);
assert.equal(crossVisitorDelete.status, 404);

const ownerVisitors = await ownerMailboxVisitors(db);
const ownerSummary = await mailboxOwnerSummary(db);
assert.equal(ownerVisitors.length, 2);
assert.equal(ownerSummary.visitor_count, 2);
assert.equal(ownerSummary.pending_visitor_count, 1);
assert.equal(JSON.stringify(ownerVisitors).includes('通过 REST 编辑'), false);
assert.equal(JSON.stringify(ownerVisitors).includes('模型伙伴回信'), false);
assert.equal(JSON.stringify(ownerVisitors).includes('星星意象'), false);
const ownerResponse = await routeOwnerMailboxApi(new Request(
  'https://coast.test/api/owner/mailbox/visitors',
), env, { exp: 1 });
assert.equal(ownerResponse.status, 200);
assert.equal(JSON.stringify(await ownerResponse.json()).includes('content'), false);
const visitorCannotReadOwner = await routeOwnerMailboxApi(requestWithToken(
  '/api/owner/mailbox/summary',
  aliceToken,
), env, null);
assert.equal(visitorCannotReadOwner.status, 401);

assert.equal(
  db.database.prepare('SELECT COUNT(*) AS count FROM mailbox_messages WHERE is_visible_to_owner != 0').get().count,
  0,
);
assert.equal(db.database.prepare('SELECT content FROM mailbox_messages WHERE id = ?').get(aliceFirst.id).content, '通过 REST 编辑的来信。');

const mailboxTools = Object.fromEntries(listCoastMcpTools()
  .filter((tool) => tool.name.startsWith('mcp_mailbox_'))
  .map((tool) => [tool.name, tool]));
assert.deepEqual(Object.keys(mailboxTools), [
  'mcp_mailbox_fetch_unreplied',
  'mcp_mailbox_reply',
  'mcp_mailbox_resolve_pocket',
  'mcp_mailbox_patrol_report',
]);
assert.deepEqual(mailboxTools.mcp_mailbox_fetch_unreplied.securitySchemes[0].scopes, ['read:coast']);
assert.deepEqual(mailboxTools.mcp_mailbox_reply.securitySchemes[0].scopes, ['write:lighthouse']);
assert.deepEqual(mailboxTools.mcp_mailbox_resolve_pocket.securitySchemes[0].scopes, ['write:lighthouse']);
assert.deepEqual(mailboxTools.mcp_mailbox_patrol_report.securitySchemes[0].scopes, ['read:coast']);
assert.ok(mailboxTools.mcp_mailbox_reply.inputSchema.required.includes('thought_soil'));
assert.equal('optional_thinking_notes' in mailboxTools.mcp_mailbox_reply.inputSchema.properties, false);
assert.equal('optional_notebook_entries' in mailboxTools.mcp_mailbox_reply.inputSchema.properties, false);
assert.match(VISITOR_MODEL_PARTNER_PROMPT_V1, /public Elementera Coast visitor mailbox demo/);
assert.match(VISITOR_MODEL_PARTNER_PROMPT_V1, /neutral pending note for later review/);
assert.match(VISITOR_MODEL_PARTNER_PROMPT_V1, /Do not expose private owner data/);
assert.equal(VISITOR_MODEL_PARTNER_PROMPT_V1.includes('主聊天、独立房间、共通聊天室'), false, '后端门锁不重复成为模型说明书');

const deleteBobResponse = await routeMailboxApi(requestWithToken(
  '/api/mailbox/account',
  bobToken,
  { method: 'DELETE' },
), env);
assert.equal(deleteBobResponse.status, 200);
assert.match(deleteBobResponse.headers.get('set-cookie'), /Max-Age=0/);
for (const table of [
  'mailbox_visitors',
  'mailbox_messages',
  'mailbox_reply_queue',
  'visitor_notebook_entries',
  'mailbox_thinking_notes',
  'mailbox_thought_soils',
  'mailbox_memory_pockets',
]) {
  assert.equal(
    db.database.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${table === 'mailbox_visitors' ? 'id' : 'visitor_id'} = ?`).get(bob.id).count,
    0,
    `${table} must not retain the deleted visitor namespace`,
  );
}
await assert.rejects(
  () => loginMailboxVisitor(db, env, '石阶-73'),
  (error) => error.type === 'mailbox_passphrase_invalid',
);
const oldBobSession = await routeMailboxApi(requestWithToken('/api/mailbox/me', bobToken), env);
assert.equal(oldBobSession.status, 401);
assert.equal((await mailboxOwnerSummary(db)).visitor_count, 1);

const directDelete = await removeMailboxAccount(db, alice.id);
assert.equal(directDelete.deleted, true);
assert.equal(db.database.prepare('SELECT COUNT(*) AS count FROM mailbox_visitors').get().count, 0);

console.log('mailbox: ok');
