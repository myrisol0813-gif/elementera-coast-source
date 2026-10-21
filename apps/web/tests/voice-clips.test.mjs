import assert from 'node:assert/strict';
import { createConversation, writeConversationState } from '../functions/chat-store.js';
import { generateVoiceClip, listVoiceClips, voiceClipAudio, VoiceClipError } from '../functions/voice-clips.js';
import { routeApi } from '../functions/api-router.js';
import { D1Database } from './d1-helper.mjs';

const db = new D1Database();
const conversation = await createConversation(db, '语音留存测试', 'main');
await writeConversationState(db, conversation.id, { turns: [{
  id: 'turn_voice_1',
  user: { active: 0, variants: [{ id: 'user_voice_1', content: '读一下这个。' }] },
  assistant: {
    activeByUserVariant: { '0': 0 },
    variantsByUserVariant: { '0': [{ id: 'assistant_voice_1', content: '第一段\n\n第二段。' }] },
  },
}] });
const original = globalThis.fetch;
let providerCalls = 0;
globalThis.fetch = async (_url, options = {}) => {
  providerCalls += 1;
  assert.equal(options.headers['xi-api-key'], 'test-only-key');
  const payload = JSON.parse(options.body);
  assert.equal(payload.model_id, 'eleven_multilingual_v2');
  assert.ok(payload.text.trim());
  return new Response(new Uint8Array([73, 68, 51, 1, 2, 3, 4]), { status: 200, headers: { 'Content-Type': 'audio/mpeg' } });
};
try {
  let missingKey = false;
  try {
    await generateVoiceClip(db, {}, { conversation_id: conversation.id, message_id: 'assistant_voice_1', paragraph_indices: [0] });
  } catch (error) { missingKey = error instanceof VoiceClipError && error.type === 'voice_not_configured'; }
  assert.ok(missingKey);
  assert.equal(providerCalls, 0);

  const clip = await generateVoiceClip(db, { ELEVENLABS_API_KEY: 'test-only-key', ELEVENLABS_VOICE_ID: 'TestVoice1234' }, {
    conversation_id: conversation.id, message_id: 'assistant_voice_1', paragraph_indices: [1, 0],
  }, { surface: 'manual' });
  assert.equal(clip.source, 'manual');
  assert.equal(clip.message_id, 'assistant_voice_1');
  assert.equal(clip.turn_id, 'turn_voice_1');
  assert.equal(clip.text, '第一段\n\n第二段。');
  assert.deepEqual([...await voiceClipAudio(db, clip.id)], [73, 68, 51, 1, 2, 3, 4]);
  assert.equal((await listVoiceClips(db, conversation.id)).length, 1);

  await assert.rejects(() => generateVoiceClip(db, { ELEVENLABS_API_KEY: 'test-only-key' }, {
    conversation_id: conversation.id, message_id: 'assistant_voice_1', paragraph_indices: [100],
  }), e => e instanceof VoiceClipError && e.type === 'invalid_selection');
  assert.equal(providerCalls, 1, 'invalid selection must never contact paid provider');

  const assistantClip = await generateVoiceClip(db, { ELEVENLABS_API_KEY: 'test-only-key' }, {
    conversation_id: conversation.id, text: '今晚翻翻书。',
  }, { surface: 'main_chat', source_turn_id: 'turn_voice_1', model_label: 'Test Model' });
  assert.equal(assistantClip.message_id, null);
  assert.equal(assistantClip.turn_id, 'turn_voice_1');
  assert.equal(providerCalls, 2);

  let response = await routeApi(new Request(`https://coast.test/api/voice/clips?conversation_id=${conversation.id}`), { COAST_CHAT_DB: db }, null);
  assert.equal(response.status, 401);
  response = await routeApi(new Request(`https://coast.test/api/voice/clips?conversation_id=${conversation.id}`), { COAST_CHAT_DB: db }, { verified: true });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).clips.length, 2);
  response = await routeApi(new Request(`https://coast.test/api/voice/clips/${clip.id}/audio`), { COAST_CHAT_DB: db }, { verified: true });
  assert.equal(response.headers.get('Content-Type'), 'audio/mpeg');
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [73, 68, 51, 1, 2, 3, 4]);
} finally { globalThis.fetch = original; }
console.log('voice-clips: ok (auth, message anchored selection, persistence, payment guard, playback)');
