import assert from 'node:assert/strict';
import { writeProfile, readConversationState } from '../functions/chat-store.js';
import {
  listRoomConversation,
  sendOfficialLighthouseMessage,
  sendOfficialRadioMessage,
} from '../functions/room-conversation-service.js';
import { D1Database } from './d1-helper.mjs';

const db = new D1Database();
const env = {
  COAST_CHAT_DB: db,
  OPENROUTER_API_KEY: 'test-openrouter-key',
  COAST_SESSION_SECRET: 'mcp-room-receipt-secret-'.repeat(3),
};

await writeProfile(db, {
  current_chat_model: 'openai/gpt-4.1-nano',
  current_image_model: '',
  model_box: { chat: ['openai/gpt-4.1-nano'], free: [], image: [] },
});

const originalFetch = globalThis.fetch;
let chatCalls = 0;
globalThis.fetch = async (input, options = {}) => {
  const url = String(input);
  if (url.includes('/models')) {
    return new Response(JSON.stringify({
      data: [{
        id: 'openai/gpt-4.1-nano',
        name: 'GPT-4.1 Nano',
        architecture: { input_modalities: ['text'], output_modalities: ['text'] },
        pricing: { prompt: '0.1', completion: '0.2' },
        supported_parameters: ['temperature', 'tools', 'response_format'],
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (url.includes('/chat/completions')) {
    chatCalls += 1;
    const payload = JSON.parse(options.body || '{}');
    return new Response(JSON.stringify({
      id: `mock-${chatCalls}`,
      model: payload.model || 'openai/gpt-4.1-nano',
      choices: [{
        message: { role: 'assistant', content: `海岸回复 ${chatCalls}` },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 101 + chatCalls, completion_tokens: 20, total_tokens: 121 + chatCalls },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return originalFetch(input, options);
};

try {
  const radio = await sendOfficialRadioMessage(env, {
    text: '官端电波：请回应。',
    tool_call_id: 'receipt-radio-1',
    identity: { display_author: 'Model Partner / ChatGPT', model_label: 'GPT-5.6 Sol' },
  });
  assert.equal(radio.source, 'official_mcp');
  assert.equal(radio.assistant.model_id, 'openai/gpt-4.1-nano');
  assert.equal(radio.assistant.finish_reason, 'stop');
  assert.equal(radio.assistant.generation_source, 'radio');
  assert.deepEqual(radio.assistant.usage, { prompt_tokens: 102, completion_tokens: 20, total_tokens: 122 });
  assert.ok(radio.assistant.desk_slip && typeof radio.assistant.desk_slip === 'object');
  assert.equal(radio.model_echo_status, 'saved');

  const radioState = await readConversationState(db, radio.conversation.id);
  const persistedRadioAssistant = radioState.turns[0].assistant.variantsByUserVariant['0'][0];
  assert.equal(persistedRadioAssistant.model_id, 'openai/gpt-4.1-nano');
  assert.deepEqual(persistedRadioAssistant.usage, radio.assistant.usage);
  assert.equal(persistedRadioAssistant.finish_reason, 'stop');
  assert.equal(persistedRadioAssistant.generation_source, 'radio');
  assert.ok(persistedRadioAssistant.desk_slip);

  const listedRadio = await listRoomConversation(db, 'radio', { conversation_id: radio.conversation.id });
  assert.equal(listedRadio.messages.length, 2);
  assert.equal(listedRadio.messages[0].message_source, 'official_mcp');
  assert.equal(listedRadio.messages[0].display_author, 'Model Partner / ChatGPT');
  assert.equal(listedRadio.messages[1].model_id, 'openai/gpt-4.1-nano');
  assert.deepEqual(listedRadio.messages[1].usage, radio.assistant.usage);
  assert.equal(listedRadio.messages[1].finish_reason, 'stop');
  assert.equal(listedRadio.messages[1].generation_source, 'radio');
  assert.equal(listedRadio.messages[1].has_desk_slip, true);
  assert.ok(Array.isArray(listedRadio.messages[1].tool_summary));

  const lighthouse = await sendOfficialLighthouseMessage(env, {
    subject: '官端灯塔',
    body: '请拆信并回应。',
    tool_call_id: 'receipt-lighthouse-1',
    identity: { display_author: 'Model Partner / ChatGPT', model_label: 'GPT-5.6 Sol' },
  });
  assert.equal(lighthouse.source, 'official_mcp');
  assert.equal(lighthouse.assistant.generation_source, 'lighthouse');
  assert.equal(lighthouse.assistant.finish_reason, 'stop');
  assert.ok(lighthouse.assistant.usage?.total_tokens > 0);
  assert.ok(lighthouse.assistant.desk_slip);
  assert.equal(chatCalls, 2, 'radio and lighthouse MCP messages should each trigger one API reply');

  console.log('mcp-room-turn-receipt: ok');
} finally {
  globalThis.fetch = originalFetch;
}
