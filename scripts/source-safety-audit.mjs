#!/usr/bin/env node
// Public source safety gate. Reports rule and path, never matched secret content.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();

const filenames = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', cwd: root }).split('\0').filter(Boolean);
const textExt = new Set(['.js','.mjs','.cjs','.ts','.tsx','.kt','.kts','.md','.json','.xml','.yml','.yaml','.toml','.sh','.html','.css','.properties','.txt','.gradle']);
const rules = [
  ['private_identity', /(?:Myraes|Myrisol|千峰寒|小寒|myrisol0813-gif|0CCSU9rcucUCDAHkBgRL)/i],
  ['private_production_origin', /https?:\/\/(?:app\.)?elementeracoast\.com\b/i],
  ['credential_value', /(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]{18,}|(?:sk-[A-Za-z0-9_-]{25,})|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['auth_bearer', /\bAuthorization:\s*Bearer\s+(?!EXAMPLE|REDACTED)[A-Za-z0-9._-]{24,}/i],
];
const exceptions = new Set([
  'docs/SANITIZATION_REPORT.md', // Immutable baseline: discusses historical private tokens, not production config.
  'scripts/source-safety-audit.mjs', // Rules necessarily contain sensitive marker names.
]);
const redactionTestFixtures = new Map([
  ['apps/web/tests/snapshot.test.mjs', ['ghp_abcdefghijklmnopqrstuvwxyz123456']],
  ['apps/web/tests/dev-hands.test.mjs', ['ghp_1234567890abcdefghijkl', '-----BEGIN PRIVATE KEY-----']],
]);
const failures = [];
let scanned = 0;
for (const path of filenames) {
  if (exceptions.has(path)) continue;
  if (!(textExt.has(extname(path)) || path.endsWith('.env.example') || path.endsWith('.gitignore'))) continue;
  const bytes = readFileSync(resolve(root, path));
  if (bytes.includes(0) || bytes.length > 8 * 1024 * 1024) continue;
  let body = bytes.toString('utf8');
  const synthetic = redactionTestFixtures.get(path) || [];
  for (const fixture of synthetic) {
    if (!body.includes(fixture)) failures.push({ category: 'missing_expected_redaction_fixture', path });
    else body = body.replaceAll(fixture, '[SYNTHETIC-REDACTION-TEST-FIXTURE]');
  }
  scanned++;
  for (const [name, rule] of rules) {
    if (rule.test(body)) failures.push({ category: name, path });
  }
}
if (failures.length) {
  for (const f of failures) console.error('PUBLIC_SOURCE_AUDIT_FAIL', f.category, f.path);
  process.exitCode = 1;
} else {
  console.log('public-source safety scan passed;', scanned, 'tracked text files reviewed; known historical report excluded');
}
