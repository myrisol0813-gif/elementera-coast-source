import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync('elementera-mcp/deploy-pages/index.html', 'utf8');
const settings = fs.readFileSync('elementera-mcp/deploy-pages/public/features/chat/chat-window-settings.js', 'utf8');
const render = fs.readFileSync('elementera-mcp/deploy-pages/public/features/chat/chat-render.js', 'utf8');
const tokens = fs.readFileSync('elementera-mcp/deploy-pages/public/styles/tokens.css', 'utf8');
const shell = fs.readFileSync('elementera-mcp/deploy-pages/public/styles/shell.css', 'utf8');
const chat = fs.readFileSync('elementera-mcp/deploy-pages/public/styles/chat.css', 'utf8');
const worker = fs.readFileSync('elementera-mcp/deploy-pages/service-worker.js', 'utf8');

assert.match(html, /id="moreButton"[^>]+data-action="chat:window-settings"/);
assert.match(html, /id="windowContextOverlay"/);
assert.doesNotMatch(render, /chat:toggle-short-mode/);

for (const field of ['date', 'time', 'weather', 'calendar']) {
  assert.match(settings, new RegExp(`\\['${field}'[^\\n]+true\\]`), `${field} should be editable in source PWA`);
}
for (const field of ['battery', 'location', 'recent_app', 'app_usage', 'steps']) {
  assert.match(settings, new RegExp(`\\['${field}'[^\\n]+false\\]`), `${field} should remain Native-only in source PWA`);
}
assert.match(settings, /仅 Native 可用/);
assert.match(settings, /现实上下文/);
assert.match(settings, /整理当前对话的纸条/);
assert.match(settings, /window-soil-open/);
assert.match(settings, /window-letter-open/);

assert.match(tokens, /--topbar-height:\s*44px;/);
assert.match(tokens, /--composer-height:\s*48px;/);
assert.match(tokens, /--reading-size:\s*14px;/);
assert.match(shell, /\.model-title\s*\{[^}]*font-size:\s*16px;/s);
assert.match(shell, /\.sidebar\s*\{[^}]*height:\s*var\(--app-viewport-height, 100svh\)[^}]*overflow:\s*hidden;/s);
assert.match(shell, /\.sidebar-content\s*\{[^}]*height:\s*100%[^}]*overflow-y:\s*auto;/s);
assert.match(chat, /\.window-context-header h2\s*\{[^}]*font-size:\s*15px;/s);
assert.match(chat, /\.composer--chat\s*\{\s*grid-template-columns:\s*38px/s);
assert.match(chat, /\.window-context-sheet\s*\{/);
assert.match(worker, /\/public\/features\/chat\/chat-window-settings\.js/);

console.log('source-pwa-window-context: ok');
