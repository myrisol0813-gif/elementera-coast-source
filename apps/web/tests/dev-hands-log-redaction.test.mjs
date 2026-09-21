import assert from 'node:assert/strict';
import { devLogShape } from '../functions/dev-hands-log-shape.js';
import { redactSecretText } from '../functions/dev-hands-store.js';

const ciLog = [
  'before',
  'env:',
  '  JAVA_HOME: /opt/java',
  '  PRIVATE_BUILD_SECRET_PATH: /tmp/private-build-secret.bin',
  '  PRIVATE_BUILD_SECRET: extremely-secret',
  '##[endgroup]',
  'Authorization: Bearer token-value',
  'Cookie: coast_session=session-value',
  'after',
].join('\n');
const safeLog = redactSecretText(ciLog, 20_000);
assert.ok(safeLog.includes('before'));
assert.ok(safeLog.includes('after'));
assert.ok(safeLog.includes('[ENV BLOCK REDACTED]'));
for (const hidden of ['/opt/java', '/tmp/private-build-secret.bin', 'extremely-secret', 'token-value', 'session-value']) {
  assert.equal(safeLog.includes(hidden), false, `CI log redaction must remove ${hidden}`);
}

const shaped = JSON.stringify(devLogShape({
  repo: 'myrisol0813-gif/elementera-coast',
  path: 'functions/example.js',
  content: 'private source body',
  diff: 'private unified diff',
  bytes: new Uint8Array([1, 2, 3, 4]),
  token: 'private-token',
}));
assert.ok(shaped.includes('myrisol0813-gif/elementera-coast'));
assert.ok(shaped.includes('functions/example.js'));
for (const hidden of ['private source body', 'private unified diff', 'private-token']) {
  assert.equal(shaped.includes(hidden), false, `construction log shape must remove ${hidden}`);
}
assert.ok(shaped.includes('[REDACTED]'));
assert.ok(shaped.includes('[omitted:'));

console.log('dev-hands-log-redaction: ok');
