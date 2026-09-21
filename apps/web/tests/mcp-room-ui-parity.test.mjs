import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

const roomService = await read('functions/room-conversation-service.js');
const metadataUi = await read('elementera-mcp/deploy-pages/public/features/chat/chat-model-metadata.js');
const renderUi = await read('elementera-mcp/deploy-pages/public/features/chat/chat-render.js');
const registry = await read('functions/tool-registry.js');

for (const field of ['model_id', 'usage', 'finish_reason', 'generation_source', 'tool_summary', 'has_desk_slip']) {
  assert.match(roomService, new RegExp(field), `room assistant list must preserve ${field}`);
}
assert.match(roomService, /furniture_runs:\s*furnitureRuns/);
assert.match(roomService, /desk_slip:\s*deskSlip/);
assert.match(roomService, /saveModelEcho/);
assert.match(roomService, /sendOfficialRoomMessage\(env, 'radio'/);
assert.match(roomService, /sendOfficialRoomMessage\(env, 'lighthouse'/);

for (const source of ['chat', 'landing', 'radio', 'lighthouse']) {
  assert.ok(metadataUi.includes(`'${source}'`), `model echo UI must accept ${source}`);
}
assert.match(renderUi, /generationFootprint\(branch\.assistant/);
assert.match(renderUi, /renderFurnitureBubble\(branch\.assistant\.furniture_runs/);
assert.match(registry, /写入 ·/);
assert.match(registry, /高风险写入 ·/);

console.log('mcp-room-ui-parity: ok');
