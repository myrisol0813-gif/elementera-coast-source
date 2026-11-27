import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../elementera-mcp/deploy-pages/public/rest-box/art/v1');
const load=async p=>{assert.match(p,/^[a-zA-Z0-9_./-]+$/);assert(!p.split('/').includes('..'));return readFile(resolve(root,p),'utf8')};
const json=async p=>JSON.parse(await load(p));
const idx=await json('index.json');
const ids=new Set();
async function svg(p){const s=await load(p);assert.match(s,/<svg\b/);assert.match(s,/<\/svg>/);assert(!/<script\b|<foreignObject\b|\bon[a-z]+\s*=|@import|https?:\/\/(?!www\.w3\.org\/)/i.test(s),p+' unsafe content');return s}
for(const r of idx.rooms){const m=await json(r.manifest);await svg(m.environment);if(m.overlay)await svg(m.overlay);assert.equal(new Set(m.order).size,m.assets.length);assert.deepEqual(new Set(m.order),new Set(m.assets.map(a=>a.id)));for(const a of m.assets){assert(!ids.has(a.id));ids.add(a.id);await svg(a.file);assert(Number.isFinite(a.defaultPlacement.x));assert(Number.isFinite(a.defaultPlacement.y))}}
for(const p of idx.extras){const m=await json(p);for(const a of m.assets){assert(!ids.has(a.id));ids.add(a.id);await svg(a.file)}}
assert.equal(ids.size,55);
const c=await json(idx.creatures);assert.equal(c.bodies.length,16);assert.equal(new Set(c.bodies.map(a=>a.id)).size,16);for(const a of c.bodies)await svg(a.file);
await json(idx.accessories);await json(idx.props.anchors);assert.equal(idx.props.items.length,5);for(const a of idx.props.items)await svg(a.file);
const p=await json(idx.colorPresets);assert.equal(p.assets['bedroom-slippers'].presets[1].values.upper,'#d7b166');
console.log('Rest box art: 55 furniture, 16 creature bodies, 5 props, 3 rooms checked');
