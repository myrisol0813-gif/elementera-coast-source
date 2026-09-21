import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../elementera-mcp/deploy-pages');
const read = (file) => readFile(resolve(root, file), 'utf8');
const exists = async (file) => {
  try { await access(resolve(root, file), constants.F_OK); return true; } catch { return false; }
};
const [
  html, app, desk, memory, memoryActions, memoryClient, memoryConstants, memoryLibraryView, memoryPocketView,
  chat, chatRender, chatActions, chatConversations, daily, tools, settings, toolroom, serviceWorker,
] = await Promise.all([
  read('index.html'), read('public/app.js'), read('public/features/desk.js'),
  read('public/features/memory.js'), read('public/features/memory/memory-actions.js'),
  read('public/features/memory/memory-client.js'), read('public/features/memory/memory-constants.js'),
  read('public/features/memory/memory-library-view.js'), read('public/features/memory/memory-pocket-view.js'),
  read('public/features/chat.js'), read('public/features/chat/chat-render.js'), read('public/features/chat/chat-actions.js'),
  read('public/features/chat/chat-conversations.js'), read('public/features/daily.js'), read('public/features/tools.js'),
  read('public/features/settings.js'), read('public/features/toolroom.js'), read('service-worker.js'),
]);
const memoryCluster = [memory, memoryActions, memoryClient, memoryConstants, memoryLibraryView, memoryPocketView].join('\n');

const window = new Window({ url: 'https://coast.test/' });
window.document.write(html);
window.document.close();
assert.ok(window.document.querySelector('#deskStatus'));
assert.ok(window.document.querySelector('[data-action="daily:home"]'));
assert.ok(window.document.querySelector('[data-action="chat:open-type"][data-kind="radio"]'));
assert.ok(window.document.querySelector('[data-action="chat:open-type"][data-kind="lighthouse"]'));
assert.equal(window.document.querySelector('#roomWindow'), null);
assert.doesNotMatch(html, /今日一瞥|海岸日历/);
assert.doesNotMatch(html, /calendar-sidebar-entry|data-action="daily:calendar"/);
assert.equal(html.includes('context.css'), false);
assert.match(app, /createDesk/);
assert.equal(app.includes('createContext'), false);
assert.equal(app.includes('createRooms'), false);
assert.equal(await exists('public/features/rooms.js'), false);

