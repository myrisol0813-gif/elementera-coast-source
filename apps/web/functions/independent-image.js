// Independent image transport. No chat history, model-chosen credentials,
 // external download URL, silent paid fallback, or storage side effect.
const BASE='https://openrouter.ai/api/v1/images';
export const IMAGE_LIMITS=Object.freeze({prompt_chars:4000,bytes:8*1024*1024,response_bytes:12*1024*1024,timeout_ms:120000});
const modelId=/^[a-z0-9][a-z0-9_.-]{0,79}\/[a-z0-9][a-z0-9_.-]{0,119}(?::free)?$/i;
export class ImageProviderError extends Error{
  constructor(code,message){super(message);this.code=code;}
}
const fail=(code,message)=>{throw new ImageProviderError(code,message);};
async function jsonRequest(url,options,fetcher,max=IMAGE_LIMITS.response_bytes){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),IMAGE_LIMITS.timeout_ms);
  try{
    const res=await fetcher(url,{...options,redirect:'error',signal:controller.signal});
    if(!res.ok)fail('provider_http','图像供应商返回 HTTP '+res.status+'；未保存图像，可能已产生费用。');
    if(Number(res.headers.get('content-length'))>max)fail('response_limit','供应商响应超过上限。');
    const reader=res.body?.getReader();
    if(!reader)fail('empty_response','没有供应商响应。');
    const parts=[];let size=0;
    try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max)fail('response_limit','供应商响应超过上限。');parts.push(value);}}
    finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
    const bytes=new Uint8Array(size);let offset=0;
    for(const part of parts){bytes.set(part,offset);offset+=part.length;}
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  }catch(e){
    if(e instanceof ImageProviderError)throw e;
    fail(controller.signal.aborted?'provider_timeout':'provider_unavailable','图像供应商连接或解析失败；不自动重试，可能已产生费用。');
  }finally{clearTimeout(timer);}
}
export async function discoverImageModels(fetcher=fetch){
  const result=await jsonRequest(BASE+'/models',{method:'GET'},fetcher,4*1024*1024);
  if(!Array.isArray(result?.data))fail('catalog_invalid','图像模型目录不可用。');
  return result.data.filter(m=>typeof m?.id==='string'&&modelId.test(m.id)&&m.architecture?.output_modalities?.includes('image'))
    .map(m=>({id:m.id,name:String(m.name||m.id).slice(0,180),free:m.id.endsWith(':free')}))
    .sort((a,b)=>Number(b.free)-Number(a.free)||a.id.localeCompare(b.id));
}
function decodeImage(raw){
  if(typeof raw!=='string'||raw.length>Math.ceil(IMAGE_LIMITS.bytes/3)*4||!raw.length||! /^[A-Za-z0-9+/]+={0,2}$/.test(raw)||raw.length%4!==0)fail('image_invalid','图像原件不是有效的内联 Base64。');
  let bytes;try{const decoded=atob(raw);bytes=Uint8Array.from(decoded,c=>c.charCodeAt(0));}catch{fail('image_invalid','图像原件解码失败。');}
  if(!bytes.length||bytes.length>IMAGE_LIMITS.bytes)fail('image_limit','图像超过8MiB或为空。');
  const starts=(signature,offset=0)=>signature.every((v,i)=>bytes[i+offset]===v);
  const mime=bytes.length>=24&&starts([137,80,78,71,13,10,26,10])?'image/png':
    bytes.length>=4&&starts([255,216,255])?'image/jpeg':
    bytes.length>=16&&starts([82,73,70,70])&&starts([87,69,66,80],8)?'image/webp':null;
  if(!mime)fail('image_invalid','供应商没有返回可识别的 PNG、JPEG 或 WebP。');
  return {bytes,mime};
}
export async function generateIndependentImage(config,input,fetcher=fetch){
  if(!config||typeof config.key!=='string'||!config.key.trim()||typeof config.model!=='string'||!modelId.test(config.model))fail('not_configured','请配置独立生图模型。');
  if(!config.model.endsWith(':free')&&config.allowPaid!==true)fail('paid_not_authorized','非免费生图模型未获明确付费授权。');
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>k!=='prompt')||typeof input.prompt!=='string'||!input.prompt.trim()||input.prompt.trim().length>IMAGE_LIMITS.prompt_chars)fail('invalid_arguments','只接收1—4000字符的绘图提示词。');
  // Inline original is the documented default. Never follow returned URL.
  // Fixed selected model: no auto router, fallback list or paid substitution.
  const result=await jsonRequest(BASE,{method:'POST',headers:{Authorization:'Bearer '+config.key.trim(),'Content-Type':'application/json'},body:JSON.stringify({model:config.model,prompt:input.prompt.trim(),n:1})},fetcher);
  if(!Array.isArray(result?.data)||result.data.length!==1)fail('image_count','供应商没有返回恰好一张图像。');
  const {bytes,mime}=decodeImage(result.data[0]?.b64_json);
  const reported=typeof result.model==='string'&&modelId.test(result.model)?result.model:null;
  const cost=typeof result.usage?.cost==='number'&&Number.isFinite(result.usage.cost)&&result.usage.cost>=0?result.usage.cost:null;
  // Cost is reported by the provider, never inferred from the selected model.
  return {bytes,mime,provider:'openrouter',requested_model:config.model,reported_model:reported,cost_usd:cost,prompt:input.prompt.trim()};
}

/** Prepare private, transient multimodal continuation from the verified saved
 * original. The user role below is only a Chat Completions wire envelope:
 * never persist it as a human message, audit payload or tool result. A prepared
 * message does not prove that any provider received or understood the image. */
export function prepareGeneratedImageReadback({attachmentId,bytes,mime,visionSupported}={}){
  if(typeof attachmentId!=='string'||! /^[A-Za-z0-9_.:-]{1,160}$/.test(attachmentId))fail('readback_source_invalid','缺少已保存图像原件的标识。');
  if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>IMAGE_LIMITS.bytes)fail('readback_original_invalid','图像原件缺失或超限。');
  const starts=(signature,offset=0)=>signature.every((v,i)=>bytes[i+offset]===v);
  const detected=bytes.length>=24&&starts([137,80,78,71,13,10,26,10])?'image/png':
    bytes.length>=4&&starts([255,216,255])?'image/jpeg':
    bytes.length>=16&&starts([82,73,70,70])&&starts([87,69,66,80],8)?'image/webp':null;
  if(!detected||mime!==detected)fail('readback_original_invalid','图像原件 MIME 与内容不符。');
  const receipt={attachment_id:attachmentId,status:visionSupported===true?'prepared':visionSupported===false?'model_no_vision':'vision_unknown'};
  if(visionSupported!==true)return {receipt,continuationMessage:null};
  let binary='';
  for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
  return {receipt,continuationMessage:{role:'user',content:[
    {type:'text',text:'【生成图像回读 · 系统转交】这是本轮图像工具生成的已保存作品原件，并非人类新发言。请根据实际像素继续回应。'},
    {type:'image_url',image_url:{url:'data:'+mime+';base64,'+btoa(binary)}}
  ]}};
}
