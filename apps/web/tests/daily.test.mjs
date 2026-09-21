import assert from 'node:assert/strict';
import { isDailyApiPath, routeDailyApi } from '../functions/daily-api.js';
import { DAILY_MODEL_TOOLS, executeDailyModelTool } from '../functions/daily-model-tools.js';
import { DAILY_PROFILE_LIMITS, readDailyProfile, writeDailyProfile } from '../functions/daily-profile-store.js';
import { dailyMigrationIds, ensureDailySchema } from '../functions/daily-schema.js';
import {
  DailyStoreError,
  addMomentComment,
  createDiary,
  createMoment,
  deleteDiary,
  deleteMoment,
  deleteMomentComment,
  listDiaries,
  listMoments,
  patchDiary,
  patchMoment,
  setMomentLike,
} from '../functions/daily-store.js';
import { D1Database } from './d1-helper.mjs';

const db = new D1Database();
const env = { COAST_CHAT_DB: db };
const ownerSession = { exp: Date.now() + 60_000 };

for (const table of ['daily_summaries', 'daily_content_drafts', 'daily_album_items']) {
  db.database.exec(`CREATE TABLE ${table} (id TEXT PRIMARY KEY)`);
  db.database.prepare(`INSERT INTO ${table} (id) VALUES (?)`).run(`legacy-${table}`);
}
await ensureDailySchema(db);
const tableNames = new Set(db.database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
for (const table of ['daily_moments', 'daily_moment_comments', 'daily_moment_likes', 'daily_diaries', 'daily_profile']) assert.equal(tableNames.has(table), true, `${table} must exist`);
for (const table of ['daily_summaries', 'daily_content_drafts', 'daily_album_items']) assert.equal(tableNames.has(table), false, `${table} must be destructively retired`);
assert.deepEqual(dailyMigrationIds, ['daily-core-v2', 'daily-retire-summary-drafts-albums-v1', 'daily-profile-v1', 'daily-diary-tags-v1']);
const appliedMigrations = new Set(db.database.prepare('SELECT id FROM schema_migrations').all().map((row) => row.id));
for (const migration of dailyMigrationIds) assert.equal(appliedMigrations.has(migration), true);
for (const table of ['daily_moments', 'daily_diaries']) {
  const columns = new Set(db.database.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
  assert.equal(columns.has('image_refs_json'), false, `${table} fresh schema must not create image_refs_json`);
}
const diaryColumns = new Set(db.database.prepare('PRAGMA table_info(daily_diaries)').all().map((row) => row.name));
assert.equal(diaryColumns.has('tags_json'), true, 'daily_diaries must persist canonical tags');

const moment = await createMoment(db, { id: 'moment-core-1', date: '2026-09-01', text: '海风从窗口里吹进来。' });
assert.equal(moment.status, 'published');
assert.equal(moment.author, 'xiaohan');
assert.equal(moment.text, '海风从窗口里吹进来。');
assert.equal(Object.hasOwn(moment, 'image_refs'), false);
assert.equal(Object.hasOwn(moment, 'image'), false);
assert.equal((await listMoments(db)).length, 1);
const patchedMoment = await patchMoment(db, moment.id, { date: '2026-09-02', text: '海风又轻轻翻了一页。' });
assert.equal(patchedMoment.date, '2026-09-02');
assert.equal(patchedMoment.text, '海风又轻轻翻了一页。');
await assert.rejects(() => createMoment(db, { text: '', image_refs: ['https://coast.test/old.jpg'] }), (error) => error instanceof DailyStoreError && error.type === 'empty_moment');
await assert.rejects(() => patchMoment(db, moment.id, { image_refs: ['https://coast.test/old.jpg'] }), (error) => error instanceof DailyStoreError && error.type === 'empty_patch');

const commentedMoment = await addMomentComment(db, moment.id, { id: 'comment-core-1', author: 'xiaohan', text: 'Model Partner 看见了吗？' });
assert.equal(commentedMoment.comments.length, 1);
const likedMoment = await setMomentLike(db, moment.id, true, 'xiaohan');
assert.equal(likedMoment.liked, true);
assert.equal(likedMoment.like_count, 1);
const unlikedMoment = await setMomentLike(db, moment.id, false, 'xiaohan');
assert.equal(unlikedMoment.liked, false);
assert.equal(unlikedMoment.like_count, 0);
const withoutComment = await deleteMomentComment(db, moment.id, 'comment-core-1');
assert.equal(withoutComment.comments.length, 0);
await deleteMoment(db, moment.id);
assert.equal((await listMoments(db)).length, 0);

const diary = await createDiary(db, { id: 'diary-core-1', date: '2026-09-01', weather: '有风', mood: '安静', tags: ['海风', '  海风 ', '夜'], text: '今天把旧机器拆掉了一点。' });
assert.equal(diary.author, 'xiaohan');
assert.equal(diary.weather, '有风');
assert.deepEqual(diary.tags, ['海风', '夜']);
assert.equal(Object.hasOwn(diary, 'image_refs'), false);
assert.equal(Object.hasOwn(diary, 'image'), false);
assert.equal((await listDiaries(db)).length, 1);
await assert.rejects(() => createDiary(db, { date: '2026-09-01', text: '同一天第二张，没有声明追加。' }), (error) => error instanceof DailyStoreError && error.type === 'diary_conflict');
const appendedDiary = await createDiary(db, { id: 'diary-core-2', date: '2026-09-01', text: '明确追加的第二张。', tags: ['追加'], conflict_mode: 'append' });
assert.equal((await listDiaries(db)).length, 2);
const patchedDiary = await patchDiary(db, diary.id, { date: '2026-09-02', mood: '轻快', tags: ['回海', '金色'], text: '今天把旧机器拆干净了一点。' });
assert.equal(patchedDiary.date, '2026-09-02');
assert.equal(patchedDiary.mood, '轻快');
assert.deepEqual(patchedDiary.tags, ['回海', '金色']);
await assert.rejects(() => patchDiary(db, diary.id, { image_refs: ['https://coast.test/old.jpg'] }), (error) => error instanceof DailyStoreError && error.type === 'empty_patch');
await deleteDiary(db, appendedDiary.id);
assert.equal((await listDiaries(db)).length, 1);

const toolNames = DAILY_MODEL_TOOLS.map((tool) => tool.function.name);
assert.deepEqual(toolNames, ['create_moment', 'create_diary', 'moment_comment', 'moment_like']);
for (const tool of DAILY_MODEL_TOOLS) assert.equal(Object.hasOwn(tool.function.parameters.properties, 'image_refs'), false);
assert.equal(DAILY_MODEL_TOOLS.find((tool) => tool.function.name === 'create_diary').function.parameters.properties.tags.type, 'array');
assert.match(DAILY_MODEL_TOOLS.find((tool) => tool.function.name === 'create_moment').function.description, /发碳硅圈|发朋友圈|写动态/);
assert.match(DAILY_MODEL_TOOLS.find((tool) => tool.function.name === 'create_diary').function.description, /写进日记|记到日记|存成日记/);

const toolMomentCall = { id: 'call-moment-direct-1', function: { name: 'create_moment', arguments: JSON.stringify({ text: 'Model Partner 直接写入的正式动态。', date: '2026-09-02' }) } };
const toolContext = { model: 'openai/gpt-5.6', conversation_id: 'conversation-radio-1', source_turn_id: 'turn-radio-1', tool_call_id: 'call-moment-direct-1' };
const toolMoment = await executeDailyModelTool(db, toolMomentCall, toolContext);
assert.equal(toolMoment.kind, 'moment');
assert.equal(toolMoment.record_id, toolMoment.moment.id);
assert.equal(toolMoment.where_to_find, '小组件 > 碳硅圈');
assert.equal(toolMoment.moment.author, 'api');
assert.equal(toolMoment.moment.status, 'published');
assert.equal(Object.hasOwn(toolMoment.moment, 'image_refs'), false);
const toolMomentRetry = await executeDailyModelTool(db, toolMomentCall, toolContext);
assert.equal(toolMomentRetry.moment.id, toolMoment.moment.id);
assert.equal(db.database.prepare('SELECT COUNT(*) AS count FROM daily_moments WHERE tool_call_id = ?').get('call-moment-direct-1').count, 1);

const toolDiary = await executeDailyModelTool(db, { id: 'call-diary-direct-1', function: { name: 'create_diary', arguments: JSON.stringify({ text: 'Model Partner 的正式日记。', date: '2026-09-01', tags: ['工具', '海岸'] }) } }, {
  model_label: 'GPT-5.6 Coast', conversation_id: 'conversation-main-1', source_turn_id: 'turn-main-1', tool_call_id: 'call-diary-direct-1',
});
assert.equal(toolDiary.kind, 'diary');
assert.equal(toolDiary.where_to_find, '小组件 > 日记');
assert.equal(toolDiary.diary.author, 'api');
assert.deepEqual(toolDiary.diary.tags, ['工具', '海岸']);
assert.equal(Object.hasOwn(toolDiary.diary, 'image_refs'), false);
const toolComment = await executeDailyModelTool(db, { function: { name: 'moment_comment', arguments: JSON.stringify({ moment_id: toolMoment.moment.id, text: '我看见了。' }) } }, { model_label: 'GPT-5.6 Coast' });
assert.equal(toolComment.moment.comments.at(-1).text, '我看见了。');
const toolLike = await executeDailyModelTool(db, { function: { name: 'moment_like', arguments: JSON.stringify({ moment_id: toolMoment.moment.id, liked: true }) } }, { model_label: 'GPT-5.6 Coast' });
assert.equal(toolLike.moment.liked, true);

for (const path of ['/api/daily/summaries', '/api/daily/summary/range', '/api/daily/summary/run', '/api/daily/summary/commit', '/api/daily/drafts', '/api/daily/albums']) {
  assert.equal(isDailyApiPath(path), false, `${path} must not be routed as Daily`);
  const response = await routeDailyApi(new Request(`https://coast.test${path}`), env, ownerSession);
  assert.equal(response.status, 404);
}
assert.equal(isDailyApiPath('/api/daily/moments'), true);
assert.equal(isDailyApiPath('/api/daily/diaries'), true);
assert.equal(isDailyApiPath('/api/daily/profile'), true);

const initialProfile = await readDailyProfile(db);
assert.equal(initialProfile.xiaohan_avatar_dataurl, '');
const savedProfile = await writeDailyProfile(db, {
  xiaohan_avatar_dataurl: 'data:image/webp;base64,SEFOR0FO',
  myri_avatar_dataurl: 'data:image/webp;base64,TVlSSQ==',
  moment_cover_dataurl: 'data:image/webp;base64,Q09WRVI=',
});
assert.equal(savedProfile.moment_cover_dataurl, 'data:image/webp;base64,Q09WRVI=');
assert.equal((await readDailyProfile(db)).myri_avatar_dataurl, 'data:image/webp;base64,TVlSSQ==');
await assert.rejects(() => writeDailyProfile(db, { xiaohan_avatar_dataurl: 'data:image/webp;base64,' + 'A'.repeat(DAILY_PROFILE_LIMITS.avatarDataUrl) }), (error) => error instanceof DailyStoreError && error.type === 'daily_profile_image_too_large');
const unauthProfile = await routeDailyApi(new Request('https://coast.test/api/daily/profile'), env, null);
assert.equal(unauthProfile.status, 401);
const apiProfilePut = await routeDailyApi(new Request('https://coast.test/api/daily/profile', {
  method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ profile: { moment_cover_dataurl: 'data:image/webp;base64,TkVXQ09WRVI=' } }),
}), env, ownerSession);
assert.equal(apiProfilePut.status, 200);
assert.equal((await apiProfilePut.json()).profile.moment_cover_dataurl, 'data:image/webp;base64,TkVXQ09WRVI=');

