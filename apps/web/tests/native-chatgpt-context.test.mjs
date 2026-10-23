import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareNativeChatGpt, executeNativeChatGptTool, saveNativeChatGptEcho } from '../functions/native-chatgpt-chat.js';
import { ChatStoreError } from '../functions/chat-store.js';
import { isChatApiPath } from '../functions/chat-router.js';

for (const path of ['/api/chat/native-context', '/api/chat/native-tool', '/api/chat/native-echo']) {
  test(path + ' is a protected chat route', () => assert.equal(isChatApiPath(path), true));
}

for (const action of [prepareNativeChatGpt, executeNativeChatGptTool, saveNativeChatGptEcho]) {
  test(action.name + ' rejects state changing requests from another origin', async () => {
    const request = new Request('https://coast.example/api/chat/native-context', {
      method: 'POST',
      headers: { 'Origin': 'https://evil.example' },
      body: '{}',
    });
    await assert.rejects(action(request, {}), (error) =>
      error instanceof ChatStoreError && error.status === 403);
  });
  test(action.name + ' has no GET mutation path', async () => {
    const response = await action(new Request('https://coast.example/api/chat/native-context'), {});
    assert.equal(response.status, 405);
  });
}

test('native context accepts payloads above the former 128 KiB cap', async () => {
  const { createConversation, writeConversationState } = await import('../functions/chat-store.js');
  const { D1Database } = await import('./d1-helper.mjs');
  const db = new D1Database();
  const conversation = await createConversation(db, 'Large native context', 'main');
  const turnId = 'turn_large_native_context';
  await writeConversationState(db, conversation.id, { turns: [{
    id: turnId,
    user: { active: 0, variants: [{ id: 'user_large_native_context', content: '测试大上下文' }] },
    assistant: { activeByUserVariant: {}, variantsByUserVariant: {} },
  }] });
  const request = new Request('https://coast.example/api/chat/native-context', {
    method: 'POST',
    headers: { Origin: 'https://coast.example', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conversation_id: conversation.id,
      source_turn_id: turnId,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: '测试大上下文' }],
      settings: { recentTurns: 4, contextBudget: 6000 },
      extra_context_padding: 'x'.repeat(150 * 1024),
    }),
  });
  const response = await prepareNativeChatGpt(request, { COAST_CHAT_DB: db });
  assert.notEqual(response.status, 413, 'Native context was rejected by the former 128 KiB cap');
});

test('Native ChatGPT plan receives voice_create and can execute it against canonical Coast store', async () => {
  const { createConversation, writeConversationState } = await import('../functions/chat-store.js');
  const { listVoiceClips } = await import('../functions/voice-clips.js');
  const { D1Database } = await import('./d1-helper.mjs');
  const db = new D1Database();
  const conversation = await createConversation(db, 'Native voice tool contract', 'main');
  const turnId = 'turn_native_voice_1';
  const userMessage = '请生成一段语音，念出 Я тебя люблю';
  await writeConversationState(db, conversation.id, { turns: [{
    id: turnId,
    user: { active: 0, variants: [{ id: 'user_native_voice_1', content: userMessage }] },
    assistant: { activeByUserVariant: {}, variantsByUserVariant: {} },
  }] });
  const envelope = {
    conversation_id: conversation.id, source_turn_id: turnId, model: 'gpt-5.5',
    messages: [{ role: 'user', content: userMessage }],
    settings: { recentTurns: 4, contextBudget: 6000 },
  };
  const makeRequest = (path, content) => new Request('https://coast.example' + path, {
    method: 'POST',
    headers: { Origin: 'https://coast.example', 'Content-Type': 'application/json' },
    body: JSON.stringify(content),
  });
  const env = { COAST_CHAT_DB: db, ELEVENLABS_API_KEY: 'test-only-key', ELEVENLABS_VOICE_ID: 'test-voice-id' };
  const prepared = await prepareNativeChatGpt(makeRequest('/api/chat/native-context', envelope), env);
  assert.equal(prepared.status, 200);
  const body = await prepared.json();
  const names = body.tools.map(tool => tool.name);
  assert.ok(names.includes('voice_create'), 'Native quota did not receive voice_create');
  assert.ok(names.includes('library_books'), 'Native quota should share the canonical owner tools');
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async (url, options) => {
      calls++;
      assert.match(String(url), /api.elevenlabs.io/);
      assert.equal(options.headers['xi-api-key'], 'test-only-key');
      return new Response(new Uint8Array([73, 68, 51, 1, 2, 3]), {
        status: 200, headers: { 'Content-Type': 'audio/mpeg' },
      });
    };
    const execution = await executeNativeChatGptTool(makeRequest('/api/chat/native-tool', {
      ...envelope,
      tool_call: { id: 'voice-test-call', function: {
        name: 'voice_create', arguments: JSON.stringify({ text: 'Я тебя люблю' }),
      } },
    }), env);
    assert.equal(execution.status, 200);
    const receipt = await execution.json();
    assert.equal(receipt.ok, true, receipt.output);
    const clip = JSON.parse(receipt.output);
    assert.equal(clip.text, 'Я тебя люблю');
    assert.ok(clip.audio_url.startsWith('/api/voice/clips/'));
    assert.equal(calls, 1);
    const stored = await listVoiceClips(db, conversation.id);
    assert.equal(stored.length, 1);
    assert.equal(stored[0].turn_id, turnId);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test('Native ChatGPT plan delivers an uploaded image without consulting the OpenRouter vision catalog', async () => {
  const { createConversation, writeConversationState } = await import('../functions/chat-store.js');
  const { uploadChatAttachment } = await import('../functions/chat-attachments.js');
  const { D1Database } = await import('./d1-helper.mjs');
  const db = new D1Database();
  const conversation = await createConversation(db, 'Native image delivery', 'main');
  const turnId = 'turn_native_vision_1';
  const userMessage = '请看这张图片';
  await writeConversationState(db, conversation.id, { turns: [{
    id: turnId,
    user: { active: 0, variants: [{ id: 'user_native_vision_1', content: userMessage }] },
    assistant: { activeByUserVariant: {}, variantsByUserVariant: {} },
  }] });
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+S0zkAAAAASUVORK5CYII=',
    'base64',
  );
  const image = await uploadChatAttachment(db, conversation.id, {
    name: 'tiny.png',
    type: 'image/png',
    size: png.length,
    async arrayBuffer() { return png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength); },
  });
  const response = await prepareNativeChatGpt(new Request('https://coast.example/api/chat/native-context', {
    method: 'POST',
    headers: { Origin: 'https://coast.example', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conversation_id: conversation.id,
      source_turn_id: turnId,
      model: 'gpt-5.6-sol',
      messages: [{ role: 'user', content: userMessage }],
      attachment_ids: [image.id],
      settings: { recentTurns: 4, contextBudget: 6000 },
    }),
  }), { COAST_CHAT_DB: db });
  assert.equal(response.status, 200);
  const body = await response.json();
  const lastUser = body.model_messages.findLast(message => message.role === 'user');
  assert.ok(Array.isArray(lastUser.content), 'Native ChatGPT receives multimodal content, not an attachment-status text');
  assert.equal(lastUser.content[1].type, 'image_url');
  assert.match(lastUser.content[1].image_url.url, /^data:image[/]png;base64,/);
  assert.equal(body.desk_slip.attachments.vision.images_delivered, 1);
  assert.deepEqual(body.desk_slip.attachments.not_delivered, []);
});
