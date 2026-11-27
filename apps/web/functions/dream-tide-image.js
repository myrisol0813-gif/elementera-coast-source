import {readProfile} from './chat-store.js';
import {ensureChatAttachmentSchema,getChatAttachmentRecord} from './chat-attachments.js';
import {discoverImageModels,generateIndependentImage,prepareGeneratedImageReadback} from './independent-image.js';
import {prepareAutonomousRecord} from './dream-tide-write-fence.js';

const modelPattern=/^[a-z0-9][a-z0-9_.-]{0,79}\/[a-z0-9][a-z0-9_.-]{0,119}(?::free)?$/i;
const chunkBytes=1500000;
export async function autonomousImageModel(db,env){
  if(env.COAST_DREAM_MEDIA_ENABLED!=='true'||!String(env.OPENROUTER_API_KEY||'').trim())return null;
  const model=(await readProfile(db)).current_image_model;
  return modelPattern.test(model)?model:null;
}
export async function prepareDreamImageReadback(db,cid,id,visionSupported){
  if(visionSupported!==true)return null;
  if(!id.startsWith('att_dream_'))throw Error('invalid autonomous image identity');
  const row=await getChatAttachmentRecord(db,cid,id);
  if(row.turn_id!==null||row.kind!=='image')throw Error('not an independent original');
  const bytes=new Uint8Array(row.data);
  const readback=prepareGeneratedImageReadback({attachmentId:id,bytes,mime:row.mime,visionSupported:true});
  return {id,bytes:bytes.length,message:readback.continuationMessage};
}
export async function generateDreamImage(db,env,input,context,{expectedModel,discover=discoverImageModels,generate=generateIndependentImage}={}){
  if(!context.autonomous_claim||context.autonomous_activity!==true||!input||Object.keys(input).length!==1||typeof input.prompt!=='string'||!input.prompt.trim()||input.prompt.trim().length>4000)
    throw Error('invalid autonomous image request');
  const cid=context.conversation_id,claim=context.autonomous_claim,event=context.autonomous_event;
  const id='att_dream_'+claim.claimId+'_'+event.step+'_'+event.index;
  const check=async()=>{
    if(!expectedModel||await autonomousImageModel(db,env)!==expectedModel||
       !await prepareAutonomousRecord(db,'SELECT 1 AS permitted',[],context,'allowImage','image_generate').first())throw Error('自主生图权限已撤回或模型已变化');
  };
  await ensureChatAttachmentSchema(db);
  await check();
  if(await db.prepare('SELECT id FROM chat_attachments WHERE id=?').bind(id).first())throw Error('already saved');
  const key=String(env.OPENROUTER_API_KEY).trim();
  const catalog=await discover(fetch,key);
  if(!catalog.some(m=>m.id===expectedModel))throw Error('image model unavailable');
  await check();
  const generated=await generate({key,model:expectedModel,allowPaid:true},{prompt:input.prompt.trim()});
  await check();
  if(generated.provider!=='openrouter'||generated.requested_model!==expectedModel)throw Error('image provider mismatch');
  prepareGeneratedImageReadback({attachmentId:id,bytes:generated.bytes,mime:generated.mime,visionSupported:false});
  const ext={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[generated.mime];
  const name='自主活动图像-'+id+'.'+ext,now=Date.now();
  const first=prepareAutonomousRecord(db,`INSERT INTO chat_attachments
    (id,conversation_id,turn_id,kind,name,mime,size,data,created_at,updated_at)
    SELECT ?,?,NULL,'image',?,?,?,?,?,?`,
    [id,cid,name,generated.mime,generated.bytes.length,new Uint8Array(),now,now],context,'allowImage','image_generate');
  const batch=[first];
  for(let p=0,i=0;p<generated.bytes.length;p+=chunkBytes,i++){
    batch.push(db.prepare('INSERT INTO chat_attachment_chunks (attachment_id,chunk_index,data) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM chat_attachments WHERE id=?)').bind(id,i,generated.bytes.slice(p,p+chunkBytes),id));
  }
  if((await db.batch(batch))[0]?.meta?.changes!==1)throw Error('自主生图权限已撤回，未保存');
  const row=await getChatAttachmentRecord(db,cid,id);
  const original=new Uint8Array(row.data);
  if(row.turn_id!==null||original.length!==generated.bytes.length||original.some((v,i)=>v!==generated.bytes[i]))throw Error('original mismatch');
  return {ok:true,id,mime:row.mime,size:row.size,requested_model:expectedModel,reported_model:generated.reported_model??null,cost_usd:generated.cost_usd??null,readback:'not_delivered'};
}
