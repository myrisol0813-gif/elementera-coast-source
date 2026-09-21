import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderFurnitureBubble } from '../elementera-mcp/deploy-pages/public/features/chat/chat-furniture.js';
import { normalizeVariant } from '../elementera-mcp/deploy-pages/public/features/chat-state.js';

const runs = [
  {
    id: 'run-memory',
    tool_key: 'memory.search',
    label: '搜索了记忆',
    status: 'success',
    count: 7,
    items: [
      { kind: '关系', title: '海鸟与岸' },
      { kind: '工程技术', title: 'SSE 编解码统一' },
      { kind: '偏好', title: '不要虫子意象' },
      { kind: '记录', title: '第四条' },
      { kind: '记录', title: '第五条' },
    ],
    extra_count: 2,
  },
  {
    id: 'run-dogtalk',
    tool_key: 'dogtalk.read',
    label: '读取了私人草稿',
    status: 'success',
    count: 1,
    items: [],
    extra_count: 0,
  },
];

assert.equal(renderFurnitureBubble([], { conversationId: 'conv-1' }), '', 'no tools means no furniture bubble');
const html = renderFurnitureBubble(runs, { conversationId: 'conv-1' });
assert.ok(html.includes('本轮工具'));
assert.ok(html.includes('使用了 2 件工具'));
assert.ok(html.includes('搜索了记忆：7 条'));
assert.ok(html.includes('关系｜海鸟与岸'));
assert.ok(html.includes('工程技术｜SSE 编解码统一'));
assert.ok(html.includes('偏好｜不要虫子意象'));
assert.ok(html.includes('另有 2 条'));
assert.ok(html.includes('读取了私人草稿'));
assert.ok(html.includes('data-run-ids="run-memory,run-dogtalk"'));
assert.ok(html.includes('data-conversation-id="conv-1"'));
assert.ok(html.includes('查看工具调用记录'));

const runtimeRuns = [
  {
    id: 'runtime:web-search',
    tool_key: 'web.search',
    label: '搜索了公开网络',
    status: 'success',
    count: 2,
    items: [
      { kind: 'openrouter.ai', title: 'OpenRouter docs' },
      { kind: 'example.com', title: 'Example source' },
    ],
    extra_count: 0,
  },
  {
    id: 'runtime:attachment-not-delivered',
    tool_key: 'attachment.delivery',
    label: '有一份附件没有递进去',
    status: 'error',
    count: 1,
    items: [{ kind: 'model_no_vision', title: '图.jpg' }],
    extra_count: 0,
    error_type: 'model_no_vision',
  },
];
const runtimeHtml = renderFurnitureBubble(runtimeRuns, { conversationId: 'conv-1' });
assert.ok(runtimeHtml.includes('搜索了公开网络：2 次'));
assert.ok(runtimeHtml.includes('openrouter.ai｜OpenRouter docs'));
assert.ok(runtimeHtml.includes('example.com｜Example source'));
assert.ok(runtimeHtml.includes('有一份附件没有递进去'));
assert.ok(runtimeHtml.includes('model_no_vision｜图.jpg'));
assert.ok(!runtimeHtml.includes('data-run-ids='), 'runtime receipts must not point at nonexistent local action logs');
assert.ok(!runtimeHtml.includes('查看工具调用记录'));

const mixedHtml = renderFurnitureBubble([...runs, ...runtimeRuns], { conversationId: 'conv-1' });
assert.ok(mixedHtml.includes('data-run-ids="run-memory,run-dogtalk"'), 'mixed furniture links only real local tool runs');
assert.ok(!mixedHtml.includes('run-memory,run-dogtalk,runtime:'));

const normalized = normalizeVariant({
  id: 'assistant-1',
  content: '回复正文',
  furniture_runs: [
    ...runs,
    { id: 'bad', tool_key: '', label: '无效项', status: 'success' },
  ],
}, 'assistant');
assert.equal(normalized.furniture_runs.length, 2);
assert.equal(normalized.furniture_runs[0].items.length, 5);
assert.equal(normalized.furniture_runs[1].label, '读取了私人草稿');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const render = await readFile(resolve(root, 'elementera-mcp/deploy-pages/public/features/chat/chat-render.js'), 'utf8');
const streamFlow = await readFile(resolve(root, 'elementera-mcp/deploy-pages/public/features/chat/chat-stream-flow.js'), 'utf8');
const router = await readFile(resolve(root, 'functions/chat-router.js'), 'utf8');
const toolroom = await readFile(resolve(root, 'elementera-mcp/deploy-pages/public/features/toolroom.js'), 'utf8');

assert.match(render, /renderFurnitureBubble\(branch\.assistant\.furniture_runs/);
assert.ok(render.indexOf('renderFurnitureBubble(branch.assistant.furniture_runs') < render.indexOf('<div class=\"assistant-text\">'), 'furniture bubble must render above assistant text');
assert.match(streamFlow, /item\.event === 'furniture_runs'/);
assert.match(streamFlow, /mergeFurniture\(streamState\.furnitureRuns, streamState\.deskSlip\)/);
assert.match(streamFlow, /runtime:attachment-vision/);
assert.match(streamFlow, /runtime:web-search/);
assert.match(streamFlow, /furniture_runs: furnitureRuns/);
assert.match(router, /encodeSseEvent\('furniture_runs', assembled\.furnitureRuns\(\)\)/);
assert.ok(router.indexOf("encodeSseEvent('furniture_runs'") < router.lastIndexOf("encodeSseEvent('desk_slip'"), 'final desk slip follows furniture runs even when a pending desk slip is emitted earlier');
assert.match(router, /lighthouse_generation_disabled/);
assert.match(toolroom, /data-input=\"toolroom:status\"/);
assert.match(toolroom, /data-input=\"toolroom:tool\"/);
assert.match(toolroom, /runIds\.join\(','\)/);
assert.match(toolroom, /conversation_id/);

console.log('chat-furniture-ui: ok');
