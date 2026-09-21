import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { Window } from 'happy-dom';
import { createLetters } from '../elementera-mcp/deploy-pages/public/features/letters.js';

const window = new Window({ url: 'https://coast.test/' });
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: window.localStorage });

const state = {
  letters: {
    'conversation-1::openai/gpt-5.6': {
      islandText: '保留下来的登岛信。',
      state: 'lovebook',
      coreText: '退休核心',
      loveText: '退休全文',
      ownerPen: '退休添笔',
      modelPen: '退休模型添笔',
      promotedAt: 123,
    },
  },
};
const storage = {
  read: () => state,
  update(mutator) { mutator(state); return state; },
};
const routes = new Map();
const router = {
  register(name, renderer) { routes.set(name, renderer); },
  open() {}, close() {}, refresh() {},
};
const chat = {
  getCurrentConversationId: () => 'conversation-1',
  getProfile: () => ({ current_chat_model: 'openai/gpt-5.6' }),
  sendLandingLetter() { throw new Error('not called in retirement contract'); },
};
const models = { modelName: () => 'GPT-5.6' };
localStorage.setItem('coast_lovebook_v119::conversation-1::GPT-5.6::loveText', '退休旧键');

createLetters({ storage, chat, models, router, toast() {} });
assert.deepEqual(state.letters['conversation-1::openai/gpt-5.6'], { islandText: '保留下来的登岛信。' });
assert.equal(localStorage.getItem('coast_lovebook_v119::conversation-1::GPT-5.6::loveText'), null);
assert.deepEqual([...routes.keys()], ['island-letter']);

const lettersSource = await readFile(new URL('../elementera-mcp/deploy-pages/public/features/letters.js', import.meta.url), 'utf8');
const indexSource = await readFile(new URL('../elementera-mcp/deploy-pages/index.html', import.meta.url), 'utf8');
const workerSource = await readFile(new URL('../elementera-mcp/deploy-pages/service-worker.js', import.meta.url), 'utf8');
for (const retired of [
  'lovebookView', 'penView', 'promote', 'save-love', 'copy-love-core', 'copy-love-full',
  'save-pen', 'merge-pen', 'back-island', 'lovebook-pen', "'lovebook'",
]) assert.equal(lettersSource.includes(retired), false, `retired lovebook behavior remains: ${retired}`);
for (const retiredUi of ['予爱机书', '转为予爱机书', '屋主添笔', '模型添笔', '退回登岛信']) {
  assert.equal(indexSource.includes(retiredUi), false, `retired lovebook UI remains: ${retiredUi}`);
}
assert.match(lettersSource, /defaultIslandLetter/);
assert.match(lettersSource, /chat\.sendLandingLetter/);
assert.match(indexSource, /aria-label="登岛信"/);
assert.match(workerSource, /\/public\/content\/island-letter\.js/);
assert.equal(workerSource.includes('/public/content/letters.js'), false);

const retiredContent = new URL('../elementera-mcp/deploy-pages/public/content/letters.js', import.meta.url);
const islandContent = new URL('../elementera-mcp/deploy-pages/public/content/island-letter.js', import.meta.url);
await assert.rejects(() => access(retiredContent, constants.F_OK));
await access(islandContent, constants.F_OK);

console.log('letters-retirement: ok');
