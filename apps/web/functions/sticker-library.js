import {ensureChatAttachmentSchema,getChatAttachmentRecord,MAX_ATTACHMENT_BYTES} from './chat-attachments.js';
import {readConversationState} from './chat-store.js';
import {attachmentOrigin} from './attachment-origin.js';
import {prepareGeneratedImageReadback} from './independent-image.js';

export class StickerError extends Error {
  constructor(type,message,status=400){super(message);this.type=type;this.status=status;}
}
const fail=(type,message,status)=>{throw new StickerError(type,message,status);};
const identifier=value=>{
  if(typeof value!=='string'||!/^[A-Za-z0-9_.:-]{1,160}$/.test(value))fail('invalid_sticker_source','素材编号无效。');
  return value;
};
const cleanDescription=value=>{
  if(typeof value!=='string'||!value.trim()||value.trim().length>500||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))
    fail('invalid_sticker_description','请填写1—500字的素材说明。');
  return value.trim();
};
const mimeTypes=new Set(['image/png','image/jpeg','image/webp']);
const query=(db,sql,args=[])=>db.prepare(sql).bind(...args);
export async function ensureStickerLibrarySchema(db){
  await ensureChatAttachmentSchema(db);
  await query(db,`CREATE TABLE IF NOT EXISTS coast_sticker_library (
    id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, attachment_id TEXT NOT NULL,
    description TEXT NOT NULL, author TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    UNIQUE(conversation_id,attachment_id)
  )`).run();
}
async function sourceRow(db,cid,aid){
  return query(db,`SELECT a.id,a.conversation_id,a.turn_id,a.kind,a.name,a.mime,a.size
    FROM chat_attachments a JOIN conversations c ON c.id=a.conversation_id
    WHERE a.id=? AND a.conversation_id=? AND a.kind='image'
    AND c.user_id='owner' AND c.deleted_at IS NULL AND c.conversation_kind='chat'`,[aid,cid]).first();
}
async function verifiedOriginal(db,cid,aid){
  const row=await sourceRow(db,cid,aid);
  if(!row||!mimeTypes.has(row.mime)||Number(row.size)<=0||Number(row.size)>MAX_ATTACHMENT_BYTES)
    fail('sticker_source_unavailable','找不到可用的原始图片。',404);
  const original=await getChatAttachmentRecord(db,cid,aid);
  const bytes=original.data instanceof Uint8Array?original.data:new Uint8Array(original.data);
  if(bytes.byteLength!==Number(row.size))fail('sticker_source_corrupt','图片原件长度不一致。',409);
  // Reuse the existing byte signature check, never infer MIME from the name.
  prepareGeneratedImageReadback({attachmentId:aid,bytes,mime:row.mime,visionSupported:false});
  return {row,bytes};
}
const publicEntry=row=>({id:row.id,description:row.description,author:row.author,mime:row.mime,size:Number(row.size),enabled:Boolean(row.enabled)});
/** Internal service. Callers must supply permissions derived from trusted settings,
 * never accept them from model arguments. No route or model tool is installed here. */
