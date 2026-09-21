import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { createEventSpine } from '../elementera-mcp/deploy-pages/public/core/event-spine.js';
import { createDaily } from '../elementera-mcp/deploy-pages/public/features/daily.js';

const window = new Window({ url: 'https://coast.test/' });
const { document } = window;
globalThis.window = window;
globalThis.document = document;
globalThis.FormData = window.FormData;
globalThis.requestAnimationFrame = (callback) => { callback(); return 1; };

document.body.innerHTML = '<div id="overlayRoot"></div>';
const overlayRoot = document.querySelector('#overlayRoot');
const longMomentText = `${'长长的海岸文字。'.repeat(90)}\n尾声。`;
const serverProfile = {
  xiaohan_avatar_dataurl: 'data:image/webp;base64,SEFOR0FO',
  myri_avatar_dataurl: 'data:image/webp;base64,TVlSSQ==',
  moment_cover_dataurl: 'data:image/webp;base64,Q09WRVI=',
  updated_at: '2026-09-01T00:00:00.000Z',
};

function makeStorage(cache = {}) {
  const local = {
    preferences: { xiaohanAvatar: '', myriAvatar: '' },
    daily: {
      cache: {
        moments: cache.moments || [],
        diaries: cache.diaries || [],
        syncedAt: 0,
      },
      momentCover: '',
    },
  };
  return {
    local,
    read() { return local; },
    update(mutator) { mutator(local); },
  };
}

function makeRouter(initial = { name: 'daily-home' }) {
  const renderers = new Map();
  const opens = [];
  let current = initial;
  let refreshes = 0;
  const listeners = new Set();
  return {
    renderers,
    opens,
    get refreshes() { return refreshes; },
    register(name, renderer) { renderers.set(name, renderer); },
    current() { return current; },
    async open(name, params = {}, options = {}) {
      const previous = current;
      current = { name, ...params };
      opens.push({ name, params, options });
      for (const listener of listeners) await listener({ reason: 'open', current, previous });
    },
    async refresh() { refreshes += 1; },
    async back() {},
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setCurrent(route) { current = route; },
  };
}

function jsonResponse(url) {
  const path = String(url);
  if (path.includes('/api/daily/moments')) return {
    moments: [{
      id: 'moment-long-1',
      date: '2026-09-01',
      author: 'api',
      source: 'chat_tool',
      status: 'published',
      text: longMomentText,
      created_at: '2026-09-01T00:00:00.000Z',
      updated_at: '2026-09-01T00:00:00.000Z',
      comments: [],
      like_count: 0,
      liked: false,
    }],
  };
  if (path.includes('/api/daily/diaries')) return {
    diaries: [{
      id: 'diary-server-1',
      date: '2026-09-01',
      author: 'api',
      source: 'chat_tool',
      text: '服务器新纸页。',
      weather: '有风',
      mood: '安静',
      created_at: '2026-09-01T00:00:00.000Z',
      updated_at: '2026-09-01T00:00:00.000Z',
    }],
  };
  if (path.includes('/api/daily/profile')) return { profile: serverProfile };
  throw new Error(`unexpected Daily request: ${path}`);
}

const pending = [];
globalThis.fetch = (url) => new Promise((resolve) => {
  pending.push({ url: String(url), resolve });
});

const storage = makeStorage();
const router = makeRouter();
const daily = createDaily({ storage, router, toast() {} });

assert.equal(daily.id, 'daily');
assert.equal(daily.priority, 70);
assert.equal(daily.mountOrder, 65);
for (const contract of ['ownsRoute', 'ownsEvent', 'handleEvent', 'mount', 'refresh', 'destroy', 'handleAction', 'startLoad']) {
  assert.equal(typeof daily[contract], 'function', `Daily owner misses ${contract}`);
}
assert.equal('sections' in daily, false, 'retired Daily section registry must not return');
assert.deepEqual(
  [...router.renderers.keys()],
  ['daily-home', 'moments', 'moments-compose', 'diary', 'diary-compose', 'daily-placeholder'],
);

const homeWhileLoading = router.renderers.get('daily-home')();
for (const label of ['碳硅圈', '日记', '宠物系统', '未来小组件']) {
  assert.match(homeWhileLoading.body, new RegExp(label), `Daily shell misses ${label} while syncing`);
}
for (const retired of ['一日总结', '相册', '草稿']) {
  assert.doesNotMatch(homeWhileLoading.body, new RegExp(retired), `Daily shell revived ${retired}`);
}
assert.equal(homeWhileLoading.subtitle, '正在同步日常岛');
assert.match(homeWhileLoading.body, /正在同步小组件/);
assert.equal(pending.length, 3, 'Daily loads moments, diaries, and owner profile');
assert.deepEqual(
  new Set(pending.map((item) => new URL(item.url, 'https://coast.test').pathname)),
  new Set(['/api/daily/moments', '/api/daily/diaries', '/api/daily/profile']),
);

