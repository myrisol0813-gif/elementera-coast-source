import test from 'node:test';
import assert from 'node:assert/strict';
import {buildOfflineArchive} from '../elementera-mcp/deploy-pages/public/features/offline-archive.js';
test('offline archive keeps all variants, escapes text and restores media bytes',async()=>{
  const archive={chat:{conversations:[{conversation:{id:'c',title:'<script>x</script>'},history:{turns:[{user:{variants:[{content:'<script>x</script>',attachments:[{id:'a'}]},{content:'second branch'}]},assistant:{variantsByUserVariant:{0:[{content:'reply'}],1:[{content:'other reply'}]}}}]}}]},attachments:{payloads:[{id:'a',conversation_id:'c',name:'../../a.png',mime:'image/png',size:3,data_base64:'AQID'}]},voice:{payloads:[{id:'v',chunks:['BAU=']}]},excluded_modules:['credentials']};
  const {blob,warnings,mediaCount}=buildOfflineArchive(archive);
  assert.equal(mediaCount,2);assert.deepEqual(warnings,[]);
  const bytes=new Uint8Array(await blob.arrayBuffer()),dv=new DataView(bytes.buffer),files=new Map();let pos=0;
  while(dv.getUint32(pos,true)===0x04034b50){
    const n=dv.getUint16(pos+26,true),len=dv.getUint32(pos+18,true),start=pos+30+n;
    files.set(new TextDecoder().decode(bytes.slice(pos+30,start)),bytes.slice(start,start+len));pos=start+len;
  }
  assert.deepEqual([...files.get('media/1.png')],[1,2,3]);
  assert.deepEqual([...files.get('media/2.mp3')],[4,5]);
  const html=new TextDecoder().decode(files.get('chats/1.html'));
  assert.match(html,/second branch/);assert.match(html,/other reply/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.match(html,/\.\.\/media\/1.png/);
  assert.equal(JSON.parse(new TextDecoder().decode(files.get('manifest.json'))).restore_supported,false);
});
test('truncated media is reported, never presented as a complete original',()=>{
  const r=buildOfflineArchive({attachments:{payloads:[{id:'bad',size:9,data_base64:'AQID'}]}});
  assert.equal(r.mediaCount,0);assert.equal(r.warnings.length,1);
});
