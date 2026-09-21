import assert from 'node:assert/strict';
import { validateMessages } from '../functions/models/model-validation.js';

const longConversation = [
  { role: 'system', content: 'system' },
  ...Array.from({ length: 24 }, (_, index) => [
    { role: 'user', content: `user-${index}` },
    { role: 'assistant', content: `assistant-${index}` },
  ]).flat(),
  { role: 'user', content: 'current-user' },
];

const validated = validateMessages(longConversation, { system: true });
assert.equal(validated.length, longConversation.length);
assert.equal(validated.at(-1)?.content, 'current-user');
assert.throws(
  () => validateMessages([], { system: true }),
  (error) => error?.type === 'invalid_messages' && error?.status === 400,
);

console.log('model-message-count: ok');