const spine = createEventSpine({ root: document, owners: [daily] });
await spine.mount({ router, overlayRoot });
assert.deepEqual(spine.ownerIds, ['daily']);
assert.equal(overlayRoot.dataset.controllerOwner, 'daily');

for (const item of pending.splice(0)) {
  item.resolve(new Response(JSON.stringify(jsonResponse(item.url)), { status: 200, headers: { 'content-type': 'application/json' } }));
}
await daily.startLoad();
const homeSynced = router.renderers.get('daily-home')();
assert.equal(homeSynced.subtitle, '朋友圈与日记');
assert.doesNotMatch(homeSynced.body, /正在同步小组件|当前显示本机缓存/);
assert.equal(storage.local.preferences.xiaohanAvatar, serverProfile.xiaohan_avatar_dataurl, 'server avatar becomes local fast cache');
assert.equal(storage.local.daily.momentCover, serverProfile.moment_cover_dataurl, 'server cover becomes local fast cache');

const momentsSynced = router.renderers.get('moments')();
assert.match(momentsSynced.body, /class="moment-cover has-cover"/);
assert.doesNotMatch(momentsSynced.body, />更换封面</);
assert.doesNotMatch(momentsSynced.body, /点击设置封面/);
assert.match(momentsSynced.body, /保存在前端/);
assert.match(momentsSynced.body, /moment-text is-collapsed/);
assert.match(momentsSynced.body, /展开全文/);
await daily.handleAction('toggle-moment', { dataset: { id: 'moment-long-1' } });
const momentsExpanded = router.renderers.get('moments')();
assert.doesNotMatch(momentsExpanded.body, /moment-text is-collapsed/);
assert.match(momentsExpanded.body, /收起/);
assert.match(momentsExpanded.body, /评论/);
assert.match(momentsExpanded.body, /编辑/);
assert.match(momentsExpanded.body, /删除/);

const diarySynced = router.renderers.get('diary')();
assert.match(diarySynced.body, /diary-card-actions/);
assert.match(diarySynced.body, /class="is-delete"/);

globalThis.fetch = async (url) => new Response(JSON.stringify(jsonResponse(url)), {
  status: 200,
  headers: { 'content-type': 'application/json' },
});
for (const name of ['moments', 'diary', 'pets', 'widgets']) {
  await daily.handleEvent({ type: 'click' }, { eventType: 'click', namespace: 'daily', name, target: document.body });
}
assert.deepEqual(router.opens.slice(-4).map((entry) => entry.name), ['moments', 'diary', 'daily-placeholder', 'daily-placeholder']);
assert.equal(router.opens.at(-2).params.title, '宠物系统');
assert.equal(router.opens.at(-1).params.title, '未来小组件');

router.setCurrent({ name: 'outside-view' });
await daily.refresh({ navigation: { current: { name: 'outside-view' }, previous: { name: 'daily-home' } } });
assert.equal(overlayRoot.dataset.controllerOwner, undefined, 'Daily releases temporary overlay ownership after leaving its routes');
router.setCurrent({ name: 'daily-home' });
await daily.refresh({ navigation: { current: { name: 'daily-home' }, previous: { name: 'outside-view' } } });
assert.equal(overlayRoot.dataset.controllerOwner, 'daily');
await spine.unmount();
assert.equal(overlayRoot.dataset.controllerOwner, undefined);

const offlineRouter = makeRouter();
globalThis.fetch = async () => { throw new Error('offline-test'); };
const offlineDaily = createDaily({ storage: makeStorage(), router: offlineRouter, toast() {} });
const offlineInitial = offlineRouter.renderers.get('daily-home')();
for (const retired of ['海岸日历', '一日总结', '相册', '草稿']) assert.doesNotMatch(offlineInitial.body, new RegExp(retired));
await offlineDaily.startLoad();
const offlineHome = offlineRouter.renderers.get('daily-home')();
for (const label of ['碳硅圈', '日记', '宠物系统', '未来小组件']) {
  assert.match(offlineHome.body, new RegExp(label), `offline Daily shell loses ${label}`);
}
assert.match(offlineHome.body, /当前显示本机缓存/);
assert.match(offlineHome.body, /offline-test/);
const momentsEmpty = offlineRouter.renderers.get('moments')();
assert.match(momentsEmpty.body, /暂无动态/);
assert.match(momentsEmpty.body, /点击设置封面/);
assert.doesNotMatch(momentsEmpty.body, /更换封面/);

console.log('daily-owner: ok');
