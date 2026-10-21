import assert from 'node:assert/strict';
import { D1Database } from './d1-helper.mjs';
import { routeApi } from '../functions/api-router.js';

const db = new D1Database();
const env = { COAST_CHAT_DB: db };
const session = { v: 2, iat: 1 };
const base = 'https://coast.test';
async function request(path, method = 'GET', data, currentSession = session) {
  const options = { method, headers: { Origin: base } };
  if (data !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(data);
  }
  const response = await routeApi(new Request(base + path, options), env, currentSession);
  return { status: response.status, body: await response.json() };
}
assert.equal((await request('/api/calendar/entries?month=2030-06', 'GET', undefined, null)).status, 401);
const created = await request('/api/calendar/entries', 'POST', {
  day: '2030-06-12', title: 'Synthetic event', body: 'No private fixtures', kind: 'event', recurrence: 'yearly'
});
assert.equal(created.status, 201);
assert.equal(created.body.entry.author, 'owner');
const id = created.body.entry.id;
const next = await request('/api/calendar/entries?month=2031-06');
assert.equal(next.status, 200);
assert.equal(next.body.entries[0].occurrence_day, '2031-06-12');
const invalid = await request('/api/calendar/entries', 'POST', {
  day: '2030-02-30', title: 'Invalid', kind: 'event', recurrence: 'none'
});
assert.equal(invalid.status, 400);
const updated = await request('/api/calendar/entries/' + encodeURIComponent(id), 'PATCH', { title: 'Updated' });
assert.equal(updated.body.entry.title, 'Updated');
const removed = await request('/api/calendar/entries/' + encodeURIComponent(id), 'DELETE');
assert.equal(removed.body.deleted, true);
assert.equal((await request('/api/calendar/entries?month=2031-06')).body.entries.length, 0);
assert.equal((await request('/api/calendar/events')).status, 404);
console.log('calendar-source: ok');
