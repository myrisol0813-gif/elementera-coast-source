import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('../elementera-mcp/deploy-pages/public/rest-box/art/v1/',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('fidelity.json',root),'utf8'));
for(const {path,blob} of manifest.expected){
 const bytes=await readFile(new URL(path,root));
 assert.equal(createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex'),blob,path);
}
console.log('original SVG blobs pinned: '+manifest.expected.length);
