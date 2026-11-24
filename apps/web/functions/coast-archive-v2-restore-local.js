import { encodeTransfer } from './coast-transfer.js';
import { previewCloudTransfer,importCloudTransfer } from './coast-transfer-store.js';
import { validateArchiveManifest } from './coast-archive-v2-manifest.js';
import { stageVerifiedObject } from './coast-archive-v2-chunks.js';
import { readStagedArchiveChunks } from './coast-archive-v2-stage.js';
const check=(ok,msg)=>{if(!ok)throw Object.assign(Error(msg),{status:409});};
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(v);
const specs={local_chat:['chat','conversations'],local_calendar:['calendar','calendar'],local_moment:['daily','moments'],local_diary:['daily','diaries'],local_daily_profile:['daily','dailyProfile'],local_model_profile:['model_profile','profile']};
// Adapt one verified local V2 object to the existing portable migration
// contract. No new normalization path, no automatic writes or media loss.
export async function restoreArchiveLocalRecord(db,session,manifest,module,recordId,confirm=false){
 await validateArchiveManifest(manifest);
 check(manifest.workspace==='local'&&['com.elementeracoast.app','com.elementeracoast.source'].includes(manifest.application_id),'unknown local archive origin');
 const r=manifest.records.find(x=>x.module===module&&x.id===recordId);
 check(r&&r.media_objects.length===0&&r.dependencies.length===0,'local record is missing or contains unsupported dependencies');
 const d=manifest.objects.find(x=>x.object_sha256===r.record_object);
 check(d&&d.size<=1800000,'local record exceeds current cloud size limit');
 const b=new Uint8Array(d.size);let at=0;
 await stageVerifiedObject(d,readStagedArchiveChunks(db,session,d.object_sha256),async bytes=>{b.set(bytes,at);at+=bytes.length;},{maxBytes:1800000});
 const raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b));
 check(raw&&Object.keys(raw).length===2&&Object.hasOwn(specs,raw.kind)&&raw.data&&typeof raw.data==='object'&&!Array.isArray(raw.data),'invalid local record');
 const [target,field]=specs[raw.kind],v=raw.data;
 check(target===module,'local module mismatch');
 const expected=raw.kind==='local_chat'?v.conversation?.id:raw.kind==='local_moment'?'moment:'+v.id:raw.kind==='local_diary'?'diary:'+v.id:raw.kind==='local_daily_profile'?'profile':raw.kind==='local_model_profile'?'owner':v.id;
 check(expected===r.id&&id(expected),'local record identity mismatch');
 const payload={applicationId:manifest.application_id,workspace:'local',exportedAt:manifest.exported_at,includedModules:[module],conversations:[],calendar:[],moments:[],diaries:[],profile:null,dailyProfile:null};
 payload[field]=Array.isArray(payload[field])?[v]:v;
 const envelope=await encodeTransfer(payload);
 const preview=await previewCloudTransfer(db,envelope,[module]),p=preview[module];
 check(preview.can_commit&&p&&!p.blocked.length&&!p.conflicts,'local record is incompatible with cloud target or already differs; original retained');
 if(confirm===true){
   const result=await importCloudTransfer(db,envelope,[module]);
   check(result.can_commit&&!result[module].conflicts,'target changed during restore');
 }
 return {scope:'record_only',module,record_id:r.id,ready:p.ready,existing:p.existing,can_commit:true,committed:confirm===true};
}
