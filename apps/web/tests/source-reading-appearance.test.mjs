import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const base = new URL('../elementera-mcp/deploy-pages/', import.meta.url);
const read = (path) => readFile(new URL(path, base), 'utf8');
const files = [
  'public/features/settings.js', 'public/core/storage.js', 'public/features/shell.js',
  'public/styles/tokens.css', 'public/styles/chat.css', 'public/styles/features.css',
  'public/features/library.js', 'index.html', 'service-worker.js',
];
const [settings, storage, shell, tokens, chat, features, library, html, sw] = await Promise.all(files.map(read));
assert.match(settings, /router\.register\('settings-font'/);
assert.match(settings, /'set-font'/);
for (const mode of ['classic', 'soft', 'note']) {
  assert.ok(settings.includes("'" + mode + "'"), mode + ' choice missing');
  assert.ok(storage.includes(mode), mode + ' storage missing');
}
assert.match(shell, /document\.documentElement\.dataset\.fontMode/);
assert.match(tokens, /--coast-font/);
assert.match(tokens, /:root\[data-font-mode="note"\]/);
assert.match(tokens, /:root\[data-font-mode="soft"\]/);
assert.match(chat, /\.message\.assistant\s*\{\s*display: block/);
assert.match(chat, /\.message\.assistant \.content\s*\{/);
assert.match(chat, /\.assistant-text\s*\{[^}]*font-family: var\(--coast-font\)/s);
assert.match(chat, /\.user-bubble\s*\{[^}]*font-family: var\(--coast-font\)/s);
assert.match(features, /\.reading-choice\[aria-pressed="true"\]/);
assert.match(html, /fonts\.googleapis\.com/);
assert.match(library, /这里是你的书房，可以保存阅读进度与笔记/);
for (const privateCopy of ['我们共用一间书房', '挑一本一起读', '与潮水一起翻书', '双方笔记']) {
  assert.ok(!library.includes(privateCopy), 'Old shared-library wording remains');
}
assert.match(sw, /elementera-coast-source-app-09/);
console.log('source reading appearance and neutral library copy: ok');
