import assert from 'node:assert/strict';
import { createWorldbookEntry, matchWorldbook } from '../functions/worldbook.js';
import { ensureWorldbookSchema, worldbookMigrationIds } from '../functions/worldbook-schema.js';
import { routeWorkbenchApi } from '../functions/workbench-api.js';
import { D1Database } from './d1-helper.mjs';

const db = new D1Database();
await ensureWorldbookSchema(db);
await ensureWorldbookSchema(db);
assert.equal(db.database.prepare('SELECT COUNT(*) AS count FROM coast_worldbook_entries').get().count, 0, 'fresh worldbook starts empty');
assert.equal(db.database.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE id = ?').get(worldbookMigrationIds[0]).count, 1);
assert.deepEqual(await matchWorldbook(db, { input: '整理当前对话的纸条和不存在词条', surface: 'main_chat', allowedScopes: ['owner', 'both'] }), []);

const legacy = new D1Database();
legacy.database.exec(`
  CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);
  CREATE TABLE coast_worldbook_entries (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    keywords_json TEXT NOT NULL DEFAULT '[]',
    use_regex INTEGER NOT NULL DEFAULT 0,
    case_sensitive INTEGER NOT NULL DEFAULT 0,
    constant_active INTEGER NOT NULL DEFAULT 0,
    priority INTEGER NOT NULL DEFAULT 0,
    scan_depth INTEGER NOT NULL DEFAULT 4,
    inject_position TEXT NOT NULL DEFAULT 'before_memory',
    enabled INTEGER NOT NULL DEFAULT 1,
    scope TEXT NOT NULL DEFAULT 'owner',
    visitor_safe INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);
const insertLegacy = legacy.database.prepare(`INSERT INTO coast_worldbook_entries (
  id, title, content, keywords_json, created_at, updated_at
) VALUES (?, ?, ?, '[]', ?, ?)`);
const now = Date.now();
insertLegacy.run('elementera-coast', '旧系统预置', '应被一次性清理。', now, now);
insertLegacy.run('world_manual_keep', '手动保留词条', '未知手动 ID 不能被清理。', now, now);
await ensureWorldbookSchema(legacy);
assert.equal(legacy.database.prepare("SELECT COUNT(*) AS count FROM coast_worldbook_entries WHERE id = 'elementera-coast'").get().count, 0);
assert.equal(legacy.database.prepare("SELECT COUNT(*) AS count FROM coast_worldbook_entries WHERE id = 'world_manual_keep'").get().count, 1);
assert.equal(legacy.database.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE id = ?').get(worldbookMigrationIds[0]).count, 1);

await createWorldbookEntry(db, {
  title: '访客安全灯', content: '只说明信箱正在工作。', keywords: ['安全灯'],
  scope: 'visitor', visitor_safe: true, priority: 200,
});
await createWorldbookEntry(db, {
  title: 'Owner 私密施工', content: '不可给访客。', keywords: ['秘密施工'],
  scope: 'owner', visitor_safe: false, priority: 300,
});
const visitor = await matchWorldbook(db, { input: '安全灯和秘密施工', surface: 'mailbox_visitor', allowedScopes: ['visitor', 'both'] });
assert.ok(visitor.some((entry) => entry.title === '访客安全灯'));
assert.equal(visitor.some((entry) => entry.title === 'Owner 私密施工'), false);
assert.equal(visitor.every((entry) => entry.visitor_safe), true);

const ownerEntry = await createWorldbookEntry(db, {
  title: '手写海岸名词', content: '聊到以后才写进来的词条。', keywords: ['手写海岸名词'],
  scope: 'owner', priority: 80,
});
const ownerMatches = await matchWorldbook(db, { input: '今天提到手写海岸名词', surface: 'main_chat', allowedScopes: ['owner', 'both'] });
assert.equal(ownerMatches.some((entry) => entry.id === ownerEntry.id), true, 'manual worldbook matching remains available');

for (let index = 0; index < 3; index += 1) {
  await createWorldbookEntry(db, {
    title: `常驻核心 ${index + 1}`, content: '仅用于测试常驻上限。',
    keywords: [], constant_active: true, scope: 'owner', priority: 1,
  });
}
await assert.rejects(
  () => createWorldbookEntry(db, {
    title: '过多常驻', content: '不应写入。', keywords: [], constant_active: true,
  }),
  (error) => error.type === 'worldbook_constant_limit',
);

const rejectedMutation = await routeWorkbenchApi(new Request('https://coast.test/api/worldbook', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: '跨站伪造', content: '不应写入。', keywords: ['伪造'] }),
}), { COAST_CHAT_DB: db }, { sub: 'owner' });
assert.equal(rejectedMutation.status, 403, '工作台及词典写入必须通过同源校验');
const acceptedMutation = await routeWorkbenchApi(new Request('https://coast.test/api/worldbook', {
  method: 'POST',
  headers: { Origin: 'https://coast.test', 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: '同源词条', content: '只在同源请求中写入。', keywords: ['同源词条'] }),
}), { COAST_CHAT_DB: db }, { sub: 'owner' });
assert.equal(acceptedMutation.status, 201);

console.log('worldbook: ok');
