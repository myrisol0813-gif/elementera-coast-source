import assert from 'node:assert/strict';
import {discoverImageModels,generateIndependentImage,IMAGE_LIMITS,prepareGeneratedImageReadback} from '../functions/independent-image.js';
const png=Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,6,0,0,0]);
const base64=btoa(String.fromCharCode(...png));
let calls=0;
const fetcher=async(url,req)=>{
  calls++;
  assert.equal(req.redirect,'error');
  if(url.endsWith('/models'))return new Response(JSON.stringify({data:[
    {id:'fixture/paid',architecture:{output_modalities:['image']}},
    {id:'fixture/free:free',architecture:{output_modalities:['image']}},
    {id:'fixture/text:free',architecture:{output_modalities:['text']}}
  ]}));
  assert.equal(url,'https://openrouter.ai/api/v1/images');
  assert.equal(req.headers.Authorization,'Bearer synthetic-key');
  assert.deepEqual(JSON.parse(req.body),{model:'fixture/free:free',prompt:'one drawing',n:1});
  return new Response(JSON.stringify({model:'fixture/free:free',data:[{b64_json:base64}],usage:{cost:0}}));
};
const models=await discoverImageModels(fetcher);
assert.deepEqual(models.map(x=>x.id),['fixture/free:free','fixture/paid']);
const config={key:'synthetic-key',model:'fixture/free:free'};
const image=await generateIndependentImage(config,{prompt:'one drawing'},fetcher);
assert.deepEqual(image.bytes,png);assert.equal(image.mime,'image/png');assert.equal(image.cost_usd,0);assert.equal(image.reported_model,config.model);
assert.ok(!JSON.stringify(image).includes('synthetic-key'));
await assert.rejects(()=>generateIndependentImage({...config,model:'fixture/paid'},{prompt:'x'},fetcher),e=>e.code==='paid_not_authorized');
await assert.rejects(()=>generateIndependentImage(config,{prompt:'x',history:'private'},fetcher),e=>e.code==='invalid_arguments');
await assert.rejects(()=>generateIndependentImage(config,{prompt:'x'.repeat(IMAGE_LIMITS.prompt_chars+1)},fetcher),e=>e.code==='invalid_arguments');
assert.equal(calls,2);
await assert.rejects(()=>generateIndependentImage(config,{prompt:'one drawing'},async()=>new Response(JSON.stringify({data:[{url:'https://untrusted.example/x'}]}))),e=>e.code==='image_invalid');
const unknown=await generateIndependentImage(config,{prompt:'one drawing'},async()=>new Response(JSON.stringify({data:[{b64_json:base64}]})));
assert.equal(unknown.cost_usd,null);assert.equal(unknown.reported_model,null);
console.log('independent image transport checks passed');

const readback=prepareGeneratedImageReadback({attachmentId:'att_fixture',bytes:image.bytes,mime:image.mime,visionSupported:true});
assert.deepEqual(readback.receipt,{attachment_id:'att_fixture',status:'prepared'});
assert.equal(readback.continuationMessage.role,'user');
assert.match(readback.continuationMessage.content[0].text,/并非人类新发言/);
assert.equal(readback.continuationMessage.content[1].image_url.url,'data:image/png;base64,'+base64);
assert.ok(!JSON.stringify(readback.receipt).includes(base64));
for(const [visionSupported,status] of [[false,'model_no_vision'],[null,'vision_unknown']]){
  const skipped=prepareGeneratedImageReadback({attachmentId:'att_fixture',bytes:image.bytes,mime:image.mime,visionSupported});
  assert.deepEqual(skipped,{receipt:{attachment_id:'att_fixture',status},continuationMessage:null});
}
assert.throws(()=>prepareGeneratedImageReadback({attachmentId:'att_fixture',bytes:image.bytes,mime:'image/jpeg',visionSupported:true}),e=>e.code==='readback_original_invalid');
assert.throws(()=>prepareGeneratedImageReadback({attachmentId:'',bytes:image.bytes,mime:image.mime,visionSupported:true}),e=>e.code==='readback_source_invalid');
