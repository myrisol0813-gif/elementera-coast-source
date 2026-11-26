import { ensureTreasureSchema,resolveTreasureSource,TREASURE_LIMITS } from './coast-vault-treasures.js';
import { ensureMediaLabelSchema,MEDIA_LABEL_LIMIT } from './coast-vault-media-labels.js';
import { ensureStickerLibrarySchema,verifyStickerArchiveOriginal } from './sticker-library.js';
import { ensureChatAttachmentSchema } from './chat-attachments.js';
import { ensureChatSchema } from './chat-store.js';
import { digestBytes } from './coast-archive-v2-chunks.js';
const check=(ok,msg)=>{if(!ok)throw Object.assign(Error(msg),{status:409});};
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(v);
const stamp=v=>Number.isSafeInteger(v)&&v>=0;
const text=(v,n)=>typeof v==='string'&&v.length<=n;
const exact=(v,fields)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===fields.length&&fields.every(k=>Object.hasOwn(v,k));
const identity=async(kind,key)=>kind+':'+await digestBytes(new TextEncoder().encode(JSON.stringify([key])));
export async function prepareArchiveVault(db,r,raw,manifest){
 check(manifest.application_id==='com.elementeracoast.source','vault restore currently requires same-edition backend archive');
 const v=raw?.data,kind=raw?.kind;
 check(exact(raw,['kind','data']),'invalid vault envelope');
 let fields,table,key;
 if(kind==='vault_treasures'){
   fields='id,source_key,kind,conversation_id,turn_id,message_id,source_id,role,excerpt,selections_json,notes,created_at,updated_at'.split(',');
   table='coast_vault_treasures';key='id';
   check(exact(v,fields)&&id(v.id)&&id(v.conversation_id)&&id(v.source_id)&&['text','soil','audio','image','file'].includes(v.kind)&&v.source_key===v.kind+':'+v.conversation_id+':'+v.source_id&&r.id===await identity(kind,v.id),'invalid treasure identity');
   check(stamp(v.created_at)&&stamp(v.updated_at)&&text(v.notes,TREASURE_LIMITS.note_chars)&&text(v.excerpt,TREASURE_LIMITS.excerpt_chars),'invalid treasure text or dates');
   const indices=JSON.parse(v.selections_json);
   check(Array.isArray(indices)&&indices.length<=TREASURE_LIMITS.paragraphs_per_item&&indices.every((n,i)=>Number.isInteger(n)&&n>=0&&(i===0||indices[i-1]<n)),'invalid selection');
   check(r.dependencies.includes('chat/'+v.conversation_id),'missing treasure window dependency');
   await ensureChatSchema(db);
   check(await db.prepare("SELECT id FROM conversations WHERE id=? AND user_id='owner' AND deleted_at IS NULL AND conversation_kind='chat'").bind(v.conversation_id).first(),'restore owner chat first');
   const source=await resolveTreasureSource(db,{kind:v.kind,conversation_id:v.conversation_id,source_id:v.source_id,paragraph_indices:indices.length?indices:null});
   // Historical saved excerpts can differ from the current source after edits.
   // Preserve their original bytes, but never attach them to the wrong origin.
   check(source.turnId===v.turn_id&&source.messageId===v.message_id&&source.role===v.role&&source.sourceKey===v.source_key,'treasure source metadata differs');
   await ensureTreasureSchema(db);
   const priorKey=await db.prepare('SELECT id FROM '+table+' WHERE source_key=?').bind(v.source_key).first();
   check(!priorKey||priorKey.id===v.id,'treasure source already collected under another id');
 }else if(kind==='vault_stickers'){
   fields='id,conversation_id,attachment_id,description,author,enabled,created_at,updated_at'.split(',');
   table='coast_sticker_library';key='id';
   check(exact(v,fields)&&id(v.id)&&v.id.startsWith('sticker_')&&id(v.conversation_id)&&id(v.attachment_id)&&r.id===await identity(kind,v.id),'invalid sticker identity');
   check(text(v.description,500)&&v.description.trim()===v.description&&v.description.length>0&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v.description)&&['owner','assistant'].includes(v.author)&&[0,1].includes(v.enabled)&&stamp(v.created_at)&&stamp(v.updated_at)&&v.updated_at>=v.created_at,'invalid sticker record');
   check(r.dependencies.length===2&&r.dependencies.includes('chat/'+v.conversation_id)&&r.dependencies.includes('attachments/'+v.attachment_id),'missing sticker original dependency');
   await ensureStickerLibrarySchema(db);
   try{await verifyStickerArchiveOriginal(db,v.conversation_id,v.attachment_id);}catch{check(false,'restore verified sticker original first');}
   const prior=await db.prepare('SELECT id FROM '+table+' WHERE conversation_id=? AND attachment_id=?').bind(v.conversation_id,v.attachment_id).first();
   check(!prior||prior.id===v.id,'sticker source already registered under another id');
 }else if(kind==='vault_media_labels'){
   fields=['source_key','display_name','updated_at'];table='coast_vault_media_labels';key='source_key';
   check(exact(v,fields)&&typeof v.source_key==='string'&&v.source_key.length<=327&&v.source_key.startsWith('image:')&&r.id===await identity(kind,v.source_key)&&stamp(v.updated_at)&&text(v.display_name,MEDIA_LABEL_LIMIT)&&v.display_name.trim()===v.display_name&&v.display_name.length>0&&!/[\x00-\x1f\x7f]/.test(v.display_name),'invalid media label');
   await ensureChatAttachmentSchema(db);
   const row=await db.prepare("SELECT a.id FROM chat_attachments a JOIN conversations c ON c.id=a.conversation_id WHERE 'image:'||a.conversation_id||':'||a.id=? AND a.kind='image' AND c.user_id='owner' AND c.deleted_at IS NULL AND c.conversation_kind='chat'").bind(v.source_key).first();
   check(row,'restore original owner image first');await ensureMediaLabelSchema(db);
 }else check(false,'unsupported vault record');
 const existing=await db.prepare('SELECT '+fields.join(',')+' FROM '+table+' WHERE '+key+'=?').bind(v[key]).first();
 check(!existing||fields.every(k=>existing[k]===v[k]),'target vault record differs; never overwrite');
 return {existing:!!existing,statements:existing?[]:[db.prepare('INSERT INTO '+table+' ('+fields.join(',')+') VALUES ('+fields.map(()=>'?').join(',')+')').bind(...fields.map(k=>v[k]))]};
}
