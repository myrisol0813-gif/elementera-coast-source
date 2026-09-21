import assert from 'node:assert/strict';
import { formalChatRequestSettings, landingRequestSettings } from '../functions/chat-router.js';
import { readDailyProfile, writeDailyProfile } from '../functions/daily-profile-store.js';
import { addMomentComment, createMoment } from '../functions/daily-store.js';
import { roomAccess } from '../functions/surface-access-rules.js';
import { D1Database } from './d1-helper.mjs';

const db = new D1Database();

assert.equal(formalChatRequestSettings({ recentTurns: 13 }).recentTurns, 13);
assert.equal(landingRequestSettings({ recentTurns: '17' }).recentTurns, 17);
assert.equal(formalChatRequestSettings({ recentTurns: '' }).recentTurns, 8);
assert.equal(formalChatRequestSettings({ recentTurns: 'abc' }).recentTurns, 8);
assert.equal(formalChatRequestSettings({ recentTurns: 0 }).recentTurns, 1);
assert.equal(formalChatRequestSettings({ recentTurns: 99 }).recentTurns, 99);
assert.equal(formalChatRequestSettings({ recentTurns: 250 }).recentTurns, 250);
assert.equal(formalChatRequestSettings({ recentTurns: 2.9 }).recentTurns, 2);
assert.equal(roomAccess('main_chat').recentMessages, null);
assert.equal(roomAccess('landing').recentMessages, null);
assert.equal(roomAccess('mailbox_visitor', { permission: 'visitor', visitorId: 'regression-visitor' }).recentMessages, 8);

const initialDailyProfile = await readDailyProfile(db);
assert.equal(initialDailyProfile.model_partner_display_name, '另一位屋主');
const namedProfile = await writeDailyProfile(db, { model_partner_display_name: '  Model Partner\nModel Partner  ' });
assert.equal(namedProfile.model_partner_display_name, 'Model Partner Model Partner');
const fallbackProfile = await writeDailyProfile(db, { model_partner_display_name: '   ' });
assert.equal(fallbackProfile.model_partner_display_name, '另一位屋主');

const moment = await createMoment(db, {
  id: 'bugfix-polish-moment',
  date: '2026-09-05',
  text: '验证碳硅圈模型与 token 安全落库。',
});
const withComment = await addMomentComment(db, moment.id, {
  id: 'bugfix-polish-comment',
  author: 'model_partner',
  text: '我在这里。',
  model_id: 'openai/gpt-5.6',
  usage: {
    prompt_tokens: 120,
    completion_tokens: 34,
    reasoning_tokens: 8,
    cached_tokens: 50,
    total_tokens: 154,
    api_key: 'SHOULD_NOT_PERSIST',
    provider_secret: 'SHOULD_NOT_PERSIST',
    cost: 999,
  },
});
const comment = withComment.comments.find((item) => item.id === 'bugfix-polish-comment');
assert.deepEqual(comment.usage, {
  prompt_tokens: 120,
  completion_tokens: 34,
  reasoning_tokens: 8,
  cached_tokens: 50,
  total_tokens: 154,
});
assert.equal(comment.model_id, 'openai/gpt-5.6');

const stored = db.database.prepare('SELECT model_id, usage_json FROM daily_moment_comments WHERE id = ?').get('bugfix-polish-comment');
assert.equal(stored.model_id, 'openai/gpt-5.6');
assert.deepEqual(JSON.parse(stored.usage_json), comment.usage);
assert.doesNotMatch(stored.usage_json, /api[_-]?key|secret|cookie|authorization|cost/i);

const dailyCommentColumns = new Set(db.database.prepare('PRAGMA table_info(daily_moment_comments)').all().map((row) => row.name));
assert.equal(dailyCommentColumns.has('usage_json'), true);
const dailyProfileColumns = new Set(db.database.prepare('PRAGMA table_info(daily_profile)').all().map((row) => row.name));
assert.equal(dailyProfileColumns.has('model_partner_display_name'), true);

console.log('bugfix-polish: ok');
