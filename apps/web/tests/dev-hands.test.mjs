import assert from 'node:assert/strict';
import {
  DevHandsError,
  allowedRepos,
  requireAllowedRepo,
} from '../functions/dev-hands-policy.js';
import { devLogShape } from '../functions/dev-hands-log-shape.js';
import { redactSecretText, safeDevSummary } from '../functions/dev-hands-store.js';
import { githubActionPolicy } from '../functions/github-dev-service.js';
import { notionActionPolicy } from '../functions/notion-notes-service.js';
import { PWA_CACHE_VERSION, DEV_HANDS_RELEASE } from '../functions/dev-hands-version.js';
import { resolveDevHandToolSelection } from '../functions/dev-hand-model-tools.js';

const env = {
  COAST_GITHUB_ALLOWED_REPOS: 'myrisol0813-gif/elementera-coast,myrisol0813-gif/coast-native-android',
};

assert.equal(PWA_CACHE_VERSION, 'coast-app-87');
assert.equal(DEV_HANDS_RELEASE, 'COAST-DEV-HANDS-DIRECT-03');
assert.deepEqual(allowedRepos(env), [
  'myrisol0813-gif/elementera-coast',
  'myrisol0813-gif/coast-native-android',
]);
assert.equal(requireAllowedRepo(env, 'myrisol0813-gif/elementera-coast'), 'myrisol0813-gif/elementera-coast');
assert.throws(
  () => requireAllowedRepo(env, 'myrisol0813-gif/o3-reply-card-mcp'),
  (error) => error instanceof DevHandsError && error.type === 'repo_not_allowed' && error.status === 403,
);

// Risk labels remain useful for logs; they no longer gate execution.
assert.equal(githubActionPolicy('get_repo', {}).operationType, 'read');
assert.equal(githubActionPolicy('create_branch', { branch: 'work/test' }).operationType, 'write');
assert.deepEqual(
  githubActionPolicy('create_or_update_file', { path: 'functions/example.js', branch: 'work/test', content: 'ok' }),
  { action: 'create_or_update_file', operationType: 'write', label: 'create_or_update_file' },
);
assert.equal(githubActionPolicy('create_or_update_file', { path: 'functions/example.js', branch: 'main', content: 'ok' }).label, '直接推 main');
assert.equal(githubActionPolicy('create_or_update_file', { path: '.github/workflows/build.yml', branch: 'work/test', content: 'ok' }).label, '修改 workflow');
assert.equal(githubActionPolicy('delete_file', { path: 'x', branch: 'work/test' }).operationType, 'dangerous');
assert.equal(githubActionPolicy('merge_pr', { pr_number: 1 }).label, 'merge PR');
assert.equal(notionActionPolicy('read_root_page', {}).operationType, 'read');
assert.equal(notionActionPolicy('append_worklog', {}).operationType, 'write');
assert.deepEqual(notionActionPolicy('delete_page', {}), { action: 'delete_page', operationType: 'dangerous', label: '删除 Notion 页面' });

const ownerSelection = resolveDevHandToolSelection({ permission: 'owner', surface: 'main_chat' });
assert.ok(ownerSelection.tools.length > 0);
assert.equal(ownerSelection.tools.length, ownerSelection.records.length);
for (const name of ['github_read_file', 'github_create_or_update_file', 'github_delete_file', 'github_merge_pr', 'notion_append_worklog', 'ci_list_recent_runs']) {
  assert.ok(ownerSelection.tools.some((tool) => tool.function.name === name), `owner tool missing ${name}`);
}
assert.deepEqual(resolveDevHandToolSelection({ permission: 'visitor', surface: 'mailbox_visitor' }), { tools: [], records: [] });

const secretSource = [
  'github_pat_11AAABBBCCC',
  'ghp_1234567890abcdefghijkl',
  'Authorization: Bearer SECRET_VALUE_123',
  'Cookie: coast_session=secret-cookie',
  'COAST_GITHUB_TOKEN=something-private',
  '-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----',
].join('\n');
const redacted = redactSecretText(secretSource);
for (const secret of ['github_pat_11AAABBBCCC', 'SECRET_VALUE_123', 'secret-cookie', 'something-private', 'abc123']) {
  assert.equal(redacted.includes(secret), false, `redaction must remove ${secret}`);
}
const summary = safeDevSummary({
  repo: 'myrisol0813-gif/elementera-coast',
  token: 'do-not-log-me',
  nested: { Authorization: 'Bearer also-secret', result: 'ok' },
});
assert.equal(summary.includes('do-not-log-me'), false);
assert.equal(summary.includes('also-secret'), false);
assert.equal(summary.includes('elementera-coast'), true);

