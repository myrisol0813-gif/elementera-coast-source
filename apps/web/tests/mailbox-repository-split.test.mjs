import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entryPath = resolve(root, 'functions/mailbox-repository.js');
const entry = await readFile(entryPath, 'utf8');
const lines = entry.split('\n').length;
assert.ok(lines <= 180, `mailbox-repository.js regrew to ${lines} lines`);
assert.doesNotMatch(entry, /function visitorFromRow\s*\(/);
assert.doesNotMatch(entry, /INSERT INTO mailbox_messages/);
assert.doesNotMatch(entry, /mailbox_memory_pockets SET/);

const expectedModules = [
  'mailbox-db.js',
  'mailbox-mappers.js',
  'mailbox-visitor-store.js',
  'mailbox-message-store.js',
  'mailbox-notebook-store.js',
  'mailbox-soil-store.js',
  'mailbox-pocket-store.js',
  'mailbox-owner-store.js',
];
const sources = {};
for (const name of expectedModules) {
  sources[name] = await readFile(resolve(root, 'functions/mailbox-repository', name), 'utf8');
}
assert.match(sources['mailbox-mappers.js'], /export function visitorFromRow/);
assert.match(sources['mailbox-visitor-store.js'], /export async function createMailboxVisitor/);
assert.match(sources['mailbox-message-store.js'], /export async function writeVisitorMailboxMessage/);
assert.match(sources['mailbox-notebook-store.js'], /export async function listVisitorNotebook/);
assert.match(sources['mailbox-soil-store.js'], /export async function readMailboxThoughtSoil/);
assert.match(sources['mailbox-pocket-store.js'], /export async function resolveMailboxMemoryPocket/);
assert.match(sources['mailbox-owner-store.js'], /export async function claimMailboxPatrol/);
assert.match(sources['mailbox-owner-store.js'], /await db\.batch\(statements\)/, 'owner reply must remain one batch transaction');

const api = await import(`${pathToFileURL(entryPath).href}?split=${Date.now()}`);
for (const name of [
  'MailboxRepositoryError',
  'createMailboxVisitor', 'findMailboxVisitorByLookup', 'getMailboxVisitor', 'touchMailboxVisitor',
  'listMailboxMessages', 'writeVisitorMailboxMessage', 'editVisitorMailboxMessage',
  'deleteMailboxMessage', 'deleteMailboxVisitorAccount', 'mailboxStatusForVisitor',
  'listVisitorNotebook', 'archiveVisibleNotebookEntry',
  'readMailboxThoughtSoil', 'listMailboxMemoryPockets',
  'claimMailboxPatrol', 'writeMailboxReply', 'resolveMailboxMemoryPocket',
  'completeMailboxPatrol', 'listOwnerMailboxVisitors', 'ownerMailboxSummary',
]) assert.ok(name in api, `mailbox-repository.js lost public export ${name}`);

console.log(`mailbox-repository-split: ok (${lines} lines)`);
