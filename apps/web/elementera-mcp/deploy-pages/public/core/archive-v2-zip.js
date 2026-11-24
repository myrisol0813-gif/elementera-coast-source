// ZIP32 STORE writer with a sequential sink. Only central-directory metadata
// stays in memory. The caller owns an abortable temporary output destination.
const utf8=new TextEncoder(),MAX=0xffffffff;
const table=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
const header=(n,s)=>{const b=new Uint8Array(n),v=new DataView(b.buffer);v.setUint32(0,s,true);return [b,v];};
const check=(ok,msg)=>{if(!ok)throw Error(msg);};
export class ArchiveV2ZipWriter {
  constructor(sink){this.sink=sink;this.offset=0;this.central=[];this.names=new Set();this.state='open';}
  async write(b){check(this.offset+b.length<=MAX,'ZIP32 byte limit');await this.sink.write(b);this.offset+=b.length;}
  async entry(name,size,source){
    check(this.state==='open','ZIP writer closed');
    check((name==='manifest.json'||/^objects\/[0-9a-f]{64}$/.test(name))&&!this.names.has(name),'invalid or duplicate archive path');
    check(Number.isSafeInteger(size)&&size>=0&&size<=MAX&&this.central.length<65535,'ZIP32 entry limit');
    this.state='entry';
    try{
      const n=utf8.encode(name),start=this.offset,[h,v]=header(30,0x04034b50);
      v.setUint16(4,20,true);v.setUint16(6,0x808,true);v.setUint16(12,33,true);v.setUint16(26,n.length,true);
      await this.write(h);await this.write(n);
      let crc=0xffffffff,total=0;
      for await(const bytes of source){
        check(bytes instanceof Uint8Array&&bytes.length<=1048576&&total+bytes.length<=size,'invalid archive ZIP chunk');
        for(const b of bytes)crc=table[(crc^b)&255]^(crc>>>8);
        await this.write(bytes);total+=bytes.length;
      }
      check(total===size,'archive ZIP entry incomplete');crc=(crc^0xffffffff)>>>0;
      const [d,dv]=header(16,0x08074b50);dv.setUint32(4,crc,true);dv.setUint32(8,size,true);dv.setUint32(12,size,true);await this.write(d);
      const [c,cv]=header(46,0x02014b50);cv.setUint16(4,20,true);cv.setUint16(6,20,true);cv.setUint16(8,0x808,true);cv.setUint16(14,33,true);cv.setUint32(16,crc,true);cv.setUint32(20,size,true);cv.setUint32(24,size,true);cv.setUint16(28,n.length,true);cv.setUint32(42,start,true);
      this.central.push([c,n]);this.names.add(name);this.state='open';
    }catch(e){this.state='failed';throw e;}
  }
  async finish(){
    check(this.state==='open'&&this.names.has('manifest.json'),'archive manifest missing or writer failed');
    this.state='closing';const start=this.offset;
    try{
      for(const [c,n] of this.central){await this.write(c);await this.write(n);}
      const size=this.offset-start,[e,v]=header(22,0x06054b50);v.setUint16(8,this.central.length,true);v.setUint16(10,this.central.length,true);v.setUint32(12,size,true);v.setUint32(16,start,true);await this.write(e);await this.sink.close();this.state='closed';
    }catch(e){this.state='failed';throw e;}
  }
  async abort(){if(this.state!=='closed'){this.state='failed';await this.sink.abort?.();}}
}
