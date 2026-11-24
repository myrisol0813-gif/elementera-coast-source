import { validateObjectDescriptor, digestBytes, describeObject, ARCHIVE_CHUNK_BYTES } from './coast-archive-v2-chunks.js';
export const ARCHIVE_V2_FORMAT='elementera-coast-archive';
export const MODULES=Object.freeze(['chat','attachments','dogtalk_records','dogtalk_snapshots','voice','memory_entries','memory_pockets','thinking_soil','thinking_soil_history','calendar','daily','model_profile','user_portrait','self_portrait','worldbook','custom_instructions','vault','library','appearance','tools']);
const id=/^[A-Za-z0-9_.:-]{1,200}$/;
const hash=/^[a-f0-9]{64}$/;
const check=(ok,msg)=>{if(!ok)throw Object.assign(Error(msg),{status:400});};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const key=r=>r.module+'/'+r.id;
export async function encodeRecordObject(record){
  const bytes=new TextEncoder().encode(JSON.stringify(record));
  const chunks=[];for(let i=0;i<bytes.length;i+=ARCHIVE_CHUNK_BYTES)chunks.push(bytes.subarray(i,i+ARCHIVE_CHUNK_BYTES));
  return {descriptor:await describeObject(bytes.length,await Promise.all(chunks.map(digestBytes))),chunks};
}
// All declared modules have an explicit coverage state; partial archives cannot
// impersonate full backups. A record payload is an object too (not inline JSON).
export async function validateArchiveManifest(m,{maxBytes=3*1024**3,maxObjects=8192,maxRecords=100000}={}){
  check(exact(m,['format','version','workspace','application_id','exported_at','modules','records','objects'])&&m.format===ARCHIVE_V2_FORMAT&&m.version===2,'invalid archive manifest version');
  check(['local','backend'].includes(m.workspace)&&['com.elementeracoast.app','com.elementeracoast.source'].includes(m.application_id)&&typeof m.exported_at==='string'&&Number.isFinite(Date.parse(m.exported_at)),'invalid archive origin');
  check(Array.isArray(m.modules)&&m.modules.length===MODULES.length,'module coverage missing');
  const coverage=new Map();
  for(const x of m.modules){
    check(exact(x,['module','coverage','count'])&&MODULES.includes(x.module)&&!coverage.has(x.module)&&['complete','partial','unavailable'].includes(x.coverage)&&Number.isSafeInteger(x.count)&&x.count>=0,'invalid module coverage');
    coverage.set(x.module,x);
  }
  check(Array.isArray(m.objects)&&m.objects.length<=maxObjects&&Array.isArray(m.records)&&m.records.length<=maxRecords,'archive manifest exceeds limits');
  const objects=new Map();let bytes=0;
  for(const o of m.objects){
    check(exact(o,['size','chunks','object_sha256']),'invalid object fields');
    await validateObjectDescriptor(o,{maxBytes});
    check(!objects.has(o.object_sha256),'duplicate archive object');
    bytes+=o.size;check(bytes<=maxBytes,'archive exceeds byte budget');
    objects.set(o.object_sha256,o);
  }
  const records=new Map(),counts=new Map(),used=new Set();
  for(const r of m.records){
    check(exact(r,['module','id','record_object','media_objects','dependencies'])&&coverage.has(r.module)&&typeof r.id==='string'&&id.test(r.id)&&!records.has(key(r)),'invalid or duplicate record');
    check(typeof r.record_object==='string'&&objects.has(r.record_object)&&Array.isArray(r.media_objects)&&new Set(r.media_objects).size===r.media_objects.length&&r.media_objects.every(h=>typeof h==='string'&&hash.test(h)&&objects.has(h)),'record object missing');
    check(Array.isArray(r.dependencies)&&new Set(r.dependencies).size===r.dependencies.length&&r.dependencies.every(k=>typeof k==='string'&&k.length<=250),'invalid record dependencies');
    used.add(r.record_object);r.media_objects.forEach(h=>used.add(h));
    records.set(key(r),r);counts.set(r.module,(counts.get(r.module)||0)+1);
  }
  for(const x of coverage.values())check(x.count===(counts.get(x.module)||0)&&(x.coverage!=='unavailable'||x.count===0),'module record count mismatch');
  for(const r of records.values())check(r.dependencies.every(k=>k!==key(r)&&records.has(k)),'missing record dependency');
  check(used.size===objects.size,'unreferenced archive object');
  // Completeness is a declaration, not proof of live storage coverage.
  return {bytes,records:records.size,objects:objects.size,declaredComplete:[...coverage.values()].every(x=>x.coverage==='complete')};
}
