import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_CACHE_NAME, APP_CACHE_VERSION, MAILBOX_CACHE_VERSION } from '../scripts/cache-versions.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pages = resolve(root, 'elementera-mcp/deploy-pages');
const exists = async (path) => { try { await access(path, constants.F_OK); return true; } catch { return false; } };
async function files(dir, extensions = new Set(['.js'])) {
  const output = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) output.push(...await files(path, extensions));
    else if (extensions.has(extname(entry.name))) output.push(path);
  }
  return output;
}

const read = (path) => readFile(path, 'utf8');
const index = await read(resolve(pages, 'index.html'));
const scripts = [...index.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((match) => match[1]);
assert.deepEqual(scripts, [`/public/app.js?v=${APP_CACHE_VERSION}`]);
assert.equal(APP_CACHE_VERSION, 'coast-app-87');
assert.equal(MAILBOX_CACHE_VERSION, 'coast-mailbox-05');
for (const duplicate of ['app.html', 'gptlike.html', 'index-next.html']) assert.equal(await exists(resolve(pages, duplicate)), false);

const applicationContract = await read(resolve(root, 'ARCHITECTURE.md'));
assert.match(applicationContract, /canonical runtime is[\s\S]*elementera-mcp\/deploy-pages\/[\s\S]*root `functions\/`/);
assert.match(applicationContract, /backendTools/);
assert.match(applicationContract, /modelVisibleTools/);
assert.match(applicationContract, /Future body images must use attachment\/file objects/);
assert.match(applicationContract, /image_refs_json[\s\S]*inert/);

for (const retiredNodeIslandPath of [
  'elementera-mcp/index.js', 'elementera-mcp/dev-hands.js', 'elementera-mcp/write-hands.js', 'elementera-mcp/start-coast.sh',
  'elementera-mcp/package.json', 'elementera-mcp/package-lock.json', 'elementera-mcp/public', 'elementera-mcp/scripts', 'elementera-mcp/README.md',
]) assert.equal(await exists(resolve(root, retiredNodeIslandPath)), false, `${retiredNodeIslandPath} still exists`);

const retiredModules = [
  'context-ambient.js', 'context-api.js', 'context-assembler.js', 'context-inspector.js', 'context-intent.js', 'context-manifest.js',
  'context-memory-facets.js', 'context-modes.js', 'context-schema.js', 'context-soil-renderer.js', 'context-surfaces.js', 'context-worldbook.js', 'cross-surface-recall.js',
];
for (const file of retiredModules) assert.equal(await exists(resolve(root, 'functions', file)), false, `${file} still exists`);
for (const file of ['public/features/context.js', 'public/styles/context.css', 'public/features/rooms.js']) assert.equal(await exists(resolve(pages, file)), false, `${file} still exists`);

const runtimeFiles = [...await files(resolve(root, 'functions')), ...await files(resolve(pages, 'public'))];
const runtime = (await Promise.all(runtimeFiles.filter((file) => !file.endsWith('worldbook-schema.js')).map((file) => read(file)))).join('\n');
for (const retiredText of [
  '【上下文目录】', 'Context Manifest', 'Context Inspector', 'Memory Facets', 'Ambient Context', 'Surface Profile', 'Mode Cards',
  'current_mode_key', 'memory_facets_enabled', 'context_debug', 'facet_policy_json', 'source_confidence', 'contradiction_note',
  '/api/context/modes', '/api/context/preview', 'fallbackOldContext', 'legacyMode', 'ambientLite', 'modeHintV2', 'tools:clear-context',
]) assert.equal(runtime.includes(retiredText), false, `retired runtime text remains: ${retiredText}`);

const [chat, roomService, dailyComment, mcp, api, registry, registryCore, devRegistry, assembler, accessRules, dailyStore, dailySchema, dailyModelTools, dailyFrontend, dailyClient] = await Promise.all([
  read(resolve(root, 'functions/chat-router.js')),
  read(resolve(root, 'functions/room-conversation-service.js')),
  read(resolve(root, 'functions/daily-moment-comment.js')),
  read(resolve(root, 'functions/mcp-tools.js')),
  read(resolve(root, 'functions/api-router.js')),
  read(resolve(root, 'functions/tool-registry.js')),
  read(resolve(root, 'functions/tool-registry-core.js')),
  read(resolve(root, 'functions/dev-hand-model-tools.js')),
  read(resolve(root, 'functions/context-assemble-clean.js')),
  read(resolve(root, 'functions/surface-access-rules.js')),
  read(resolve(root, 'functions/daily-store.js')),
  read(resolve(root, 'functions/daily-schema.js')),
  read(resolve(root, 'functions/daily-model-tools.js')),
  read(resolve(pages, 'public/features/daily.js')),
  read(resolve(pages, 'public/features/daily-client.js')),
]);
for (const [name, source] of [['chat', chat], ['typed rooms', roomService], ['daily comment', dailyComment], ['MCP', mcp]]) assert.match(source, /assembleCleanContext/, `${name} bypasses clean assembly`);
assert.equal(chat.includes('buildMemoryContext'), false);
assert.equal(chat.includes('resolveToolSelection'), false);
assert.match(api, /routeWorkbenchApi/);
assert.equal(api.includes('routeContextApi'), false);
assert.match(assembler, /trimContextToComfortRange/);
assert.match(assembler, /resolveToolSelection/);
assert.doesNotMatch(assembler, /buildCrossWindowTouch|touchItems|room-memory|today_coast|【今日海岸】/);
assert.match(accessRules, /backendTools/);
assert.match(accessRules, /modelVisibleTools/);
assert.equal(/\bmodelTools\b/.test(accessRules), false);
assert.match(accessRules, /mailbox_visitor/);
assert.match(accessRules, /visitorBound: true/);
assert.match(registry, /tool-registry-core\.js/);
assert.match(registry, /dev-hand-model-tools\.js/);
assert.match(registry, /listRegisteredMcpTools/);
assert.match(registryCore, /roomAllowsTool/);
assert.match(registryCore, /listRegisteredMcpTools/);
assert.match(devRegistry, /resolveDevHandToolSelection/);
assert.match(devRegistry, /permission === 'owner'/);
assert.match(devRegistry, /DEV_HAND_CHAT_SURFACES\.has\(surface\)/);
assert.match(mcp, /listRegisteredMcpTools/);
assert.match(mcp, /const VERSION = '2\.0\.2'/);
assert.doesNotMatch(mcp, /RETIRED_MCP_TOOLS|retiredTool\(|retiredToolResult\(|retired_tool/);
assert.doesNotMatch(mcp, /calendar\.|executeCalendarMcpTool|CALENDAR_MCP_DEFINITIONS/);

for (const source of [dailyStore, dailySchema, dailyModelTools, dailyFrontend, dailyClient, mcp]) assert.equal(source.includes('image_refs'), false, 'image_refs must not remain in current Daily runtime');
for (const source of [dailyStore, dailySchema, dailyFrontend, dailyClient]) assert.equal(source.includes('image_refs_json'), false, 'image_refs_json must not remain in current Daily runtime/schema');
for (const deadUi of ['momentImageRef', 'diaryImageRef', 'stableImageRef', '图片引用']) assert.equal(dailyFrontend.includes(deadUi), false);
for (const profileField of ['owner_avatar_dataurl', 'model_partner_avatar_dataurl', 'moment_cover_dataurl']) assert.ok([dailySchema, dailyFrontend].join('\n').includes(profileField));

for (const forbiddenPattern of [/globalThis\.__[A-Za-z_$]/, /window\.__[A-Za-z_$]/, /setInterval\([^)]*querySelector/s, /document\.write\s*\(/]) assert.equal(forbiddenPattern.test(runtime), false, `forbidden ownership pattern: ${forbiddenPattern}`);

const redirects = await read(resolve(pages, '_redirects'));
const headers = await read(resolve(pages, '_headers'));
assert.match(redirects, /^\/gptlike \/index\.html 200$/m);
assert.match(redirects, /^\/app\.html \/index\.html 200$/m);
const manifest = JSON.parse(await read(resolve(pages, 'manifest.json')));
assert.deepEqual({ id: manifest.id, name: manifest.name, short_name: manifest.short_name, start_url: manifest.start_url, scope: manifest.scope, display: manifest.display, orientation: manifest.orientation }, {
  id: '/', name: 'Elementera Coast', short_name: '前端', start_url: '/?source=pwa', scope: '/', display: 'standalone', orientation: 'portrait',
});
assert.match(headers, /^\/manifest\.json\n[\s\S]*?^  Content-Type: application\/manifest\+json; charset=utf-8$/m);
for (const id of ['coastStatus', 'mainRooms', 'chatConversationSection', 'chatConversationList', 'modelQuickPicker', 'chatWindow', 'mainDogtalkComposer', 'deskStatus']) assert.equal((index.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, `${id} must have one owner`);
assert.equal(index.includes('id="roomWindow"'), false);
for (const label of ['Project age', 'Sample milestone', 'Project date', '共通聊天室', 'MCP 对话区', '记忆', '小组件', '主聊天']) assert.ok(index.includes(label));
assert.match(index, /模型工作台[\s\S]*模型工作台/);
assert.doesNotMatch(index, /Serpent Action Log|工具调用记录|登岛信与予爱机书/);

const worker = await read(resolve(pages, 'service-worker.js'));
assert.ok(worker.includes(`const CACHE_NAME = '${APP_CACHE_NAME}';`));
for (const excluded of ["url.pathname.startsWith('/api/')", "url.pathname.startsWith('/mcp')", "url.pathname.startsWith('/.well-known/')", "['/login', '/logout', '/mailbox']"]) assert.ok(worker.includes(excluded));
const coreBlock = worker.slice(worker.indexOf('const CORE'), worker.indexOf(']);', worker.indexOf('const CORE')) + 2);
const coreUrls = [...coreBlock.matchAll(/'([^']+)'/g)].map((match) => match[1]);
for (const url of coreUrls) { const pathname = url.split('?')[0]; if (pathname !== '/') await access(resolve(pages, pathname.replace(/^\//, ''))); }
assert.ok(coreUrls.includes('/public/features/desk.js'));
assert.ok(coreUrls.includes('/public/features/daily.js'));
assert.ok(coreUrls.includes('/public/content/island-letter.js'));
assert.equal(coreUrls.includes('/public/content/letters.js'), false);
assert.ok(coreUrls.includes('/public/media/model-partner-default-avatar.jpg'));
assert.equal(coreUrls.includes('/public/features/construction.js'), false);

const moduleFiles = [
  'app.js', 'mailbox-entry.js', 'mailbox.js', 'core/api.js', 'core/danger.js', 'core/dom.js', 'core/event-spine.js', 'core/icons.js', 'core/router.js', 'core/stream-format.js', 'core/storage.js',
  'content/island-letter.js', 'features/chat-state.js', 'features/chat.js', 'features/daily-client.js', 'features/daily.js', 'features/dev-hands.js', 'features/dogtalk.js', 'features/letters.js', 'features/memory.js',
  'features/models.js', 'features/settings.js', 'features/shell.js', 'features/tools.js', 'features/desk.js', 'features/toolroom.js',
].map((path) => resolve(pages, 'public', path));
for (const file of moduleFiles) {
  const source = await read(file);
  assert.equal(/MutationObserver|window\.__|setInterval\s*\(|createElement\(['"]script['"]\)/.test(source), false, `forbidden runtime ownership in ${file}`);
  assert.equal(/document\.addEventListener\s*\(/.test(source), false, `global document listener bypasses Event Spine in ${file}`);
  assert.equal(/stopImmediatePropagation\s*\(|\.onclick\s*=/.test(source), false, `legacy event override remains in ${file}`);
  for (const specifier of [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1])) if (specifier.startsWith('.')) await access(resolve(dirname(file), specifier));
}

console.log('architecture: ok');