import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entryPath = resolve(root, 'functions/models.js');
const entry = await readFile(entryPath, 'utf8');
const lines = entry.split('\n').length;
assert.ok(lines <= 180, `models.js regrew to ${lines} lines`);
assert.doesNotMatch(entry, /OPENROUTER_CHAT_URL/);
assert.doesNotMatch(entry, /async function prepareFormalChat/);
assert.doesNotMatch(entry, /async function\* readProviderSse/);
assert.doesNotMatch(entry, /Sandbox/);

const expectedModules = [
  'model-constants.js',
  'model-catalog.js',
  'model-validation.js',
  'model-payload.js',
  'model-formal-chat.js',
  'model-formal-chat-core.js',
  'model-route.js',
];
const sources = {};
for (const name of expectedModules) {
  sources[name] = await readFile(resolve(root, 'functions/models', name), 'utf8');
}
assert.match(sources['model-catalog.js'], /export function buildModelCatalog/);
assert.match(sources['model-catalog.js'], /export async function fetchModelCatalog/);
assert.match(sources['model-formal-chat.js'], /from '\.\/model-formal-chat-core\.js'/);
assert.match(sources['model-formal-chat-core.js'], /export async function performFormalChat/);
assert.match(sources['model-formal-chat-core.js'], /export async function\* performFormalChatStream/);
assert.match(sources['model-route.js'], /export async function handleModels/);
assert.doesNotMatch(sources['model-route.js'], /handleSandbox|chat-sandbox/);

let sandboxExists = true;
try { await access(resolve(root, 'functions/models/model-sandbox.js')); } catch { sandboxExists = false; }
assert.equal(sandboxExists, false, 'retired model-sandbox module must stay deleted');

const api = await import(`${pathToFileURL(entryPath).href}?split=${Date.now()}`);
for (const name of [
  'MAX_FORMAL_TOKENS', 'ModelRequestError', 'normalizeUsage', 'normalizeToolCalls',
  'buildModelCatalog', 'fetchModelCatalog',
  'performFormalChat', 'performFormalChatWithTools', 'performFormalChatStream',
  'handleModels', 'modelErrorResponse',
]) assert.ok(name in api, `models.js lost public export ${name}`);
assert.equal('handleSandbox' in api, false, 'retired sandbox export must not return');

console.log(`models-split: ok (${lines} lines)`);
