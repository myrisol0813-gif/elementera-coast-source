import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFile(resolve(root, path), 'utf8');
const [mcp, registry, registryCore, devRegistry, access, daily, client, store, schema, modelTools, desk, packageSource, architecture, futureVision] = await Promise.all([
  read('functions/mcp-tools.js'),
  read('functions/tool-registry.js'),
  read('functions/tool-registry-core.js'),
  read('functions/dev-hand-model-tools.js'),
  read('functions/surface-access-rules.js'),
  read('elementera-mcp/deploy-pages/public/features/daily.js'),
  read('elementera-mcp/deploy-pages/public/features/daily-client.js'),
  read('functions/daily-store.js'),
  read('functions/daily-schema.js'),
  read('functions/daily-model-tools.js'),
  read('elementera-mcp/deploy-pages/public/features/desk.js'),
  read('package.json'),
  read('ARCHITECTURE.md'),
  read('docs/future-vision-images.md'),
]);

for (const retiredCompat of ['RETIRED_MCP_TOOLS', 'retiredTool(', 'retiredToolResult(', "'retired_tool'"]) {
  assert.equal(mcp.includes(retiredCompat), false, `${retiredCompat} compatibility must be gone`);
}
assert.match(mcp, /listRegisteredMcpTools/);
assert.match(registry, /tool-registry-core\.js/);
assert.match(registry, /dev-hand-model-tools\.js/);
assert.match(registryCore, /official_mcp: officialMcpTool/);
for (const ordinaryName of [
  'list_radio_messages', 'list_lighthouse_letters', 'read_mystic_dogtalk', 'search_authorized_memory',
  'send_radio_message', 'write_lighthouse_letter', 'list_daily_moments', 'create_daily_moment', 'list_daily_diaries', 'create_daily_diary',
]) assert.ok(registryCore.includes(`name: '${ordinaryName}'`), `${ordinaryName} schema belongs in Tool Registry core`);
for (const devName of ['github_read_file', 'github_create_or_update_file', 'ci_list_recent_runs', 'notion_read_root_page']) {
  assert.ok(devRegistry.includes(devName), `${devName} belongs in the direct owner dev-hand registry`);
}

assert.match(access, /backendTools/);
assert.match(access, /modelVisibleTools/);
assert.equal(/\bmodelTools\b/.test(access), false);
assert.equal(/\btools:\s*\[/.test(access), false);
assert.match(architecture, /backendTools/);
assert.match(architecture, /modelVisibleTools/);

for (const source of [daily, client, store, schema, modelTools, mcp]) {
  assert.equal(source.includes('image_refs'), false, 'Daily runtime/schema must not expose image_refs');
}
for (const source of [daily, client, store, schema]) assert.equal(source.includes('image_refs_json'), false);
for (const retiredUi of ['momentImageRef', 'diaryImageRef', 'stableImageRef', '图片引用']) assert.equal(daily.includes(retiredUi), false);
for (const decorative of ['xiaohan_avatar_dataurl', 'myri_avatar_dataurl', 'moment_cover_dataurl']) {
  assert.ok([daily, schema].join('\n').includes(decorative), `${decorative} profile persistence must remain`);
}
assert.match(futureVision, /附件 \/ 文件对象/);
assert.match(futureVision, /vision\/image input/);
assert.match(futureVision, /不实现新的识图系统/);

for (const ownerLabel of ['核心', '使用时机', '勿误用', '当前整理', '当前活跃线索', '待确认候选', '屋主', '访客', '双方', '信箱', '灯塔', '共通聊天室', '官端 MCP', '小组件', '用户消息', '另一位屋主回复', '工具结果 JSON']) {
  assert.ok(desk.includes(ownerLabel), `desk misses owner-visible Chinese label: ${ownerLabel}`);
}
for (const rawLabel of ["deskText(item.life_core, 'life_core')", "deskText(item.usage_hint, 'usage_hint')", "deskText(item.avoid_hint, 'avoid_hint')", "'tool result JSON'", "'current_text'", "<b>hand_seeds</b>", "<b>pocket_candidates：</b>"]) {
  assert.equal(desk.includes(rawLabel), false, `raw owner-visible label remains: ${rawLabel}`);
}

const pkg = JSON.parse(packageSource);
for (const name of ['test:core', 'test:daily', 'test:mcp', 'test:memory', 'test:mailbox', 'test:ui', 'test:all']) assert.equal(typeof pkg.scripts[name], 'string');
assert.equal(pkg.scripts['test:all'], 'npm run test');
assert.equal(pkg.devDependencies['happy-dom'], '20.12.0');

for (const retiredSystem of ['Calendar', 'Today Coast', 'Daily Summary', 'Daily drafts', 'Daily albums', 'Cross-window Touch', 'official_soil', 'lighthouse room soil']) {
  assert.ok(architecture.includes(retiredSystem) || architecture.toLowerCase().includes(retiredSystem.toLowerCase()), `architecture must keep ${retiredSystem} retired`);
}

console.log('pre-apk-hard-cleanup: ok');