const shaped = devLogShape({
  repo: 'myrisol0813-gif/elementera-coast',
  path: 'functions/example.js',
  content: 'VERY_PRIVATE_CODE',
  body: 'PRIVATE_PR_BODY',
  logs: 'PRIVATE_JOB_LOGS',
  token: 'SECRET_TOKEN',
  nested: { text: 'PRIVATE_NOTION_TEXT', result: 'ok' },
});
const shapedText = JSON.stringify(shaped);
for (const hidden of ['VERY_PRIVATE_CODE', 'PRIVATE_PR_BODY', 'PRIVATE_JOB_LOGS', 'SECRET_TOKEN', 'PRIVATE_NOTION_TEXT']) {
  assert.equal(shapedText.includes(hidden), false, `dev-hand log shape must omit ${hidden}`);
}
assert.ok(shapedText.includes('myrisol0813-gif/elementera-coast'));
assert.ok(shapedText.includes('functions/example.js'));
assert.ok(shapedText.includes('[REDACTED]'));

const { readFile } = await import('node:fs/promises');
const githubSource = await readFile(new URL('../functions/github-dev-service.js', import.meta.url), 'utf8');
assert.ok(githubSource.includes("'X-GitHub-Api-Version': API_VERSION"));
assert.ok(githubSource.includes("accept: 'application/vnd.github.diff'"));
assert.ok(githubSource.includes('COAST_GITHUB_TOKEN'));
assert.equal(githubSource.includes('console.log(env'), false);
assert.equal(githubSource.includes('console.log(token'), false);

assert.ok(githubSource.includes("'list_releases'"), 'GitHub dev hand must support release reads');
assert.ok(githubSource.includes('githubReleaseAssetBytes'), 'GitHub dev hand must download release assets directly');

const workbench = await readFile(new URL('../functions/workbench-api.js', import.meta.url), 'utf8');
for (const path of ['/api/workbench/dev/self-check', '/api/workbench/dev/logs', '/api/workbench/dev/update']) {
  assert.ok(workbench.includes(path), `missing observer endpoint ${path}`);
}
for (const retiredPath of ['/api/workbench/dev/settings', '/api/workbench/dev/github', '/api/workbench/dev/notion']) {
  assert.equal(workbench.includes(retiredPath), false, `manual gate endpoint must stay retired: ${retiredPath}`);
}
assert.ok(workbench.includes('model_tools_default: true'));
assert.ok(workbench.includes('confirmation_required: false'));

for (const retiredUpdatePath of ['/api/workbench/dev/update/apk', '/api/workbench/dev/update/publish', '/api/workbench/dev/update/history']) {
  assert.equal(workbench.includes(retiredUpdatePath), false, `production updater route must stay absent: ${retiredUpdatePath}`);
}

const updateSource = await readFile(new URL('../functions/dev-hands-update.js', import.meta.url), 'utf8');
assert.ok(updateSource.includes("application_id: EXPECTED_NATIVE_APPLICATION_ID"));
assert.ok(updateSource.includes("available: false"));
assert.ok(updateSource.includes('production APK updater, signing and release distribution are not included'));
for (const forbidden of ["delivery_source: 'github_release'", 'list_releases', 'release_asset_id=', 'download_url']) {
  assert.equal(updateSource.includes(forbidden), false, `source update metadata must not restore ${forbidden}`);
}

const pwaSource = await readFile(new URL('../elementera-mcp/deploy-pages/public/features/dev-hands.js', import.meta.url), 'utf8');
for (const label of ['海岸开发手', '模型随身工具 · 观察窗', '开发手默认随身', '模型当前可见', '施工脚印', '版本与更新']) {
  assert.ok(pwaSource.includes(label), `PWA observer missing ${label}`);
}
for (const retiredSymbol of ['confirmationText', 'modeMutationLoading', 'constructionLoading', 'constructionMode', 'devSettings', 'devGithub', 'devNotion', 'pending_actions']) {
  assert.equal(pwaSource.includes(retiredSymbol), false, `PWA observer must not restore ${retiredSymbol}`);
}

console.log('dev-hands-direct: ok');
