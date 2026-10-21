import assert from 'node:assert/strict';
import { D1Database } from './d1-helper.mjs';
import {
  executeRegisteredTool, listRegisteredMcpTools, listRegisteredTools, resolveToolSelection,
} from '../functions/tool-registry.js';
import { listCalendarEntries } from '../functions/calendar-store.js';
import { createLibraryBook, listLibraryNotes } from '../functions/tidal-library.js';
import { VOICE_LIMITS } from '../functions/voice-clips.js';

const db = new D1Database();
const names = new Set(listRegisteredMcpTools().map(x => x.tool_key));
const keys = ['calendar.list','calendar.create','calendar.update','calendar.delete','library.books','library.read','library.notes','library.write','voice.create'];
for (const key of keys) assert.ok(names.has(key), 'missing MCP tool ' + key);
const guest = listRegisteredTools({ permission: 'visitor', surface: 'mailbox_visitor', visitorId: 'guest-fixture' });
assert.ok(keys.every(k => !guest.some(t => t.tool_key === k)), 'private tools must not be guest-visible');
const main = resolveToolSelection({ permission: 'owner', surface: 'main_chat' });
const visible = new Set(main.modelVisibleToolRecords.map(t => t.tool_key));
for (const key of keys) assert.ok(visible.has(key), 'missing model-visible tool ' + key);
const ctx = { permission: 'owner', surface: 'main_chat' };
const ev = await executeRegisteredTool(db,'calendar.create',{ day:'2030-06-12', title:'Synthetic event', kind:'event' },ctx);
assert.equal(ev.author,'assistant');
assert.equal((await listCalendarEntries(db,{month:'2030-06'})).length,1);
const book = await createLibraryBook(db,{title:'Test reader',format:'txt',chapters:[{title:'A',body:'first.\n\nsecond.'}]});
const read = await executeRegisteredTool(db,'library.read',{book_id:book.id,chapter_index:0,start_paragraph:0,limit:1},ctx);
assert.equal(read.paragraphs.length,1);
const note = await executeRegisteredTool(db,'library.write',{action:'create',book_id:book.id,kind:'reflection',body:'synthetic'},ctx);
assert.equal(note.note.author,'assistant');
assert.equal((await listLibraryNotes(db,{book_id:book.id})).length,1);
assert.equal(VOICE_LIMITS.text_chars,2400);
assert.equal(VOICE_LIMITS.paragraphs_per_clip,40);
assert.equal(VOICE_LIMITS.clips_per_message,12);
assert.equal(VOICE_LIMITS.audio_bytes,4*1024*1024);
console.log('source-mcp-voice: ok (owner-only tools, registry, archive/limits contract)');
