import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const index = await readFile(resolve(root, 'elementera-mcp/deploy-pages/index.html'), 'utf8');
const stream = await readFile(resolve(root, 'elementera-mcp/deploy-pages/public/features/chat/chat-stream-flow.js'), 'utf8');
const status = await readFile(resolve(root, 'elementera-mcp/deploy-pages/public/features/chat/chat-tool-status.js'), 'utf8');
const worker = await readFile(resolve(root, 'elementera-mcp/deploy-pages/service-worker.js'), 'utf8');

assert.match(index, /JPG \/ PNG \/ WebP · 单个 ≤ 8 MB/);
assert.match(index, /TXT \/ MD \/ JSON \/ CSV \/ 代码 · 读取 ≤ 1 MB/);
assert.match(index, /PDF \/ Office 暂不解析 · 上传 ≤ 8 MB/);
assert.match(index, /id="toolStatus"/);

assert.match(stream, /item\.event === 'tool'/);
assert.match(stream, /showLocalToolStatus\(item\.data\)/);
assert.match(stream, /item\.event === 'server_tools'/);
assert.match(stream, /showWebSearchStatus\(item\.data\)/);
assert.match(status, /使用工具 ·/);
assert.match(status, /搜索了公开网络 ·/);
assert.match(status, /results_count/);
assert.match(worker, /chat-tool-status\.js/);

console.log('v1-acceptance-polish-ui: ok');
