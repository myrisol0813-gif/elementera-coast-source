import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const apiSource = await readFile(new URL('../functions/daily-api.js', import.meta.url), 'utf8');
const clientSource = await readFile(new URL('../elementera-mcp/deploy-pages/public/features/daily-client.js', import.meta.url), 'utf8');

assert.match(apiSource, /const DAILY_COMMENT_BUILD = 'daily-comment-33'/);
assert.match(apiSource, /function streamModelPartnerComment\(env, id, value\)/);
assert.match(apiSource, /new ReadableStream\(/);
assert.match(apiSource, /encodeSseEvent\('ready'/);
assert.match(apiSource, /encodeSseEvent\('result'/);
assert.match(apiSource, /encodeSseEvent\('error'/);
assert.match(apiSource, /Content-Type': 'text\/event-stream; charset=utf-8'/);
assert.match(apiSource, /return streamModelPartnerComment\(env, id, value\)/);
assert.doesNotMatch(apiSource, /DAILY_RUNTIME_PATH|runtimeProbe\(/);

assert.match(clientSource, /Accept: 'text\/event-stream'/);
assert.match(clientSource, /parseSseEventBlock/);
assert.match(clientSource, /parsed\.event === 'result'/);
assert.match(clientSource, /parsed\.event === 'error'/);
assert.match(clientSource, /type: 'stream_incomplete'/);
assert.doesNotMatch(clientSource, /DAILY_RUNTIME_URL|probeDailyRuntime|preflight_/);
assert.doesNotMatch(clientSource, /AbortController|setTimeout|timeout/i);

console.log('daily-comment-stream: ok');