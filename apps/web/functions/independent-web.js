// Explicitly enabled public-web provider; never fetch model-supplied URLs on the Coast network.
export const independentWebConfigured=env=>env?.COAST_INDEPENDENT_WEB_ENABLED==='true'&&typeof env?.TAVILY_API_KEY==='string'&&env.TAVILY_API_KEY.trim().length>0;
export const independentWebAllowed=c=>c.permission==='owner'&&['main_chat','radio'].includes(c.surface)&&c.independent_web_enabled===true&&independentWebConfigured(c.env);
class WebToolError extends Error{constructor(type,message){super(message);this.type=type;}}
const fail=(type,message)=>{throw new WebToolError(type,message);};
const clean=(v,n)=>typeof v==='string'?v.trim().slice(0,n):'';
function publicUrl(v){
  if(typeof v!=='string'||v.length>1800)return null;
  try{const u=new URL(v);
    if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.port||!u.hostname.includes('.')||/^\d|^\[/.test(u.hostname)||/\.(?:localhost|local|internal|lan|test|invalid|onion|home|example)$/i.test(u.hostname))return null;
    for(const k of u.searchParams.keys())if(/token|secret|password|signature|credential|api.?key|auth|session|^code$|^key$/i.test(k))return null;
    u.hash='';return u.href;
  }catch{return null;}
}
function fields(input,keys){if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!keys.includes(k)))fail('invalid_arguments','联网工具包含未声明字段。');}
async function request(env,path,body,fetcher){
  if(!independentWebConfigured(env))fail('web_not_configured','独立联网尚未配置或已关闭。');
  const max=512*1024,controller=new AbortController(),timer=setTimeout(()=>controller.abort(),18000);
  try{
    const res=await fetcher('https://api.tavily.com/'+path,{method:'POST',redirect:'error',signal:controller.signal,headers:{'Content-Type':'application/json',Authorization:'Bearer '+env.TAVILY_API_KEY.trim()},body:JSON.stringify(body)});
    if(!res.ok)fail('web_provider_http','搜索供应商返回 HTTP '+res.status+'；未取得资料。');
    if(Number(res.headers.get('content-length'))>max)fail('web_response_limit','供应商返回资料过大。');
    const reader=res.body?.getReader();if(!reader)fail('web_empty_response','供应商没有返回正文。');
    let size=0;const chunks=[];
    try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max)fail('web_response_limit','供应商返回资料过大。');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
    const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
    const data=JSON.parse(new TextDecoder().decode(bytes));if(!Array.isArray(data?.results))fail('web_invalid_response','供应商返回格式异常。');return data;
  }catch(e){if(e instanceof WebToolError)throw e;fail(controller.signal.aborted?'web_timeout':'web_connection_failed',controller.signal.aborted?'搜索请求超时。':'独立联网连接或解析失败。');}
  finally{clearTimeout(timer);}
}
export async function independentSearch(env,input,fetcher=fetch){
  fields(input,['query','limit']);const query=clean(input.query,501),limit=input.limit??4;
  if(!query||query.length>500||!Number.isInteger(limit)||limit<1||limit>5)fail('invalid_arguments','检索词须为1—500字符，结果数量1—5。');
  const data=await request(env,'search',{query,max_results:limit,search_depth:'basic',include_answer:false,include_raw_content:false},fetcher);
  const sources=data.results.slice(0,limit).flatMap(r=>{const url=publicUrl(r?.url);return url?[{url,title:clean(r.title,200),excerpt:clean(r.content,800),truncated:typeof r.content==='string'&&r.content.trim().length>800}]:[];});
  return {ok:true,provider:'tavily',operation:'search',reference_only:true,coverage:'search_excerpts',count:sources.length,sources};
}
export async function independentRead(env,input,fetcher=fetch){
  fields(input,['url']);const url=publicUrl(input.url);if(!url)fail('invalid_arguments','只允许公开HTTP(S)网页，不接收凭据、内网地址或私密链接。');
  const data=await request(env,'extract',{urls:[url],extract_depth:'basic',format:'text'},fetcher);
  const row=data.results.find(r=>publicUrl(r?.url)===url);
  if(!row||typeof row.raw_content!=='string'||!row.raw_content.trim())fail('web_read_unavailable','未取得网页正文；可能存在访问限制。');
  const content=row.raw_content.trim();return {ok:true,provider:'tavily',operation:'extract',reference_only:true,source_url:url,content:content.slice(0,6000),truncated:content.length>6000,coverage:'provider_extracted_text'};
}