export async function registerSticker(db,input,{actor,allowModelAdd=false,conversationId=null}={}){
  if(!['owner','assistant'].includes(actor)||actor==='assistant'&&allowModelAdd!==true)
    fail('sticker_add_denied','未允许模型添加素材。',403);
  const cid=identifier(input.conversation_id),aid=identifier(input.attachment_id),description=cleanDescription(input.description);
  if(actor==='assistant'&&cid!==conversationId)fail('sticker_add_denied','不能从其他窗口擅自添加素材。',403);
  await ensureStickerLibrarySchema(db);
  const {row}=await verifiedOriginal(db,cid,aid);
  if(actor==='assistant'){
    const state=await readConversationState(db,cid),origin=attachmentOrigin(state,row);
    const variant=state.turns.flatMap(t=>Object.values(t.assistant.variantsByUserVariant).flat()).find(v=>v.id===origin.messageId);
    if(origin.role!=='assistant'||origin.status!=='linked'||!variant?.attachments?.some(a=>a.id===aid&&a.image_generation?.message_id===variant.id))
      fail('sticker_add_denied','模型只能登记自己已经保存的生成图片。',403);
  }
  const now=Date.now(),id='sticker_'+crypto.randomUUID();
  // Assistant registration never overwrites a human description or re-enables a disabled asset.
  await query(db,`INSERT INTO coast_sticker_library(id,conversation_id,attachment_id,description,author,enabled,created_at,updated_at)
    VALUES(?,?,?,?,?,1,?,?) ON CONFLICT(conversation_id,attachment_id) DO NOTHING`,[id,cid,aid,description,actor,now,now]).run();
  const record=await query(db,`SELECT s.*,a.mime,a.size FROM coast_sticker_library s JOIN chat_attachments a
    ON a.id=s.attachment_id AND a.conversation_id=s.conversation_id WHERE s.conversation_id=? AND s.attachment_id=?`,[cid,aid]).first();
  return publicEntry(record);
}
export async function setStickerEnabled(db,id,enabled,{actor}={}){
  if(actor!=='owner')fail('sticker_manage_denied','只有屋主可以管理素材权限。',403);
  if(typeof enabled!=='boolean')fail('invalid_sticker_enabled','素材开关无效。');
  await ensureStickerLibrarySchema(db);
  await query(db,'UPDATE coast_sticker_library SET enabled=?,updated_at=? WHERE id=?',[Number(enabled),Date.now(),identifier(id)]).run();
}
/** Only compact descriptions are returned; no raw bytes, source URLs or
 * other-window identifiers are injected into the model context. */
export async function listStickers(db,{q='',cursor=0}={}, {allowSend=false}={}){
  if(allowSend!==true)fail('sticker_send_denied','当前窗口未允许发送表情包。',403);
  if(typeof q!=='string'||q.length>100||!Number.isSafeInteger(cursor)||cursor<0||cursor>100000)
    fail('invalid_sticker_query','素材搜索参数无效。');
  await ensureStickerLibrarySchema(db);
  const like='%'+q.trim().replace(/[!%_]/g,x=>'!'+x)+'%';
  const result=await query(db,`SELECT s.id,s.description,s.author,s.enabled,a.mime,a.size
    FROM coast_sticker_library s JOIN chat_attachments a ON a.id=s.attachment_id AND a.conversation_id=s.conversation_id
    JOIN conversations c ON c.id=a.conversation_id
    WHERE s.enabled=1 AND a.kind='image' AND a.mime IN ('image/png','image/jpeg','image/webp')
    AND a.size>0 AND a.size<=? AND c.user_id='owner' AND c.deleted_at IS NULL AND c.conversation_kind='chat'
    AND s.description LIKE ? ESCAPE '!' ORDER BY s.created_at DESC,s.id DESC LIMIT 41 OFFSET ?`,[MAX_ATTACHMENT_BYTES,like,cursor]).all();
  const rows=result.results||[];
  return {items:rows.slice(0,40).map(publicEntry),next_cursor:rows.length>40?cursor+40:null};
}
/** Resolve a selected ID for a trusted delivery layer. Recheck permission and
 * current source at use time, and do not call an image generation provider. */
export async function resolveStickerOriginal(db,id,{allowSend=false}={}){
  if(allowSend!==true)fail('sticker_send_denied','当前窗口未允许发送表情包。',403);
  await ensureStickerLibrarySchema(db);
  const entry=await query(db,'SELECT * FROM coast_sticker_library WHERE id=? AND enabled=1',[identifier(id)]).first();
  if(!entry)fail('sticker_unavailable','素材已停用或不存在。',404);
  const {row,bytes}=await verifiedOriginal(db,entry.conversation_id,entry.attachment_id);
  return {id:entry.id,description:entry.description,name:row.name,mime:row.mime,bytes};
}
