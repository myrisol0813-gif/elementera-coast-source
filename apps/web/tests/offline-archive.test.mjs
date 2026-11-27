import test from 'node:test';
import assert from 'node:assert/strict';
import {buildOfflineArchive} from '../elementera-mcp/deploy-pages/public/features/offline-archive.js';
test('offline archive keeps all variants, escapes text and restores media bytes',async()=>{
  const archive={chat:{conversations:[{conversation:{id:'c',title:'<script>x</script>'},history:{turns:[{user:{variants:[{content:'<script>x</script>',attachments:[{id:'a'}]},{content:'second branch'}]},assistant:{variantsByUserVariant:{0:[{content:'reply\n<!--tideloom:split-->\nsegment two'}],1:[{content:'other reply'}]}}}]}}]},attachments:{payloads:[{id:'a',conversation_id:'c',name:'../../a.png',mime:'image/png',size:3,data_base64:'AQID'}]},voice:{payloads:[{id:'v',chunks:['BAU=']}]},excluded_modules:['credentials']};
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
  assert.match(html,/reply\n\nsegment two/);assert.doesNotMatch(html,/tideloom:split/);
  assert.match(html,/second branch/);assert.match(html,/other reply/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.match(html,/\.\.\/media\/1.png/);
  assert.equal(JSON.parse(new TextDecoder().decode(files.get('manifest.json'))).restore_supported,false);
});
test('truncated media is reported, never presented as a complete original',()=>{
  const r=buildOfflineArchive({attachments:{payloads:[{id:'bad',size:9,data_base64:'AQID'}]}});
  assert.equal(r.mediaCount,0);assert.equal(r.warnings.length,1);
});

test('verified V2 reading copy keeps library anchors, original media and signature',async()=>{
  const {writeOfflineV2}=await import('../elementera-mcp/deploy-pages/public/features/offline-v2-archive.js');
  const rows=[
    ['library','b','library_books',{id:'b',title:'Fixture <script>',format:'txt'}],
    ['library','c','library_chapters',{book_id:'b',chapter_index:0,title:'Chapter',body:'one\n\ntwo'}],
    ['library','n','library_notes',{book_id:'b',chapter_index:0,paragraph_index:1,kind:'annotation',author:'assistant',quote:'two',body:'note'}],
    ['library','cover','library_covers',{book_id:'b',mime:'image/png'},['image']],
    ['voice','v','voice',{id:'v',mime:'audio/mpeg'},['audio']],
    ['chat','chat','chat',{conversation:{id:'chat',title:'chat'},history_json:JSON.stringify({turns:[{user:{variants:[{content:'署名测试'}]},assistant:{variantsByUserVariant:{0:[{id:'old',content:'old version'},{id:'a0',content:'first',reply_sequence:{id:'seq',index:0},desk_slip:{summary:'desk first'}},{id:'a1',content:'second\n<!--tideloom:split-->\nnext segment',reply_sequence:{id:'seq',index:1},desk_slip:{reply_sequence_previous:[{message_id:'a0',content:'first'}]}}]}}}]})}]
  ];
  const enc=new TextEncoder(),values=new Map([['image',new Uint8Array([1,2,3])],['audio',new Uint8Array([4,5])]]);
  const records=rows.map(([module,id,kind,data,media_objects=[]],i)=>{const record_object='r'+i;values.set(record_object,enc.encode(JSON.stringify({kind,data})));return {module,id,record_object,media_objects,dependencies:[]};});
  const manifest={workspace:'backend',exported_at:'2026-01-01T00:00:00Z',modules:['library','voice','chat'].map(module=>({module,coverage:'partial',count:records.filter(r=>r.module===module).length})),records,objects:[...values].map(([object_sha256,b])=>({object_sha256,size:b.length}))};
  const parts=[];
  const result=await writeOfflineV2({manifest,objectChunks:async function*(d){yield values.get(d.object_sha256);}}, {write:async b=>parts.push(b.slice()),close:async()=>{},abort:async()=>{}},{ownerLabel:'归档署名'});
  const text=new TextDecoder().decode(await new Blob(parts).arrayBuffer());
  assert.equal(result.mediaCount,2);assert.deepEqual(result.warnings,[]);
  assert.match(text,/2\.html#p-1/);assert.match(text,/id="p-1"/);assert.match(text,/&lt;script&gt;/);
  assert.match(text,/版本 2 · 连续回复 1 · 组 seq/);assert.match(text,/版本 2 · 连续回复 2 · 组 seq/);assert.match(text,/reply_sequence_previous/);assert.match(text,/second\n\nnext segment/);assert.doesNotMatch(text,/tideloom:split/);
  assert.match(text,/归档署名/);assert.match(text,/media\/1\.png/);assert.match(text,/media\/2\.mp3/);
});

