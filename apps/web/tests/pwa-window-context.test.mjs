import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync('elementera-mcp/deploy-pages/index.html', 'utf8');
const settings = fs.readFileSync('elementera-mcp/deploy-pages/public/features/chat/chat-window-settings.js', 'utf8');
const render = fs.readFileSync('elementera-mcp/deploy-pages/public/features/chat/chat-render.js', 'utf8');
const tokens = fs.readFileSync('elementera-mcp/deploy-pages/public/styles/tokens.css', 'utf8');
const shell = fs.readFileSync('elementera-mcp/deploy-pages/public/styles/shell.css', 'utf8');
const chat = fs.readFileSync('elementera-mcp/deploy-pages/public/styles/chat.css', 'utf8');
const worker = fs.readFileSync('elementera-mcp/deploy-pages/service-worker.js', 'utf8');

assert.match(html, /id="moreButton"[^>]+data-action="chat:window-settings"/, 'top-right more button should open current-window settings');
assert.match(html, /id="windowContextOverlay"/, 'window settings overlay should exist');
assert.doesNotMatch(render, /chat:toggle-short-mode/, 'sidebar conversation menu should not own short-mode settings');

for (const field of ['date', 'time', 'weather', 'calendar']) {
  assert.match(settings, new RegExp(`\\['${field}'[^\\n]+true\\]`), `${field} should be editable in PWA`);
}
for (const field of ['battery', 'location', 'recent_app', 'app_usage', 'steps']) {
  assert.match(settings, new RegExp(`\\['${field}'[^\\n]+false\\]`), `${field} should stay Native-only in PWA`);
}
assert.match(settings, /normalizeContextSettings/, 'window settings should reuse canonical context normalization');
assert.doesNotMatch(settings, /function cleanSettings\(/, 'window settings must not duplicate context normalization');
assert.match(settings, /仅 Native 可用/, 'locked device fields should explain why they cannot be changed');
assert.match(settings, /整理当前对话的纸条/, 'Source thought-soil wording should remain generalized');
assert.match(settings, /window-soil-open/, 'thought soil should remain reachable from current-window settings');
assert.match(settings, /window-letter-open/, 'landing letter should remain reachable from current-window settings');

assert.match(tokens, /--topbar-height:\s*44px;/, 'PWA top bar should stay compact');
assert.match(tokens, /--composer-height:\s*48px;/, 'PWA composer shell should stay compact');
assert.match(tokens, /--reading-size:\s*16px;/, 'chat reading size should remain 16px');
assert.match(shell, /\.model-title\s*\{[^}]*font-size:\s*15px;/s, 'top bar title should use compact type');
assert.match(chat, /\.composer--chat\s*\{\s*grid-template-columns:\s*38px/s, 'composer controls should stay compact');
assert.match(chat, /#promptInput\s*\{[^}]*font-size:\s*15px;/s, 'composer input text should be compact');
assert.match(chat, /\.window-context-sheet\s*\{/, 'window context sheet styles should exist');
assert.match(worker, /\/public\/features\/chat\/chat-window-settings\.js/, 'window settings module should be present in the offline CORE');

console.log('source pwa-window-context: ok');