for (const retired of ['Context Manifest', 'Context Inspector', 'Memory Facets', 'Ambient Context', 'Mode Cards', '当前情境']) {
  assert.equal([html, app, desk, memoryCluster, chat, daily, tools, settings, serviceWorker].join('\n').includes(retired), false);
}
assert.match(desk, /本轮上下文预览/);
for (const label of ['模型可见工具', '后端可用工具', '常用工具', '小工具']) assert.ok(desk.includes(label));
assert.doesNotMatch(desk, /连通一千零一个触角|touch_sources/i);
assert.match(desk, /function crossWindowDeskDetails\(/);
assert.match(desk, /slip\.cross_window/);
assert.match(desk, /跨窗口取信/);
assert.doesNotMatch(desk, /今日海岸|today_coast/);
assert.match(desk, /词典/);
assert.equal(desk.includes('copy-debug'), false);

for (const tab of ['记忆库', '种子库', '世界书', '自定义指令']) assert.ok(memoryCluster.includes(`>${tab}</button>`));
for (const scope of ['conversation', 'radio', 'lighthouse', 'global']) {
  assert.equal(memoryCluster.includes(`data-action="memory:tab" data-scope="${scope}"`), false);
}
for (const action of ['revision_supplement', 'revision_replace', 'revision_new_version', 'revision_downgrade', 'confirm_pocket']) assert.equal(memoryCluster.includes(action), false);
for (const action of ['data-destination="memory"', 'data-destination="seed"', 'memory:pocket-discard']) assert.ok(memoryCluster.includes(action));
for (const tag of ['关系', '历史锚点', '偏好', '人物档案', '海岸世界观', '工程技术']) assert.ok(memoryCluster.includes(`'${tag}'`));
assert.match(memoryCluster, /记忆修订候选/);
assert.match(memoryCluster, /旧版保留/);
assert.match(memoryCluster, /memory-retrieval-card/);
assert.match(memoryCluster, />检索</);
assert.match(memoryCluster, /filterKind: 'tag'/);
assert.match(memoryCluster, /MEMORY_FILTER_KIND_ORDER = Object\.freeze\(\['time', 'model', 'window', 'tag'\]\)/);
assert.match(memoryCluster, /memory-filter-bubbles/);
assert.match(memoryCluster, /memory-filter-chip memory-filter-kind/);
assert.match(memoryCluster, /memory-filter-chip memory-filter-value/);
assert.match(memoryCluster, /popover="auto"/);
assert.match(memoryCluster, /chip-chevron/);
assert.equal(memoryCluster.includes('⌄'), false, '筛选气泡不再使用贴字的字符三角');
for (const label of ['日期', '模型', '窗口', '标签']) assert.ok(memoryCluster.includes(`label: '${label}'`));
for (const label of ['全部标签', '全部日期', '全部模型', '全部窗口', '暂无日期', '暂无模型', '暂无窗口']) assert.ok(memoryCluster.includes(label));
assert.match(memoryCluster, /if \(kind === 'tag'\) return MEMORY_TAGS/);
assert.match(memoryCluster, /params\.set\(config\.param, activeValue\)/);
assert.match(memoryCluster, /resetDimensionFilters\(runtime\)/);
assert.equal(memoryCluster.includes('memory-filter-disclosure'), false);
assert.equal(memoryCluster.includes('应用筛选'), false);
assert.equal(memoryCluster.includes('filters-reset'), false);
assert.equal(memoryCluster.includes('当前没有可用筛选项'), false);
assert.equal(memoryCluster.includes('memory-maintenance'), false);
assert.equal(memoryCluster.includes('旧数据整理 dry-run'), false);
assert.equal(memoryCluster.includes('重新检查旧数据'), false);
assert.equal(desk.includes('旧数据整理 dry-run'), false, '世界书不能出现 dry-run 调试块');
assert.match(desk, /这里还没有词条。以后聊到某个海岸名词时，再整理进来。/);
assert.match(desk, /＋ 词条/);
assert.match(chatRender, /renderSoilEntry\(conversationId\)/);
assert.match(chatActions, /name === 'open-type'/);
assert.match(chatActions, /openRoomType\(target\.dataset\.kind \|\| 'main'\)/);
assert.match(chatConversations, /room_type/);

for (const dailyEntry of ['碳硅圈', '日记', '宠物系统', '未来小组件']) assert.ok(daily.includes(dailyEntry));
for (const retiredDaily of ['一日总结', '相册', '草稿袋', 'daily:summary', 'daily:album']) assert.equal(daily.includes(retiredDaily), false);
assert.match(tools, /上下文舒服区间/);
assert.match(html, /模型工作台/);
assert.match(html, /模型工作台/);
assert.doesNotMatch(html, /Serpent Action Log|工具调用记录|登岛信与予爱机书/);
assert.match(settings, /router\.register\('desk'/);
assert.match(settings, /title: '模型工作台'/);
assert.match(settings, /row\('工具调用记录'/);
assert.doesNotMatch(settings, /row\('本轮上下文预览'|row\('词典'|row\('世界书'/);
assert.match(settings, /desk: 'desk'/);
assert.match(toolroom, /title: '工具调用记录'/);
assert.match(toolroom, /subtitle: '模型工作台 · 工具透明层'/);
assert.match(toolroom, /<h2>行动日志<\/h2>/);
assert.doesNotMatch(toolroom, /本轮上下文预览|词典|世界书/);
assert.match(serviceWorker, /public\/features\/desk\.js/);
assert.equal(serviceWorker.includes('public/features/context.js'), false);
assert.equal(serviceWorker.includes('public/features/rooms.js'), false);

console.log('desk-dom: ok');