import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Window } from 'happy-dom';
import {
  decoratePocketProvenance,
  decorateSoilProvenance,
  readGenerationProvenance,
  saveGenerationProvenance,
} from '../functions/provenance-store.js';
import { createMemory } from '../elementera-mcp/deploy-pages/public/features/memory.js';
import { createConversation, getConversation, setGeneratedTitle } from '../functions/chat-store.js';

class D1Statement {
  constructor(database, sql, params = []) { this.database = database; this.sql = sql; this.params = params; }
  bind(...params) { return new D1Statement(this.database, this.sql, params); }
  async run() { const result = this.database.prepare(this.sql).run(...this.params); return { success: true, meta: { changes: Number(result.changes || 0) } }; }
  async first() { return this.database.prepare(this.sql).get(...this.params) || null; }
  async all() { return { results: this.database.prepare(this.sql).all(...this.params) }; }
}
class D1Database {
  constructor() { this.database = new DatabaseSync(':memory:'); }
  prepare(sql) { return new D1Statement(this.database, sql); }
}

const db = new D1Database();
await saveGenerationProvenance(db, 'soil', 'conv-1', {
  model_id: 'openai/gpt-5.5',
  usage: { prompt_tokens: 1000, completion_tokens: 286, total_tokens: 1286 },
  generation_source: 'soil',
  generated_at: 1784070000000,
});
const soilTrace = await readGenerationProvenance(db, 'soil', 'conv-1');
assert.equal(soilTrace.model_id, 'openai/gpt-5.5');
assert.equal(soilTrace.usage.total_tokens, 1286);
const decoratedSoil = await decorateSoilProvenance(db, { conversation_id: 'conv-1', current_text: '潮线' });
assert.equal(decoratedSoil.organized_by_model, 'openai/gpt-5.5');
assert.deepEqual(decoratedSoil.organize_usage, { prompt_tokens: 1000, completion_tokens: 286, total_tokens: 1286 });
assert.match(decoratedSoil.organized_at, /^2026-/);

await saveGenerationProvenance(db, 'pocket', 'pocket-1', {
  model_id: 'openai/gpt-5.5',
  usage: { prompt_tokens: 1000, completion_tokens: 286, total_tokens: 1286 },
  generation_source: 'soil',
});
const decoratedPocket = await decoratePocketProvenance(db, { id: 'pocket-1', source_type: 'soil' });
assert.equal(decoratedPocket.generated_by_model, 'openai/gpt-5.5');
assert.equal(decoratedPocket.generation_source, 'soil');
assert.equal(decoratedPocket.generation_usage.total_tokens, 1286);

await saveGenerationProvenance(db, 'pocket', 'pocket-incomplete', {
  model_id: 'openai/gpt-5.5',
  usage: { total_tokens: 999 },
  generation_source: 'soil',
});
assert.equal((await readGenerationProvenance(db, 'pocket', 'pocket-incomplete')).usage, null, 'incomplete usage must never become displayed token metadata');

const titleDb = new D1Database();
const titledConversation = await createConversation(titleDb, '新聊天');
await setGeneratedTitle(titleDb, titledConversation.id, '潮线', 'openai/gpt-4.1-nano');
assert.equal((await getConversation(titleDb, titledConversation.id)).title_model_id, 'openai/gpt-4.1-nano', 'generated title model provenance must persist');

const window = new Window({ url: 'http://coast.test/' });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLFormElement', 'Event']) {
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: window[name] || window });
}
globalThis.confirm = () => true;
globalThis.prompt = (_message, fallback = '') => fallback;

const routes = new Map();
let currentView = null;
const router = {
  register(name, render) { routes.set(name, render); },
  async open(name, args) { currentView = routes.get(name)(args); return currentView; },
  async refresh() { return currentView; },
  async back() { return currentView; },
};
const chat = {
  getCurrentConversationId: () => 'conv-1',
  renderMessages: () => undefined,
  getPocketSource: () => null,
};
const storage = { read: () => ({ runControl: { maxHandSeeds: 7, autoRefreshEveryTurns: 1 } }) };
const requestJson = async (input) => {
  const url = new URL(String(input), 'http://coast.test/');
  if (url.pathname === '/api/memory/soil') return { ok: true, soil: {
    conversation_id: 'conv-1', current_text: '潮线', hand_seeds: [], do_not_repeat: '', pocket_candidates: [],
    manual_locked: false, auto_refresh_enabled: true, revision: 2,
    organized_by_model: 'openai/gpt-5.5',
    organize_usage: { prompt_tokens: 1000, completion_tokens: 286, total_tokens: 1286 },
    organized_at: new Date().toISOString(),
  } };
  if (url.pathname === '/api/memory/pockets') return { ok: true, pockets: [{
    id: 'pocket-1', conversation_id: 'conv-1', status: 'pending', title: '潮汐岔路', life_core: '以后还能再生', content: '先放下',
    generated_by_model: 'openai/gpt-5.5', generation_source: 'soil',
    generation_usage: { prompt_tokens: 1000, completion_tokens: 286, total_tokens: 1286 },
  }] };
  if (url.pathname === '/api/memory/vector-status') return { ok: true, index_ready: false, ai_binding: true };
  if (url.pathname === '/api/memory/entries') return { ok: true, entries: [] };
  throw new Error(`unexpected request: ${url.pathname}`);
};
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, options = {}) => {
  try {
    const value = await requestJson(input, options);
    return new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: { type: 'test', message: error.message } }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};
const memory = createMemory({ chat, router, toast: () => undefined, storage });
await memory.onConversationChanged('conv-1');
await memory.handleAction('soil-open', { dataset: { scope: 'conversation', conversationId: 'conv-1' } });
assert.ok(currentView.body.includes('revision 2 · 整理来源 · GPT-5.5 · 1,286 tok'));
await memory.openPockets();
assert.ok(currentView.body.includes('提炼 · GPT-5.5'));
globalThis.fetch = originalFetch;

console.log('provenance: ok');
