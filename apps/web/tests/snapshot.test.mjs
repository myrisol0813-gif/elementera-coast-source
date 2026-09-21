import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { redactSnapshot } from '../functions/snapshot-api.js';

const redacted = redactSnapshot({
  ordinary: '海岸内容保留',
  token: 'super-secret-token',
  nested: {
    authorization_header: 'Bearer abcdefghijklmnopqrstuvwxyz',
    note: 'COAST_GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz123456',
    cookie: '__Host-coast_session=should-not-leak',
  },
  list: [{ secret: 'hidden' }, { text: '普通文本' }],
});

assert.equal(redacted.ordinary, '海岸内容保留');
assert.equal(redacted.token, '[REDACTED]');
assert.equal(redacted.nested.authorization_header, '[REDACTED]');
assert.equal(redacted.nested.cookie, '[REDACTED]');
assert.doesNotMatch(redacted.nested.note, /ghp_|abcdefghijklmnopqrstuvwxyz123456/);
assert.equal(redacted.list[0].secret, '[REDACTED]');
assert.equal(redacted.list[1].text, '普通文本');

console.log('snapshot-redaction: ok');


const source = await readFile(new URL('../functions/snapshot-api.js', import.meta.url), 'utf8');
assert.match(source, /global_excerpt/);
assert.match(source, /global_excerpt_revisions/);
assert.match(source, /model_echo_summaries/);

assert.match(source, /write_guidance|globalExcerpt/);

assert.match(source, /mailbox_owner_summary/);
assert.match(source, /sealed_visitor_content_excluded/);
assert.match(source, /mailbox_message_bodies/);
assert.match(source, /mailbox_passphrase_verifiers/);
assert.match(source, /message_bodies_included:\s*false/);
assert.match(source, /credential_material_included:\s*false/);
assert.doesNotMatch(source, /tableRows\(db,\s*['"]mailbox_messages['"]/);
