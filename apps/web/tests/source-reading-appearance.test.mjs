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
const toolDescriptions = await readFile(new URL('../functions/tool-registry-core.js', import.meta.url), 'utf8');
const libraryApi = await readFile(new URL('../functions/tidal-library-api.js', import.meta.url), 'utf8');
const libraryImport = await readFile(new URL('../../android/app/src/main/kotlin/com/elementeracoast/app/feature/daily/LibraryImport.kt', import.meta.url), 'utf8');
const dogtalkDrawer = await readFile(new URL('../../android/app/src/main/kotlin/com/elementeracoast/app/feature/dogtalk/DogtalkCard.kt', import.meta.url), 'utf8');
const assistant = await readFile(new URL('../../android/app/src/main/kotlin/com/elementeracoast/app/feature/chat/AssistantMessage.kt', import.meta.url), 'utf8');
const timeline = await readFile(new URL('../../android/app/src/main/kotlin/com/elementeracoast/app/feature/chat/ChatTimeline.kt', import.meta.url), 'utf8');
for (const content of [toolDescriptions, libraryApi, libraryImport, settings, dogtalkDrawer, library]) {
  assert.ok(!content.includes('潮中书房'), 'An old private-facing library name remains');
}
assert.match(toolDescriptions, /查看书架/);
assert.match(toolDescriptions, /阅读书页/);
assert.match(settings, /snapshotDataSection\('书房', snapshot\.tidal_library\)/);
assert.match(dogtalkDrawer, /跨窗口选取/);
assert.match(dogtalkDrawer, /历史消息搜索/);
assert.doesNotMatch(dogtalkDrawer, /旧信关键词|跨窗口取信/);
assert.match(assistant, /ModelMetadataTraceChip\(state = metadataTraceState/);
assert.match(assistant, /ModelMetadataTracePanel\(state = metadataTraceState/);
assert.doesNotMatch(timeline, /ModelMetadataTraceCard\(/);
assert.match(timeline, /ModelUsageFooter\(/);
console.log('source reading appearance, tool naming and Native trace placement: ok');
