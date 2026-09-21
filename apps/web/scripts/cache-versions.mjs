import { readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_CACHE_VERSION = 'coast-app-87';
export const MAILBOX_CACHE_VERSION = 'coast-mailbox-05';
export const MAILBOX_SHARED_CACHE_VERSION = 'coast-app-85';
export const APP_CACHE_NAME = `elementera-${APP_CACHE_VERSION}`;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const targets = Object.freeze([
  Object.freeze({
    file: 'elementera-mcp/deploy-pages/index.html',
    assets: Object.freeze({
      '/public/styles/tokens.css': APP_CACHE_VERSION,
      '/public/styles/shell.css': APP_CACHE_VERSION,
      '/public/styles/chat.css': APP_CACHE_VERSION,
      '/public/styles/mcp-letter.css': APP_CACHE_VERSION,
      '/public/styles/rikkahub.css': APP_CACHE_VERSION,
      '/public/styles/features.css': APP_CACHE_VERSION,
      '/public/styles/desk.css': APP_CACHE_VERSION,
      '/public/styles/dev-hands.css': APP_CACHE_VERSION,
      '/public/app.js': APP_CACHE_VERSION,
    }),
  }),
  Object.freeze({
    file: 'elementera-mcp/deploy-pages/service-worker.js',
    cacheName: true,
    assets: Object.freeze({
      '/public/styles/tokens.css': APP_CACHE_VERSION,
      '/public/styles/shell.css': APP_CACHE_VERSION,
      '/public/styles/chat.css': APP_CACHE_VERSION,
      '/public/styles/mcp-letter.css': APP_CACHE_VERSION,
      '/public/styles/rikkahub.css': APP_CACHE_VERSION,
      '/public/styles/features.css': APP_CACHE_VERSION,
      '/public/styles/desk.css': APP_CACHE_VERSION,
      '/public/styles/dev-hands.css': APP_CACHE_VERSION,
      '/public/app.js': APP_CACHE_VERSION,
    }),
  }),
  Object.freeze({
    file: 'functions/mailbox-page.js',
    assets: Object.freeze({
      '/public/styles/tokens.css': MAILBOX_SHARED_CACHE_VERSION,
      '/public/styles/shell.css': MAILBOX_SHARED_CACHE_VERSION,
      '/public/styles/chat.css': MAILBOX_SHARED_CACHE_VERSION,
      '/public/styles/features.css': MAILBOX_SHARED_CACHE_VERSION,
      '/public/styles/mailbox.css': MAILBOX_CACHE_VERSION,
      '/public/mailbox.js': MAILBOX_CACHE_VERSION,
    }),
  }),
  Object.freeze({
    file: 'functions/auth.js',
    assets: Object.freeze({ '/public/mailbox-entry.js': MAILBOX_CACHE_VERSION }),
  }),
]);

function escaped(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function synchronizedSource(source, target) {
  let output = source;
  for (const [asset, version] of Object.entries(target.assets)) {
    const pattern = new RegExp(`${escaped(asset)}\\?v=[a-z0-9-]+`, 'g');
    if (!pattern.test(output)) throw new Error(`${target.file}: missing versioned reference for ${asset}`);
    output = output.replace(pattern, `${asset}?v=${version}`);
  }
  if (target.cacheName) {
    const pattern = /^const CACHE_NAME = '[^']+';$/m;
    if (!pattern.test(output)) throw new Error(`${target.file}: missing CACHE_NAME`);
    output = output.replace(pattern, `const CACHE_NAME = '${APP_CACHE_NAME}';`);
  }
  return output;
}
function assertNoUnknownVersions(source, target) {
  const expected = new Set(Object.keys(target.assets));
  for (const match of source.matchAll(/(\/public\/[^"'`\s?]+)\?v=([a-z0-9-]+)/gi)) {
    if (!expected.has(match[1])) throw new Error(`${target.file}: untracked versioned reference ${match[1]}?v=${match[2]}`);
  }
}
export async function syncCacheVersions({ write = false } = {}) {
  const changed = [];
  for (const target of targets) {
    const filename = resolve(root, target.file);
    const source = await readFile(filename, 'utf8');
    assertNoUnknownVersions(source, target);
    const synchronized = synchronizedSource(source, target);
    if (synchronized === source) continue;
    changed.push(relative(root, filename));
    if (write) await writeFile(filename, synchronized);
  }
  if (changed.length && !write) throw new Error(`cache versions are out of sync: ${changed.join(', ')}`);
  return changed;
}
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const flag = process.argv[2] || '--check';
  if (!['--check', '--write'].includes(flag)) throw new Error(`unknown cache version mode: ${flag}`);
  const changed = await syncCacheVersions({ write: flag === '--write' });
  console.log(flag === '--write' ? `cache-versions: synchronized ${changed.length} file(s)` : `cache-versions: ok (${APP_CACHE_NAME}, ${MAILBOX_CACHE_VERSION})`);
}
