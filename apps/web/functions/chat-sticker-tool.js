import {readConversationState} from './chat-store.js';
import {listStickers,registerSticker,deliverSticker} from './sticker-library.js';
import {startToolRun,finishToolRun} from './tool-run-log.js';
import {buildFurnitureSummary,sanitizeFurnitureRuns} from './tool-furniture-summary.js';
const fn=(name,description,properties,required)=>({type:'function',function:{name,description,parameters:{type:'object',properties,required,additionalProperties:false}}});
const search=fn('sticker_search','按说明查找已登记的表情包。仅返回素材编号和文字说明，不读取像素；按需使用，不必每轮发送。',{q:{type:'string',maxLength:100},cursor:{type:'integer',minimum:0}},[]);
const send=fn('sticker_send','选择目录中的一张表情包，将真实图片原件发送至当前助手回复。不调用生图服务。',{sticker_id:{type:'string'}},['sticker_id']);
const add=fn('sticker_add','将本窗口自己已经生成并保存的图片登记成表情包，填写供以后选择的简明说明。',{attachment_id:{type:'string'},description:{type:'string',minLength:1,maxLength:500}},['attachment_id','description']);
const names=new Set([search.function.name,send.function.name,add.function.name]);
function target(state,tid,mid){
 const t=state.turns.find(t=>t.id===tid),i=t?.user?.active,uid=t?.user?.variants?.[i]?.id;
 const v=t?.assistant?.variantsByUserVariant?.[String(i)]?.find(v=>v.id===mid);
 return uid&&!t.user.variants[i].hidden&&v&&!v.hidden&&['sticker_tool_ready','sticker_saved','image_tool_ready','image_saved'].includes(v.finish_reason)?{uid,v}:null;
}
export async function attachStickerTools(env,assembled,{conversationId,turnId,messageId,roomType,signal}={}){
 if(!conversationId||!turnId||!messageId||!['main','radio'].includes(roomType))return assembled;
 const db=env.COAST_CHAT_DB,state=await readConversationState(db,conversationId);
 const ready=target(state,turnId,messageId),settings=state.context_settings||{};
 if(!ready||(!settings.sticker_send_enabled&&!settings.sticker_add_enabled))return assembled;
 const tools=[...(assembled.tools||[]),...(settings.sticker_send_enabled?[search,send]:[]),...(settings.sticker_add_enabled?[add]:[])];
 let saved=false;const runs=[];
 const originalHasImage=assembled.hasGeneratedImage;
 return {...assembled,tools,
 hasGeneratedImage:()=>saved||Boolean(originalHasImage?.()),
 furnitureRuns:()=>sanitizeFurnitureRuns([...(assembled.furnitureRuns?.()||[]),...runs]),
 executeTool:async call=>{
  const name=call?.function?.name;
  if(!names.has(name))return assembled.executeTool(call);
  let result,auditId;
  const toolKey='sticker.'+name.slice('sticker_'.length);
  try{
   auditId=await startToolRun(db,{tool_key:toolKey},{},{actor:'api_model_partner',room_scope:roomType==='main'?'main_chat':roomType,conversation_id:conversationId});
   if(signal?.aborted)throw Object.assign(new Error('本轮已取消。'),{type:'cancelled'});
   const fresh=await readConversationState(db,conversationId),current=target(fresh,turnId,messageId),cfg=fresh.context_settings||{};
   if(!current||current.uid!==ready.uid||!tools.some(t=>t.function?.name===name))throw Object.assign(new Error('本轮回复已变化。'),{type:'sticker_reservation_lost'});
   const permit=name==='sticker_add'?cfg.sticker_add_enabled:cfg.sticker_send_enabled;
   if(permit!==true)throw Object.assign(new Error('当前窗口未授权该表情包操作。'),{type:'sticker_permission_denied'});
   const args=JSON.parse(call.function.arguments||'{}');
   const keys=name==='sticker_search'?['q','cursor']:name==='sticker_send'?['sticker_id']:['attachment_id','description'];
   if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>!keys.includes(k)))throw Object.assign(new Error('参数无效。'),{type:'invalid_arguments'});
   if(name==='sticker_search')result={ok:true,...await listStickers(db,args,{allowSend:true})};
   if(name==='sticker_add')result={ok:true,item:await registerSticker(db,{...args,conversation_id:conversationId},{actor:'assistant',allowModelAdd:true,conversationId})};
   if(name==='sticker_send'){
    const sent=await deliverSticker(db,{conversation_id:conversationId,turn_id:turnId,user_variant_id:current.uid,message_id:messageId,sticker_id:args.sticker_id},{allowSend:true});
    saved=true;const a=sent.attachment;
    result={ok:true,status:'saved',attachment:{id:a.id,type:a.type,mime:a.mime,size:a.size},reused:sent.reused};
   }
  }catch(error){result={ok:false,error:String(error?.type||'sticker_operation_failed'),message:'表情包操作未完成。'};}
  if(auditId)await finishToolRun(db,auditId,{status:result.ok?'success':'error',output:{ok:result.ok,count:name==='sticker_search'?result.items?.length:1}}).catch(()=>{});
  runs.push(buildFurnitureSummary({id:auditId||'sticker:'+crypto.randomUUID(),toolKey,displayName:name==='sticker_search'?'查找了表情包':name==='sticker_add'?'登记了表情包':'发送了表情包',status:result.ok?'success':'error',output:{count:name==='sticker_search'?result.items?.length:1},error:{type:result.error}}));
  return result;
 }};
}
