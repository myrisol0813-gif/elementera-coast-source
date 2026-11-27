// Build-time only. Chromium is a reference rasterizer, never bundled into the APK.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, rm, rename } from 'node:fs/promises';
import { resolve, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../../web/elementera-mcp/deploy-pages/public/rest-box/', import.meta.url));
if (!process.argv[2]) throw Error('usage: node compile.mjs OUTPUT_DIRECTORY');
const output = resolve(process.argv[2]);
const temp = output + '.tmp';
await rm(temp,{recursive:true,force:true});
await mkdir(temp,{recursive:true});
const server = createServer(async (req,res)=>{
  try {
    const pathname = new URL(req.url,'http://localhost').pathname;
    if(pathname==='/__native-pose-templates.mjs'){res.setHeader('Content-Type','text/javascript');res.end(await readFile(new URL('./pose-templates.mjs',import.meta.url)));return;}
    if(pathname==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta charset="utf-8"><title>Art compiler</title>');return;}
    const rel=decodeURIComponent(pathname.slice(1)), file=resolve(root,rel);
    if(!file.startsWith(root.endsWith(sep)?root:root+sep)||!(/\.(mjs|json|svg)$/.test(rel)))throw Error('path');
    const data=await readFile(file);
    res.setHeader('Content-Type',rel.endsWith('.mjs')?'text/javascript':rel.endsWith('.json')?'application/json':'image/svg+xml');
    res.end(data);
  }catch{res.statusCode=404;res.end('not found')}
});
await new Promise((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',ok)});
const origin='http://127.0.0.1:'+server.address().port;
let browser;
try {
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage();
  await page.route('**/*',route=>{const url=route.request().url();return url.startsWith(origin+'/')||url.startsWith('data:')?route.continue():route.abort()});
  await page.goto(origin);
  const jobs=await page.evaluate(async ()=>{
    const room=await import('/room-renderer.mjs'), creature=await import('/creature-renderer.mjs'), state=await import('/creature-state.mjs');
    const art=await room.loadArt();
    const work=[];
    const push=(key,file,width,height,extra={})=>work.push({key,file,width,height,...extra});
    const colorKey=values=>Object.entries(values).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>k+'='+v.toLowerCase()).join(',');
    for(const r of Object.values(art.catalogue.rooms)){
      for(const p of [r.environment,r.overlay].filter(Boolean))push('e|'+p,p,r.width,r.height,{kind:'environment'});
    }
    for(const a of Object.values(art.catalogue.assets)){
      const [,,w,h]=a.box??a.viewBox;
      const variants=[{},...(a.presets??[]).map(p=>p.values)];
      for(const colors of variants)for(const part of (a.hasFront?['whole','back','front']:['whole'])){
        push('f|'+a.id+'|'+part+'|'+colorKey(colors),a.file,w,h,{kind:'furniture',id:a.id,colors,part});
      }
    }
    for(const b of Object.values(art.creatures)){
      const [,,w,h]=b.viewBox.split(/\s+/).map(Number);
      for(const palette of Object.keys(art.appearance[b.id].palettes))for(const action of state.ACTIONS){
        push('c|'+b.id+'|'+palette+'|'+action,b.file,w,h,{kind:'creature',id:b.id,palette,action});
      }
    }
    const {compilePoseTemplate}=await import('/__native-pose-templates.mjs');
    globalThis.compilePose=job=>compilePoseTemplate(art,creature,state,job);
    globalThis.compileSprite=async job=>{
      const source=await art.read(job.file);
      let svg;
      if(job.kind==='creature'){
        const input={...state.newAppearance(art.appearance,job.id),palette:job.palette};
        svg=creature.creatureSvg(source,art.creatures[job.id],art.appearance,art.accessories,input,job.action,{reducedMotion:true,badges:art.badges});
      }else{
        svg=room.prepareSvg(source,job.kind==='furniture'?art.catalogue.assets[job.id]:{},job.colors??{},job.part??'whole',{reducedMotion:true});
      }
      const image=new Image();
      image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
      await image.decode();
      const c=document.createElement('canvas');
      c.width=Math.max(1,Math.ceil(job.width*2));c.height=Math.max(1,Math.ceil(job.height*2));
      const ctx=c.getContext('2d',{willReadFrequently:true});
      ctx.drawImage(image,0,0,c.width,c.height);
      const pixels=ctx.getImageData(0,0,c.width,c.height).data;
      let visible=false;
      for(let i=3;i<pixels.length;i+=4){if(pixels[i]>0){visible=true;break}}
      if(!visible)throw Error('transparent sprite '+job.key);
      return c.toDataURL('image/png').split(',')[1];
    };
    return work;
  });
  const entries={},templates={};
  for(const job of jobs){
    if(entries[job.key])continue;
    const hash=createHash('sha256').update(job.key).digest('hex').slice(0,24);
    const file='sprites/'+hash+'.png';
    const data=await page.evaluate(job=>globalThis.compileSprite(job),job);
    await mkdir(dirname(resolve(temp,file)),{recursive:true});
    await writeFile(resolve(temp,file),Buffer.from(data,'base64'));
    entries[job.key]=file;
    if(job.kind==='creature'){
      const templateFile='poses/'+hash+'.json';
      const template=await page.evaluate(job=>globalThis.compilePose(job),job);
      await mkdir(dirname(resolve(temp,templateFile)),{recursive:true});
      await writeFile(resolve(temp,templateFile),JSON.stringify(template));
      templates[job.key]=templateFile;
    }
  }
  await writeFile(resolve(temp,'index.json'),JSON.stringify({version:1,entries,templates},null,2));
  await rm(output,{recursive:true,force:true});
  await rename(temp,output);
  console.log('Compiled '+Object.keys(entries).length+' non-empty transparent native art layers; '+Object.keys(templates).length+' editable pose templates');
}finally{
  await browser?.close();
  await new Promise(ok=>server.close(ok));
}
