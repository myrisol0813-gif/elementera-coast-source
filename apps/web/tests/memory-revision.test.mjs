import assert from 'node:assert/strict';
import { createConversation } from '../functions/chat-store.js';
import { createPocket, resolvePocket } from '../functions/memory-store.js';
import { D1Database } from './d1-helper.mjs';

const db = new D1Database();
const conversation = await createConversation(db, '记忆修订退役测试');

await assert.rejects(
  () => createPocket(db, {
    conversation_id: conversation.id,
    source_type: 'memory_revision',
    source_text: '旧修订候选不再进入 Memory v2 待确认区。',
  }),
  (error) => error.type === 'invalid_source_type',
);

for (const action of [
  'conversation_seed', 'global_seed', 'conversation_memory', 'global_memory',
  'stone', 'confirm_pocket',
  'revision_supplement', 'revision_replace', 'revision_new_version', 'revision_downgrade',
]) {
  const pocket = await createPocket(db, {
    conversation_id: conversation.id,
    source_type: 'turn',
    source_text: `旧动作 ${action}`,
  });
  await assert.rejects(
    () => resolvePocket(db, pocket.id, { action }),
    (error) => error.type === 'invalid_pocket_action' && error.status === 400,
  );
}

console.log('memory-revision: retired actions blocked');
