import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const pages = resolve('elementera-mcp/deploy-pages');
const read = (path) => readFile(resolve(path), 'utf8');

const app = await read(resolve(pages, 'public/app.js'));
const spine = await read(resolve(pages, 'public/core/event-spine.js'));
const router = await read(resolve(pages, 'public/core/router.js'));
const serviceWorker = await read(resolve(pages, 'service-worker.js'));
const mailbox = await read(resolve(pages, 'public/mailbox.js'));
const danger = await read(resolve(pages, 'public/core/danger.js'));
const chat = await read(resolve(pages, 'public/features/chat.js'));
const chatModuleDir = resolve(pages, 'public/features/chat');
const chatModuleFiles = (await readdir(chatModuleDir)).filter((file) => file.endsWith('.js')).sort();
const chatModules = await Promise.all(chatModuleFiles.map((file) => read(resolve(chatModuleDir, file))));
const chatOwnerSource = [chat, ...chatModules].join('\n');
const dogtalk = await read(resolve(pages, 'public/features/dogtalk.js'));
const settings = await read(resolve(pages, 'public/features/settings.js'));

const ACTION_WRAPPER_ALLOWLIST = Object.freeze({
  settings: Object.freeze({
    reason: 'Storage-backed action/input settings panels have no private mutable runtime, route lifecycle, overlay ownership, subscriptions, or cleanup.',
  }),
});

assert.equal(/\.start\s*\(/.test(app), false, 'app cannot call feature.start()');
assert.equal(/async function start\s*\(/.test(app), false, 'app boot must not reuse lifecycle start naming');
assert.match(app, /async function boot\s*\(/);
assert.equal(app.includes('afterHandle'), false);
assert.equal(app.includes('useLegacyStart'), false);

const wrapperIds = [...app.matchAll(/createActionEventOwner\(\{\s*id:\s*'([^']+)'/g)].map((match) => match[1]);
assert.deepEqual(wrapperIds, Object.keys(ACTION_WRAPPER_ALLOWLIST), 'runtime action wrappers must match the reviewed allowlist exactly');
assert.ok(ACTION_WRAPPER_ALLOWLIST.settings.reason.length > 40, 'allowlisted wrapper must document why it remains thin');
for (const pattern of [
  /\bconst\s+(?:state|runtime)\s*=/,
  /\blet\s+\w+\s*=/,
  /new\s+(?:Map|Set)\s*\(/,
  /function\s+(?:mount|refresh|destroy|ownsRoute|observeEvent)\s*\(/,
  /refreshOnNavigation\s*:/,
]) assert.equal(pattern.test(settings), false, `Settings wrapper grew state/lifecycle: ${pattern}`);

assert.match(spine, /action_event_owner_requires_stateless_controller/);
for (const forbiddenFeature of ['shell', 'chat', 'models', 'rooms', 'desk', 'daily', 'memory', 'dogtalk', 'tools', 'toolroom', 'letters']) {
  assert.equal(new RegExp(`['\"]${forbiddenFeature}['\"]`).test(spine), false, `Event Spine knows feature name: ${forbiddenFeature}`);
  assert.equal(new RegExp(`\\b${forbiddenFeature}\\b`, 'i').test(router), false, `Router knows feature name: ${forbiddenFeature}`);
}

const directOwners = {
  shell: 'shell.js', chat: 'chat.js', models: 'models.js', desk: 'desk.js',
  daily: 'daily.js', memory: 'memory.js', dogtalk: 'dogtalk.js',
  tools: 'tools.js', toolroom: 'toolroom.js', letters: 'letters.js',
};
for (const [id, file] of Object.entries(directOwners)) {
  const source = await read(resolve(pages, `public/features/${file}`));
  assert.match(source, new RegExp(`id:\\s*'${id}'`), `${id} must be a direct native owner`);
  for (const contract of ['ownsEvent', 'handleEvent', 'mount', 'refresh', 'destroy']) {
    assert.match(source, new RegExp(`\\b${contract}\\b`), `${id} misses ${contract}`);
  }
}

for (const name of ['chat', 'models', 'daily']) {
  const retired = resolve(pages, `public/features/${name}-${'lifecycle'}.js`);
  await assert.rejects(() => readFile(retired, 'utf8'), (error) => error?.code === 'ENOENT');
  assert.equal(serviceWorker.includes(`${name}-${'lifecycle'}.js`), false);
}
const retiredRooms = resolve(pages, 'public/features/rooms.js');
await assert.rejects(() => readFile(retiredRooms, 'utf8'), (error) => error?.code === 'ENOENT');
assert.equal(serviceWorker.includes('/public/features/rooms.js'), false);
assert.equal(app.includes('createRooms'), false);
assert.match(chatOwnerSource, /name === 'open-type'/, 'typed room entry belongs to Chat owner module cluster');

const forbiddenOwnerGlue = (source, label) => {
  assert.equal(source.includes('document.addEventListener'), false, `${label} added document global listener`);
  assert.equal(source.includes('window.addEventListener'), false, `${label} added window global listener`);
  assert.equal(source.includes('MutationObserver'), false, `${label} added MutationObserver DOM glue`);
  assert.equal(source.includes('setInterval'), false, `${label} added interval DOM glue`);
  assert.equal(/TODO\((?:event-spine|lifecycle|chat-owner)\)/.test(source), false, `${label} keeps owner-era TODO debt`);
};

const featureDir = resolve(pages, 'public/features');
for (const file of await readdir(featureDir)) {
  if (!file.endsWith('.js')) continue;
  forbiddenOwnerGlue(await read(resolve(featureDir, file)), file);
}
for (let index = 0; index < chatModuleFiles.length; index += 1) {
  forbiddenOwnerGlue(chatModules[index], `chat/${chatModuleFiles[index]}`);
}
assert.equal(/TODO\((?:event-spine|lifecycle|chat-owner)\)/.test(danger), false);
assert.match(danger, /windowRef\.addEventListener\('popstate', onPopState\)/);
assert.match(danger, /windowRef\?\.removeEventListener\?\.\('popstate', onPopState\)/);

assert.equal(mailbox.includes('document.addEventListener'), false, 'standalone Mailbox delegation must stay local');
assert.match(mailbox, /q\('#mailboxApp'\)\?\.addEventListener\('click'/);
assert.match(mailbox, /async function bootMailbox\s*\(/);
assert.equal(/async function start\s*\(/.test(mailbox), false);

assert.match(dogtalk, /async function mountComposer\s*\(/);
assert.equal(/async function mount\(container, targetValue\)/.test(dogtalk), false, 'Dogtalk domain mount cannot collide with owner lifecycle mount');

assert.match(serviceWorker, /const CACHE_NAME = 'elementera-coast-source-app-[0-9]+';/);
console.log('owner-closure: ok');