const apiCreateMoment = await routeDailyApi(new Request('https://coast.test/api/daily/moments', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'moment-api-1', date: '2026-09-03', text: '网页端正式动态。', image_refs: ['https://coast.test/ignored.jpg'] }),
}), env, ownerSession);
assert.equal(apiCreateMoment.status, 201);
const apiMoment = (await apiCreateMoment.json()).moment;
assert.equal(apiMoment.status, 'published');
assert.equal(Object.hasOwn(apiMoment, 'image_refs'), false);
assert.equal(Object.hasOwn(apiMoment, 'image'), false);
const apiListMoment = await routeDailyApi(new Request('https://coast.test/api/daily/moments'), env, ownerSession);
const apiMoments = (await apiListMoment.json()).moments;
assert.equal(apiMoments.some((entry) => Object.hasOwn(entry, 'image_refs') || Object.hasOwn(entry, 'image')), false);

const apiCreateDiary = await routeDailyApi(new Request('https://coast.test/api/daily/diaries', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'diary-api-1', date: '2026-09-04', text: '网页端正式日记。', tags: ['API', '同步'], image_refs: ['https://coast.test/ignored.jpg'] }),
}), env, ownerSession);
assert.equal(apiCreateDiary.status, 201);
const apiDiary = (await apiCreateDiary.json()).diary;
assert.deepEqual(apiDiary.tags, ['API', '同步']);
assert.equal(Object.hasOwn(apiDiary, 'image_refs'), false);
assert.equal(Object.hasOwn(apiDiary, 'image'), false);

console.log('daily: ok');
