import { API, requestJson } from '../../core/api.js';
import { activeBranch, appendTurn } from '../chat-state.js';

export function createManualImageSender({runtime,toast,currentHistory,setHistory,composerState,renderMessages,saveHistory}){
  async function sendImage(text) {
    const prompt=String(text||'').trim(), id=runtime.currentId;
    if(!id||!runtime.composerReady||runtime.generation||runtime.finalizing||runtime.pendingComposerSend)return false;
    if(!prompt||prompt.length>4000){toast('请输入1—4000字符的绘图提示。');return false;}
    if(!runtime.profile.current_image_model){toast('请先在模型箱选择生图模型。');return false;}
    const conversation=runtime.conversations.find(item=>item.id===id);
    if(!['main','radio'].includes(conversation?.room_type)){toast('当前窗口不支持生图。');return false;}
    const revision=runtime.composerDrafts?.write(id,text);
    const appended=appendTurn(currentHistory(),prompt,{message_source:'xiaohan_web',display_author:'屋主'});
    const turn=appended.turn;
    const messageId='assistant_image_'+crypto.randomUUID();
    runtime.finalizing=true;runtime.finalizingConversationId=id;
    runtime.pendingComposerSend=id;
    composerState();
    let accepted=false,requested=false;
    try {
      await saveHistory(id,appended.state);
      accepted=true;runtime.composerDrafts?.accepted(id,revision);
      if(runtime.currentId===id)renderMessages(id);
      toast('正在绘制图片…');
      requested=true;
      const result=await requestJson(API.imageGenerate,{method:'POST',body:JSON.stringify({conversation_id:id,turn_id:turn.id,user_variant_id:activeBranch(turn).user.id,message_id:messageId,prompt})});
      if(!runtime.deletedIds.has(id)){setHistory(id,result.history);if(runtime.currentId===id)renderMessages(id);}
      toast('图片已保存。');
    }catch(error){
      // The server may have committed the original even if the response was lost.
      // Refresh that exact window; never write our pre-generation snapshot over it.
      if(requested&&!runtime.deletedIds.has(id))try{
        const fresh=await requestJson(API.history+'?conversation_id='+encodeURIComponent(id));
        setHistory(id,fresh.history);if(runtime.currentId===id)renderMessages(id);
      }catch{ /* retain the last known state, no automatic generation retry */ }
      toast('生图未确认完成：'+error.message+'；不会自动重试。',5200);
    }finally{
      runtime.pendingComposerSend=null;runtime.finalizing=false;runtime.finalizingConversationId=null;composerState();
    }
    return accepted;
  }
  return sendImage;
}

/** Reserve the exact normal-chat variant before exposing the model image tool. */
export async function prepareAutonomousImageTurn(runtime,conversationId,appended,payload,saveHistory){
  const image=runtime.profile.current_image_model;
  const settings=appended.state.context_settings||{};
  if(!image&&!settings.sticker_send_enabled&&!settings.sticker_add_enabled)return;
  appended.variant.finish_reason=image?'image_tool_ready':'sticker_tool_ready';
  await saveHistory(conversationId,appended.state);
  if(image){payload.image_tool_enabled=true;payload.image_model_id=image;}
}
export function imageToolSucceeded(data){
  return ['image_generate','sticker_send'].includes(data?.name)&&data?.result?.ok===true&&data.result.status==='saved'&&typeof data.result.attachment?.id==='string';
}
