import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDaily } from '../elementera-mcp/deploy-pages/public/features/daily.js';

function makeStorage(myriAvatar = '') {
  const local = {
    preferences: { xiaohanAvatar: '', myriAvatar },
    daily: { cache: { moments: [], diaries: [], syncedAt: 0 }, momentCover: '' },
  };
  return {
    local,
    read() { return local; },
    update(mutator) { mutator(local); },
  };
}

function makeRouter() {
  const renderers = new Map();
  return {
    register(name, renderer) { renderers.set(name, renderer); },
    current() { return { name: 'moments' }; },
    async refresh() {},
    async open() {},
    async back() {},
    renderers,
  };
}

function makeChat(initialAvatar = '') {
  let profile = { assistant_avatar_dataurl: initialAvatar };
  const updates = [];
  return {
    updates,
    getProfile() { return profile; },
    async updateProfile(patch) {
      updates.push(patch);
      profile = { ...profile, ...patch };
      return profile;
    },
  };
}

const legacyAvatar = 'data:image/webp;base64,TEVHQUNZ';
const canonicalAvatar = 'data:image/webp;base64,Q0FOT05JQ0FM';
const profileResponse = {
  xiaohan_avatar_dataurl: '',
  myri_avatar_dataurl: legacyAvatar,
  moment_cover_dataurl: '',
  updated_at: '2026-09-03T00:00:00.000Z',
};

globalThis.fetch = async (input) => {
  const path = new URL(String(input), 'https://coast.test').pathname;
  if (path === '/api/daily/moments') return new Response(JSON.stringify({ moments: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  if (path === '/api/daily/diaries') return new Response(JSON.stringify({ diaries: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  if (path === '/api/daily/profile') return new Response(JSON.stringify({ profile: profileResponse }), { status: 200, headers: { 'content-type': 'application/json' } });
  throw new Error(`unexpected request: ${path}`);
};

const migratingStorage = makeStorage('stale-local-avatar');
const migratingChat = makeChat('');
const migratingRouter = makeRouter();
const migratingDaily = createDaily({ storage: migratingStorage, router: migratingRouter, toast() {}, chat: migratingChat });
await migratingDaily.startLoad();
assert.deepEqual(migratingChat.updates, [{ assistant_avatar_dataurl: legacyAvatar }], 'legacy Daily Model Partner avatar should be promoted once to chat profile');
assert.equal(migratingStorage.local.preferences.myriAvatar, 'stale-local-avatar', 'Daily must not keep writing a second local Model Partner avatar owner');
assert.match(migratingRouter.renderers.get('moments')().body, /TEVHQUNZ/, 'migrated canonical avatar should render in Daily');

const canonicalStorage = makeStorage('stale-local-avatar');
const canonicalChat = makeChat(canonicalAvatar);
const canonicalRouter = makeRouter();
const canonicalDaily = createDaily({ storage: canonicalStorage, router: canonicalRouter, toast() {}, chat: canonicalChat });
await canonicalDaily.startLoad();
assert.deepEqual(canonicalChat.updates, [], 'existing canonical chat avatar must win over legacy Daily data');
assert.match(canonicalRouter.renderers.get('moments')().body, /Q0FOT05JQ0FM/, 'Daily should render the canonical chat avatar');
assert.doesNotMatch(canonicalRouter.renderers.get('moments')().body, /TEVHQUNZ/, 'legacy Daily avatar must not override canonical chat avatar');

const profileSource = await readFile(new URL('../elementera-mcp/deploy-pages/public/features/daily/daily-profile.js', import.meta.url), 'utf8');
assert.match(profileSource, /chat\.updateProfile\(\{ assistant_avatar_dataurl: image \}\)/, 'Model Partner avatar writes must go through chat profile');
assert.doesNotMatch(profileSource, /client\.saveProfile\(\{ \[field\]: image \}\)[\s\S]*field === 'myri_avatar_dataurl'/, 'Model Partner avatar must not be written back to Daily profile');

console.log('avatar-owner: ok');
