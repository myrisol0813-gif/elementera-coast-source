import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { APP_CACHE_NAME, APP_CACHE_VERSION, MAILBOX_CACHE_VERSION } from '../scripts/cache-versions.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pages = resolve(root, 'elementera-mcp/deploy-pages');
const read = (path) => readFile(path, 'utf8');
const between = (source, start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing block: ${start}`);
  return source.slice(from, to);
};
const escaped = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const settings = await read(resolve(pages, 'public/features/settings.js'));
const wolf = between(settings, "router.register('wolf'", "router.register('desk'");
for (const expected of ['个人资料', '外观', '聊天记录', '模型箱', '基本设置', '关于与诊断']) assert.ok(wolf.includes(expected), `wolf missing: ${expected}`);
for (const retired of ['API 免费沙盒测试', '施工状态', 'System Prompt 草稿', '运行水闸', '开发者工具', '模型管理', '当前模型']) assert.equal(wolf.includes(retired), false, `wolf leaked retired entry: ${retired}`);
assert.equal((wolf.match(/row\('模型箱'/g) || []).length, 1, '屋主设置 must expose exactly one model-box row');
assert.match(wolf, /当前：\$\{shortModelName/);

const desk = between(settings, "router.register('desk'", "router.register('settings-profile'");
assert.ok(desk.includes("title: '模型工作台'"));
assert.ok(desk.includes("row('工具调用记录'"));
for (const retired of ['Model Partner 画像', 'Model Partner 气泡', '桌面便签', '本轮上下文预览', '词典', '开发者工具', '基本设置', '运行水闸', 'API 免费沙盒测试']) assert.equal(desk.includes(retired), false, `模型工作台 leaked old entry: ${retired}`);
assert.equal(settings.includes("router.register('settings-system'"), false);
assert.equal(settings.includes("router.register('settings-work'"), false);
assert.equal(settings.includes("router.register('settings-developer-tools'"), false);
assert.equal(settings.includes('systemDraft'), false);
assert.equal(settings.includes('modelPartnerPortrait'), false);
assert.equal(settings.includes('modelPartnerNote'), false);
assert.equal(settings.includes('assistantBubble'), false);

const profile = between(settings, "router.register('settings-profile'", "router.register('settings-appearance'");
for (const expected of ['昵称', '聊天署名 / 导出时显示名', '用户气泡颜色', '头像在碳硅圈资料中设置', '不会自动进入模型伙伴']) assert.ok(profile.includes(expected), `profile missing: ${expected}`);
assert.equal(profile.includes('ownerAvatar'), false, 'Wolf profile must not introduce a second avatar field');
assert.match(settings, /display_profile: display/);
assert.match(settings, /ownerSignature/);
assert.match(settings, /snapshotChatHtml\(snapshot, signature\)/);
assert.match(settings, /Elementera Coast · 全局 HTML/);
assert.match(settings, /数据范围与 V1 JSON 快照同源/);

const tools = await read(resolve(pages, 'public/features/tools.js'));
for (const expected of ['最近聊天轮数', '上下文 token budget', '回答长度', '最大输出 token', '表达倾向', '流式输出', '当前对话纸条最多字数', '线索冷却轮数', '世界书 / 词典', '每轮最多词条', '本轮记忆召回上限']) assert.ok(tools.includes(expected), `basic settings missing: ${expected}`);
for (const retired of ['舒服区间上沿', '运行水闸', 'API 免费沙盒测试', 'sandbox', 'maxHandSeeds', 'conversationSeedLimit', 'globalSeedLimit', 'conversationMemoryLimit', 'globalMemoryLimit']) assert.equal(tools.includes(retired), false, `basic settings leaked retired item: ${retired}`);

const requestContextPath = resolve(pages, 'public/features/chat/chat-request-context.js');
const { pickRunSettings, RUN_SETTING_KEYS } = await import(pathToFileURL(requestContextPath).href + '?clean27=' + Date.now());
const activeKeys = ['recentTurns', 'contextBudget', 'outputLength', 'maxOutputTokens', 'creativity', 'streamingEnabled', 'soilBudget', 'seedCooldownTurns', 'worldbookEnabled', 'worldbookLimit', 'memoryLimit'];
assert.deepEqual([...RUN_SETTING_KEYS], activeKeys);
const picked = pickRunSettings(Object.fromEntries([...activeKeys.map((key) => [key, key]), ['maxHandSeeds', 99], ['systemDraft', 'bad']]));
assert.deepEqual(Object.keys(picked), activeKeys);
assert.equal('maxHandSeeds' in picked, false);

const api = await read(resolve(pages, 'public/core/api.js'));
const apiRouter = await read(resolve(root, 'functions/api-router.js'));
const modelRoute = await read(resolve(root, 'functions/models/model-route.js'));
const models = await read(resolve(root, 'functions/models.js'));
for (const source of [api, apiRouter, modelRoute, models]) {
  assert.equal(source.includes('chat-sandbox'), false);
  assert.equal(source.includes('handleSandbox'), false);
}
let sandboxExists = true;
try { await access(resolve(root, 'functions/models/model-sandbox.js')); } catch { sandboxExists = false; }
assert.equal(sandboxExists, false, 'retired model-sandbox.js must be deleted');

const storage = await read(resolve(pages, 'public/core/storage.js'));
const defaultsBlock = between(storage, 'function defaults()', 'function parseJson');
for (const retired of ['systemDraft', 'assistantBubble', 'modelPartnerPortrait', 'modelPartnerNote', 'ownerAvatar', 'LEGACY_RUN_CONTROL_DEFAULTS', 'legacyCache', 'legacyDrafts', 'legacyStatus']) assert.equal(defaultsBlock.includes(retired), false, `active storage defaults leaked: ${retired}`);
const defaultDaily = between(storage, 'function defaultDaily()', 'function defaults()');
for (const retired of ['summary', 'draft', 'album', 'legacy']) assert.equal(defaultDaily.toLowerCase().includes(retired), false, `Daily default leaked: ${retired}`);
assert.match(storage, /Object\.keys\(base\.runControl\)/);

const memoryLibrary = await read(resolve(pages, 'public/features/memory/memory-library-view.js'));
for (const entrance of ['>记忆库<', '>种子库<', '>世界书<', '>全局摘录<', '>自定义指令<']) assert.ok(memoryLibrary.includes(entrance), `Memory v2 entrance missing: ${entrance}`);
const dailyConstants = await read(resolve(pages, 'public/features/daily/daily-constants.js'));
for (const retired of ['summary', 'draft', 'album', 'calendar', 'today-coast']) assert.equal(dailyConstants.toLowerCase().includes(retired), false, `Daily retired route returned: ${retired}`);

const furniture = await read(resolve(pages, 'public/features/chat/chat-furniture.js'));
const render = await read(resolve(pages, 'public/features/chat/chat-render.js'));
const toolroom = await read(resolve(pages, 'public/features/toolroom.js'));
assert.match(furniture, /使用了 \$\{runs\.length\} 件工具/);
assert.match(furniture, /data-run-ids/);
assert.match(furniture, /data-conversation-id/);
assert.match(render, /renderFurnitureBubble/);
assert.match(toolroom, /title: '工具调用记录'/);
assert.match(toolroom, /subtitle: '模型工作台 · 工具透明层'/);
assert.match(toolroom, /status/);
assert.match(toolroom, /tool_key/);
assert.match(toolroom, /runIds/);

assert.equal(MAILBOX_CACHE_VERSION, 'coast-source-mailbox-01');
const worker = await read(resolve(pages, 'service-worker.js'));
assert.match(worker, new RegExp(`const CACHE_NAME = '${escaped(APP_CACHE_NAME)}'`));
assert.match(worker, new RegExp(`/public/app\\.js\\?v=${escaped(APP_CACHE_VERSION)}`));
assert.match(worker, /\/public\/features\/chat\/chat-furniture\.js/);
const index = await read(resolve(pages, 'index.html'));
assert.match(index, new RegExp(`/public/app\\.js\\?v=${escaped(APP_CACHE_VERSION)}`));
assert.match(index, /模型工作台/);
assert.match(index, /模型工作台/);
const mailboxPage = await read(resolve(root, 'functions/mailbox-page.js'));
assert.ok(mailboxPage.includes('coast-source-mailbox-01'));
assert.equal(mailboxPage.includes('coast-mailbox-04'), false);

console.log('pwa-profile-furniture-clean: ok');
