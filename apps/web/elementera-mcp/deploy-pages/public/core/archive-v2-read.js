// Bounded ZIP32 reader: STORE or DEFLATE, no extraction to arbitrary paths.
// Each object is independently verified against the common V2 manifest.
const MAX=3*1024**3,CHUNK=1048576,decoder=new TextDecoder('utf-8',{fatal:true});
const check=(ok,msg)=>{if(!ok)throw Error(msg);};
const sha=async b=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(x=>x.toString(16).padStart(2,'0')).join('');
const table=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
async function read(file,at,n){check(Number.isSafeInteger(at)&&at>=0&&n>=0&&at+n<=file.size,'ZIP offset invalid');return new Uint8Array(await file.slice(at,at+n).arrayBuffer());}
const view=b=>new DataView(b.buffer,b.byteOffset,b.byteLength);
async function* unpack(file,e){
  let stream=file.slice(e.start,e.start+e.compressed).stream();
  if(e.method===8)stream=stream.pipeThrough(new DecompressionStream('deflate-raw'));
  const reader=stream.getReader();let size=0,crc=0xffffffff,offset=0,buffer=new Uint8Array(Math.min(CHUNK,e.size));
  try{
    for(;;){
      const {done,value}=await reader.read();if(done)break;
      check(size+value.length<=e.size,'ZIP decompression exceeds declared size');
      for(const b of value)crc=table[(crc^b)&255]^(crc>>>8);
      size+=value.length;let p=0;
      while(p<value.length){const n=Math.min(buffer.length-offset,value.length-p);check(n>0,'unexpected ZIP bytes');buffer.set(value.subarray(p,p+n),offset);offset+=n;p+=n;if(offset===buffer.length){yield buffer;offset=0;buffer=new Uint8Array(Math.min(CHUNK,e.size-(size-value.length+p)));}}
    }
    check(size===e.size&&offset===0&&((crc^0xffffffff)>>>0)===e.crc,'ZIP entry length or CRC mismatch');
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export async function openArchiveV2(file,validate){
  check(file.size>=22&&file.size<=MAX+16*1024*1024,'ZIP exceeds size limit');
  const end=view(await read(file,file.size-22,22));
  check(end.getUint32(0,true)===0x06054b50&&end.getUint16(4,true)===0&&end.getUint16(6,true)===0&&end.getUint16(20,true)===0,'unsupported ZIP end record');
  const count=end.getUint16(10,true),centralSize=end.getUint32(12,true),centralStart=end.getUint32(16,true);
  check(count===end.getUint16(8,true)&&count>=1&&count<=8193&&centralSize<=8*1024*1024&&centralStart+centralSize===file.size-22,'invalid central directory');
  const central=await read(file,centralStart,centralSize),c=view(central),entries=new Map(),ranges=[];let p=0;
  for(let i=0;i<count;i++){
    check(p+46<=central.length&&c.getUint32(p,true)===0x02014b50,'invalid central entry');
    const flags=c.getUint16(p+8,true),method=c.getUint16(p+10,true),crc=c.getUint32(p+16,true),compressed=c.getUint32(p+20,true),size=c.getUint32(p+24,true),n=c.getUint16(p+28,true),extra=c.getUint16(p+30,true),comment=c.getUint16(p+32,true),local=c.getUint32(p+42,true);
    check((flags&~0x80e)===0&&[0,8].includes(method)&&size<=MAX&&p+46+n+extra+comment<=central.length&&c.getUint16(p+34,true)===0,'unsupported ZIP entry');
    const name=decoder.decode(central.subarray(p+46,p+46+n));
    check((name==='manifest.json'||/^objects\/[0-9a-f]{64}$/.test(name))&&!entries.has(name),'invalid or duplicate ZIP path');
    const h=view(await read(file,local,30));
    check(h.getUint32(0,true)===0x04034b50&&h.getUint16(6,true)===flags&&h.getUint16(8,true)===method,'local ZIP header mismatch');
    const ln=h.getUint16(26,true),le=h.getUint16(28,true),start=local+30+ln+le;
    check(decoder.decode(await read(file,local+30,ln))===name&&start+compressed<=centralStart&&(method!==0||compressed===size),'invalid ZIP entry extent');
    if(!(flags&8))check(h.getUint32(14,true)===crc&&h.getUint32(18,true)===compressed&&h.getUint32(22,true)===size,'ZIP sizes mismatch');
    ranges.push([local,start+compressed]);entries.set(name,{start,compressed,size,method,crc});p+=46+n+extra+comment;
  }
  ranges.sort((a,b)=>a[0]-b[0]);check(p===central.length&&ranges.every((r,i)=>i===0||ranges[i-1][1]<=r[0]),'overlapping ZIP entries');
  const meta=entries.get('manifest.json');check(meta&&meta.size>0&&meta.size<=2*1024*1024,'manifest missing or oversized');
  const raw=new Uint8Array(meta.size);let at=0;for await(const b of unpack(file,meta)){raw.set(b,at);at+=b.length;}
  const manifest=JSON.parse(decoder.decode(raw));await validate(manifest);
  check(entries.size===manifest.objects.length+1&&manifest.objects.every(d=>entries.get('objects/'+d.object_sha256)?.size===d.size),'ZIP contents do not match manifest');
  async function* objectChunks(d){
    const e=entries.get('objects/'+d.object_sha256);let i=0;
    for await(const bytes of unpack(file,e)){check(i<d.chunks.length&&await sha(bytes)===d.chunks[i],'object digest mismatch');i++;yield bytes;}
    check(i===d.chunks.length,'object incomplete');
  }
  return {manifest,objectChunks};
}
