import assert from 'node:assert/strict';
import { normalizeContextSettings as server } from '../functions/chat-store.js';
import { normalizeContextSettings as browser } from '../elementera-mcp/deploy-pages/public/features/chat-state.js';
for (const normalize of [server,browser]) {
  const value=normalize({cross_window_auto:true,local_model_tools_enabled:true});
  assert.equal(value.cross_window_auto,true);
  assert.equal(value.local_model_tools_enabled,true);
  const off=normalize({cross_window_auto:false,local_model_tools_enabled:'true'});
  assert.equal('cross_window_auto' in off,false);
  assert.equal('local_model_tools_enabled' in off,false);
}
