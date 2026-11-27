import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildCatalogue} from '../elementera-mcp/deploy-pages/public/rest-box/room-state.mjs';
import {shiftInk} from '../elementera-mcp/deploy-pages/public/rest-box/room-renderer.mjs';
import {newHousehold,editAppearance,restoreHousehold} from '../elementera-mcp/deploy-pages/public/rest-box/creature-state.mjs';
const root=new URL('../elementera-mcp/deploy-pages/public/rest-box/art/v1/',import.meta.url);
const read=async p=>readFile(new URL(p,root),'utf8'), json=async p=>JSON.parse(await read(p));
const rooms=await Promise.all(['living','study','bedroom'].map(k=>json('rooms/'+k+'.json')));
const extra=await Promise.all(['afternoon','stationery'].map(k=>json('extras/'+k+'.json')));
const colors=await json('color-presets.json'),cat=buildCatalogue(rooms,extra,colors);
assert.equal(Object.keys(cat.assets).length,55);
for(const a of Object.values(cat.assets)){
 assert.ok(Object.keys(a.slots).length>0,a.id);
 const svg=await read(a.file);
 for(const slot of Object.values(a.slots)){
  assert.match(slot.base,/^#[a-f0-9]{6}$/i);
  for(const c of slot.members??[])assert.ok(svg.includes(c),a.id+' missing '+c);
  for(const [id,cs] of Object.entries(slot.patterns??{})){const p=svg.match(new RegExp('<pattern id="'+id+'"[\\s\\S]*?</pattern>'))?.[0];assert.ok(p);for(const c of cs)assert.ok(p.includes(c))}
  assert.equal(shiftInk(slot.base,slot.base,slot.base),slot.base);
 }
 for(const p of a.presets)for(const k of Object.keys(p.values))assert.ok(Object.hasOwn(a.slots,k));
}
const badges=await json('accessories/badges.json');assert.equal(badges.items.length,5);
const {bodies}=await json('creatures/appearance.json'),h=newHousehold(bodies),n=editAppearance(h,bodies,'model',{badge:'gpt',badgeMode:'custom',badgeColor:'#b69b65',badgePlace:'head',badgeX:4,badgeSize:90});
assert.equal(n.human.badge,'none');assert.deepEqual(restoreHousehold(JSON.parse(JSON.stringify(n)),bodies),n);
assert.throws(()=>editAppearance(n,bodies,'model',{badgeSize:400}));
console.log('rest box palettes and badge contracts');
