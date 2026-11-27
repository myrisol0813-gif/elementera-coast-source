import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {newAppearance,newHousehold,editAppearance,restoreHousehold,poseColors,ACTIONS} from '../elementera-mcp/deploy-pages/public/rest-box/creature-state.mjs';
import {wolfEarPaths,snakeTailPaths} from '../elementera-mcp/deploy-pages/public/rest-box/creature-renderer.mjs';
const read=async p=>JSON.parse(await readFile(new URL('../elementera-mcp/deploy-pages/public/rest-box/art/v1/'+p,import.meta.url),'utf8'));
const {bodies}=await read('creatures/appearance.json'),index=await read('creatures/index.json');
assert.equal(Object.keys(bodies).length,16);
for(const b of index.bodies){const d=bodies[b.id];assert.deepEqual(d.actions,ACTIONS);assert.ok(d.palettes[d.defaultPalette]);assert.ok(Object.keys(d.slots).length>0);for(const p of Object.keys(d.palettes)){const a={...newAppearance(bodies,b.id),palette:p};for(const c of Object.values(poseColors(d,a)))assert.match(c,/^#[0-9a-f]{6}$/i)}}
const h=newHousehold(bodies),a=editAppearance(h,bodies,'human',{bodyId:'fish'}),b=editAppearance(a,bodies,'human',{palette:'black',colors:{eye:'#FFDDAA'}});
assert.equal(b.model.bodyId,'wolf');assert.equal(h.human.bodyId,'cat');assert.equal(poseColors(bodies.fish,b.human).eye,'#ffddaa');
assert.throws(()=>editAppearance(b,bodies,'human',{neck:'scarf'}));assert.throws(()=>editAppearance(b,bodies,'human',{colors:{fur:'#ffffff'}}));
assert.deepEqual(restoreHousehold(JSON.parse(JSON.stringify(b)),bodies),b);
assert.notEqual(wolfEarPaths('idle').outer,wolfEarPaths('sad').outer);assert.notEqual(wolfEarPaths('sleep').inner,wolfEarPaths('cheer').inner);
assert.deepEqual(snakeTailPaths(4,17).anchor,[248,174]);assert.notEqual(snakeTailPaths(0,0).body,snakeTailPaths(4,17).body);
console.log('creature appearance: 16 bodies, palettes, role isolation and pose geometry checked');
