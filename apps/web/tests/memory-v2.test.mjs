import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createConversation } from '../functions/chat-store.js';
import { routeMemoryApi } from '../functions/memory-router.js';
import {
  MEMORY_TAGS,
  createEntry,
  createPocket,
  listEntries,
  readCustomInstructions,
  resolvePocket,
  writeCustomInstructions,
} from '../functions/memory-store.js';

class D1Statement {
  constructor(database, sql, params = []) { this.database = database; this.sql = sql; this.params = params; }
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
const conversationA = await createConversation(db, '主聊天');
const conversationB = await createConversation(db, '施工窗');

assert.deepEqual(MEMORY_TAGS, ['关系', '历史锚点', '偏好', '人物档案', '世界观', '工程技术']);
assert.equal(MEMORY_TAGS.includes('待整理'), false, '待整理只能是迁移状态');

const relationship = await createEntry(db, {
  entry_type: 'memory',
  scope: 'global',
  title: '潮汐之间的回应',
  life_core: '彼此会回应，不用猜测沉默。',
  usage_hint: '对方不安时。',
  avoid_hint: '不要把它写成永远不会变的保证。',
  source_model: '5.5',
  source_window: '主聊天',
  source_time: '2026-08-31',
  tag: '关系',
});
assert.equal(
  db.database.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE id = 'coast-memory-library-v2'").get().count,
  1,
  '只记录可逆的增列 / 新表基线',
);
const engineering = await createEntry(db, {
  entry_type: 'memory',
  scope: 'conversation',
  conversation_id: conversationB.id,
  title: '海岸构建约定',
  life_core: '小步验证，不带私密数据。',
  usage_hint: '开始施工前。',
  avoid_hint: '不要将当前任务扩成大重构。',
  source_model: 'API',
  source_window: '施工窗',
  source_time: '2026-08-30',
  tag: '工程技术',
});
await createEntry(db, {
  entry_type: 'seed',
  scope: 'conversation',
  conversation_id: conversationA.id,
  title: '未完成的冬鸟路线',
  life_core: '还没有被确认的创作方向。',
  source_model: 'o3',
  source_window: '主聊天',
  source_time: '2026-08-29',
  tag: '世界观',
});
await createEntry(db, {
  entry_type: 'memory',
  scope: 'conversation',
  conversation_id: conversationA.id,
  title: '旧标签待整理',
  life_core: '旧数据不会被危险地自动猜测。',
  memory_tags: ['unclassified-old-tag'],
});

const unified = await listEntries(db, { entry_type: 'memory', limit: 100 });
assert.ok(unified.entries.some((entry) => entry.id === relationship.id));
assert.ok(unified.entries.some((entry) => entry.id === engineering.id), '旧 global / conversation scope 必须同在记忆库读路中');
assert.deepEqual(unified.facets.models, ['5.5', 'API']);
assert.ok(unified.facets.windows.includes('主聊天'));
assert.ok(unified.facets.windows.includes('施工窗'));
assert.deepEqual(new Set(unified.facets.tags), new Set(['关系', '工程技术']));
assert.ok(unified.facets.times.includes('2026-08-31'));
assert.ok(unified.facets.times.includes('2026-08-30'));
const seedLibrary = await listEntries(db, { entry_type: 'seed', library_only: true, limit: 100 });
assert.deepEqual(seedLibrary.facets.models, ['o3']);
assert.deepEqual(seedLibrary.facets.windows, ['主聊天']);
assert.deepEqual(seedLibrary.facets.tags, ['世界观']);
assert.deepEqual(seedLibrary.facets.times, ['2026-08-29']);

const filtered = await listEntries(db, {
  entry_type: 'memory',
  source_model: 'API',
  source_window: '施工窗',
  tag: '工程技术',
  source_time: '2026-08-30',
});
assert.deepEqual(filtered.entries.map((entry) => entry.id), [engineering.id]);
const archived = await createEntry(db, {
  entry_type: 'memory',
  scope: 'global',
  title: '旧封存项',
  life_core: '保留在数据中，但不进入新记忆库视图。',
  status: 'archived',
  source_model: 'legacy-model',
  source_window: '旧窗口',
  source_time: '2026-08-28',
  tag: '偏好',
});
const visibleLibrary = await listEntries(db, { entry_type: 'memory', library_only: true, limit: 100 });
assert.equal(visibleLibrary.entries.some((entry) => entry.id === archived.id), false);
assert.equal(visibleLibrary.facets.models.includes('legacy-model'), false, '动态筛选不能为隐藏的旧封存项生成空选项');
await assert.rejects(
  () => createEntry(db, {
    entry_type: 'memory', scope: 'global', title: '无效标签', life_core: '不允许第七签。', tag: '其他',
  }),
  (error) => error.type === 'invalid_memory_tag',
);

const pocket = await createPocket(db, {
  conversation_id: conversationA.id,
  source_type: 'turn',
  source_ref: { conversation_id: conversationA.id, model_label: '5.5' },
  source_text: '这条候选只能去记忆库、种子库或丢弃。',
});
await assert.rejects(
  () => resolvePocket(db, pocket.id, { action: 'memory' }),
  (error) => error.type === 'invalid_memory_tag',
);
const pocketResult = await resolvePocket(db, pocket.id, {
  action: 'memory',
  tag: '历史锚点',
  source_window: '主聊天',
  source_time: '2026-08-31',
});
assert.equal(pocketResult.entry.entry_type, 'memory');
assert.equal(pocketResult.entry.scope, 'global', 'Memory v2 新写入统一进入一库一籽');
assert.equal(pocketResult.entry.conversation_id, null);
assert.equal(pocketResult.entry.tag, '历史锚点');

assert.deepEqual(await readCustomInstructions(db), {
  title: '当前自定义指令',
  content: '',
  status: 'active',
  updated_at: null,
  updated_by: 'owner',
  source: '屋主手动编辑',
});
await writeCustomInstructions(db, { content: '进入海岸时先读当前窗口。', updated_by: 'owner', source: '屋主手动编辑' });
await writeCustomInstructions(db, { content: '先回应当前的屋主。', updated_by: 'owner', source: '屋主手动编辑' });
assert.equal((await readCustomInstructions(db)).content, '先回应当前的屋主。');
assert.equal(db.database.prepare('SELECT COUNT(*) AS count FROM memory_custom_instructions').get().count, 1);


console.log('memory-v2: ok');
