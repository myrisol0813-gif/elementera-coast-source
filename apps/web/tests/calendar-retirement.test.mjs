import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { routeApi } from '../functions/api-router.js';
import { listRegisteredTools, resolveToolSelection } from '../functions/tool-registry.js';
import { D1Database } from './d1-helper.mjs';

const db = new D1Database();
db.database.exec(`
  CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);
  INSERT INTO schema_migrations VALUES ('coast-calendar-v1', 1);
  CREATE TABLE coast_calendar_changes (id TEXT);
  CREATE TABLE coast_calendar_notes (id TEXT);
  CREATE TABLE coast_calendar_events (id TEXT);
  CREATE TABLE coast_calendar_recurring_seeds (id TEXT);
  CREATE TABLE coast_daily_diaries (id TEXT);
`);
const migration = await readFile(new URL('../migrations/20260831_drop_legacy_calendar.sql', import.meta.url), 'utf8');
db.database.exec(migration);
const tables = db.database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name);
for (const table of ['coast_calendar_changes', 'coast_calendar_notes', 'coast_calendar_events', 'coast_calendar_recurring_seeds']) {
  assert.equal(tables.includes(table), false, `${table} must be dropped`);
}
assert.ok(tables.includes('schema_migrations'), 'schema_migrations must survive');
assert.ok(tables.includes('coast_daily_diaries'), 'Daily tables must survive');
assert.equal(db.database.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE id = 'coast-calendar-v1'").get().count, 0);

const api = await routeApi(new Request('https://coast.test/api/calendar/events'), { COAST_CHAT_DB: db }, { exp: 1 });
assert.equal(api.status, 404);
assert.equal((await api.json()).error.type, 'not_found');

const registered = listRegisteredTools({ permission: 'owner', surface: 'main_chat' });
assert.equal(registered.some((tool) => tool.tool_key.startsWith('calendar.')), false);
const selected = resolveToolSelection({ permission: 'owner', surface: 'main_chat' });
assert.equal(selected.modelVisibleTools.some((tool) => tool.function.name.startsWith('calendar_')), false);
assert.equal(selected.backendTools.some((tool) => tool.tool_key.startsWith('calendar.')), false);
assert.equal(Object.hasOwn(selected, 'modelTools'), false, 'old modelTools alias must not regrow');
assert.equal(Object.hasOwn(selected, 'tools'), false, 'old tools alias must not regrow');
console.log('calendar-retirement: ok');
