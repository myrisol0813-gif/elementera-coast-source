import { runManualImageGeneration } from './chat-attachments.js';
import { readConversationState, readProfile } from './chat-store.js';
import { fetchModelCatalog } from './models/model-catalog.js';

const TOOL={type:'function',function:{name:'image_generate',description:'需要用图像表达时，调用此工具绘制一张图片并保存到当前回复。使用屋主已选生图模型及正常API额度；每轮最多一张。仅提供必要绘图提示，不传入密钥、私人记忆原文或历史。成功后若当前聊天模型支持视觉，系统会转交真实图像原件供续答；未收到像素时不要假称看见。',parameters:{type:'object',properties:{prompt:{type:'string',minLength:1,maxLength:4000}},required:['prompt'],additionalProperties:false}}};

/** Request-local session. The public tool receipt contains only metadata;
 * image pixels travel through a separate, one-shot continuation channel. */
export async function attachImageTool(env,assembled,{conversationId,turnId,messageId,roomType,chatModel,enabled,signal,visionOverride=null,expectedImageModel=null}={},deps={}){
  if(!enabled||!turnId||!messageId||!['main','radio'].includes(roomType)||!env.OPENROUTER_API_KEY?.trim()||!assembled.tools?.length)return assembled;
  const db=env.COAST_CHAT_DB;
  const profile=await readProfile(db);
  const selected=profile.current_image_model;
  if(expectedImageModel!==null&&selected!==expectedImageModel)return assembled;
  if(!/^[a-z0-9][a-z0-9_.-]{0,79}\/[a-z0-9][a-z0-9_.-]{0,119}(?::free)?$/i.test(selected))return assembled;
  const state=await readConversationState(db,conversationId);
  const turn=state.turns.find(t=>t.id===turnId),uid=turn?.user?.variants?.[turn.user.active]?.id;
  const target=turn?.assistant?.variantsByUserVariant?.[String(turn.user.active)]?.find(v=>v.id===messageId);
  if(!uid||!target||target.hidden||target.finish_reason!=='image_tool_ready')return assembled;
  let vision=visionOverride;
  if(visionOverride===null)try{const catalog=await (deps.catalog||fetchModelCatalog)(env);const entry=Object.values(catalog.groups||{}).flat().find(m=>m.id===chatModel);
    const modalities=entry?.architecture?.input_modalities;
    if(Array.isArray(modalities))vision=modalities.includes('image');
  }catch{/* unknown vision never gets pixels */}
  let used=false,saved=false,privateMessages=[];
  return {...assembled,tools:[...assembled.tools,TOOL],
    hasGeneratedImage:()=>saved,
    takePrivateContinuation:()=>{const next=privateMessages;privateMessages=[];return next;},
    executeTool:async call=>{
      if(call?.function?.name!=='image_generate')return assembled.executeTool(call);
      if(used||signal?.aborted)return {ok:false,error:'image_tool_unavailable',message:'本轮已经请求过生图或已取消，不会再次调用。'};
      used=true;
      let input;try{input=JSON.parse(call.function.arguments);}catch{return {ok:false,error:'invalid_arguments'};}
      if(!input||Object.keys(input).length!==1||typeof input.prompt!=='string'||!input.prompt.trim()||input.prompt.trim().length>4000)return {ok:false,error:'invalid_arguments'};
      try{
        const result=await runManualImageGeneration(env,{conversation_id:conversationId,turn_id:turnId,user_variant_id:uid,message_id:messageId,prompt:input.prompt},{...deps,modelTool:true,expectedModel:selected,visionSupported:vision,onSaved:r=>{saved=true;if(r.readback.continuationMessage)privateMessages.push(r.readback.continuationMessage);}});
        return {ok:true,attachment:{id:result.attachment.id,type:'image',mime:result.attachment.mime,size:result.attachment.size},readback:result.readback,status:'saved'};
      }catch(e){return {ok:false,error:e?.type||'image_generation_failed',message:'生图未确认完成；不会自动重试，供应商可能已计费。'};}
    }
  };
}
