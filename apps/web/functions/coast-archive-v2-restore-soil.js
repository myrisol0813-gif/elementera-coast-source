import { validateArchiveManifest } from './coast-archive-v2-manifest.js';
import { stageVerifiedObject } from './coast-archive-v2-chunks.js';
import { readStagedArchiveChunks } from './coast-archive-v2-stage.js';
import { readArchiveChat } from './coast-archive-v2-records.js';
import { prepareArchiveSoil } from './coast-archive-v2-restore-extra.js';
import { ensureMemorySchema } from './memory-store/memory-schema.js';

export const SOIL_MODULES=['thinking_soil','thinking_soil_history'];
const check=(ok,msg)=>{if(!ok)throw Object.assign(Error(msg),{status:409});};
export async function restoreArchiveSoil(db,sessionId,manifest,module,recordId,confirm=false){
 await validateArchiveManifest(manifest);
 check(SOIL_MODULES.includes(module)&&manifest.application_id==='com.elementeracoast.source','soil requires same-edition archive');
 const r=manifest.records.find(x=>x.module===module&&x.id===recordId);
 check(r&&r.dependencies.length===1&&r.media_objects.length===0,'invalid soil dependencies');
 const d=manifest.objects.find(x=>x.object_sha256===r.record_object);
 check(d&&d.size<=1800000,'soil record too large');
 const bytes=new Uint8Array(d.size);let at=0;
 await stageVerifiedObject(d,readStagedArchiveChunks(db,sessionId,d.object_sha256),async b=>{bytes.set(b,at);at+=b.length;},{maxBytes:1800000});
 const raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),v=raw?.data;
 check(raw&&Object.keys(raw).length===2&&raw.kind===module&&v&&r.dependencies[0]==='chat/'+v.conversation_id,'invalid soil envelope');
 const archived=await readArchiveChat(db,v.conversation_id);
 const history=JSON.parse(archived.history_json),turns=new Set(),variantTurns=new Map();
 for(const t of history.turns){turns.add(t.id);for(const a of Object.values(t.assistant.variantsByUserVariant).flat())variantTurns.set(a.id,t.id);}
 const historical=module==='thinking_soil_history';
 if(historical)check(turns.has(v.turn_id)&&variantTurns.get(v.assistant_message_id)===v.turn_id,'soil historical source missing');
 await ensureMemorySchema(db);
 const existing=historical?await db.prepare('SELECT * FROM conversation_soil_snapshots WHERE conversation_id=? AND assistant_message_id=?').bind(v.conversation_id,v.assistant_message_id).first():await db.prepare('SELECT * FROM conversation_soils WHERE conversation_id=?').bind(v.conversation_id).first();
 // Reuse the canonical field/identity validator even on repeat imports.
 const plan=await prepareArchiveSoil(db,r.id,module,v,{conversationId:v.conversation_id,turns,variantTurns,allowExisting:true});
 if(existing)check(Object.keys(v).length===Object.keys(existing).length&&Object.keys(v).every(k=>existing[k]===v[k]),'target soil differs; never overwrite');
 if(confirm===true&&!existing)await db.batch(plan);
 return {scope:'record_only',module,record_id:recordId,ready:existing?0:1,existing:existing?1:0,can_commit:true,committed:confirm===true};
}
