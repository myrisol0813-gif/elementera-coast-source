import { API, requestJson } from '../../core/api.js';
import { activeBranch, appendAssistantVariant } from '../chat-state.js';
import { DEFAULT_MODEL } from './chat-profile.js';
import { requestChatStream } from './chat-stream.js';
import { resolveReplySequenceBudget } from './chat-reply-sequence.js';
import { localDateKey, localDateTimeKey } from './chat-local-time.js';

const CONNECTING_TEXT = '正在连接当前模型……';

export function createReplySequenceGenerator({runtime,toast,dogtalk,setHistory,composerState,renderMessages,patchAssistantStreamingText,saveHistory,voice,chatRequestContext,patchGeneratedVariant,autoTitle}){
  async function generateSequence(conversationId,turnId,original,{dogtalkSubmission,crossWindowSubmission}){
    const turn=original.turns.find(t=>t.id===turnId);
    if(!turn)return false;
    const branch=activeBranch(turn),userId=branch.user?.id;
    if(!userId)return false;
    const cfg=resolveReplySequenceBudget(runtime.runSettings()||{},original.context_settings,branch.assistants.length);
    if(!cfg.maxMessages){toast('当前回复分支已满，请先整理旧版本；没有发起模型请求。');return false;}
    if(runtime.profile.current_image_model||original.context_settings.sticker_send_enabled||original.context_settings.sticker_add_enabled){
      toast('连续回复的媒体工具尚未接通；没有偷偷切换普通回复。');return false;
    }
    const sequenceId=crypto.randomUUID(),controller=new AbortController();
    const task={conversationId,turnId,userIndex:branch.userIndex,assistantIndex:-1,controller,sequenceId};
    runtime.generation=task;composerState();
    const modelId=runtime.profile.current_chat_model||DEFAULT_MODEL;
    const requestContext=chatRequestContext(conversationId);
    let canonical=original,pending=null,started=false,ended=null,committed=0,partial='',lastModel=modelId;
    try{
      // Persist the human message before the server can acquire a run.
      await saveHistory(conversationId,original);
      canonical=runtime.histories.get(conversationId)||original;
      if(controller.signal.aborted)return true;
      const payload={conversation_id:conversationId,source_turn_id:turnId,user_variant_id:userId,sequence_id:sequenceId,
        model:modelId,settings:requestContext.settings,budget:cfg,local_date:localDateKey(),local_datetime:localDateTimeKey(),
        recent_entry_ids:requestContext.recentEntryIds,...(crossWindowSubmission?{cross_window:crossWindowSubmission}:{}),...(dogtalkSubmission?{dogtalk:dogtalkSubmission}:{})};
      await requestChatStream(payload,{endpoint:API.replySequence,signal:controller.signal,onEvent:item=>{
        const data=item.data||{};
        if(runtime.deletedIds.has(conversationId)){controller.abort();return;}
        if(ended)throw Error('unexpected_reply_sequence_event');
        if(item.event==='reply_group_error'){const error=new Error(data.message||'连续回复未能开始。');error.type=data.type;throw error;}
        if(item.event==='reply_group_start'){
          if(started||data.sequence_id!==sequenceId)throw Error('invalid_reply_sequence_start');
          started=true;return;
        }
        if(!started)throw Error('reply_sequence_not_started');
        if(item.event==='reply_begin'){
          if(pending||data.index!==committed||typeof data.message_id!=='string')throw Error('invalid_reply_sequence_step');
          const appended=appendAssistantVariant(canonical,turnId,{id:data.message_id,content:CONNECTING_TEXT,reply_sequence:{id:sequenceId,index:data.index}});
          if(!appended.variant||appended.variant.id!==data.message_id)throw Error('reply_sequence_preview_failed');
          pending=appended;partial='';task.userIndex=appended.userIndex;task.assistantIndex=appended.assistantIndex;
          setHistory(conversationId,appended.state);renderMessages(conversationId);return;
        }
        if(item.event==='reply_delta'){
          if(!pending||data.message_id!==pending.variant.id||typeof data.content!=='string')throw Error('unexpected_reply_delta');
          partial+=data.content;
          patchGeneratedVariant(conversationId,turnId,pending,{content:partial},{render:false});
          patchAssistantStreamingText?.(conversationId,turnId,partial,{messageId:data.message_id,loading:true});return;
        }
        if(item.event==='reply_committed'){
          if(!pending||data.message_id!==pending.variant.id||data.index!==committed||!data.history)throw Error('unexpected_reply_commit');
          const saved=data.history.turns?.find(t=>t.id===turnId);
          const target=saved?.assistant?.variantsByUserVariant?.[String(pending.userIndex)]?.find(v=>v.id===data.message_id);
          if(!target||target.reply_sequence?.id!==sequenceId||target.reply_sequence?.index!==committed)throw Error('unconfirmed_reply_commit');
          canonical=setHistory(conversationId,data.history);lastModel=target.model_id||lastModel;
          committed++;pending=null;task.assistantIndex=-1;
          renderMessages(conversationId);
          if(runtime.currentId===conversationId)runtime.desk?.onConversationChanged(canonical,conversationId);
          return;
        }
        if(item.event==='reply_group_end'){
          if(data.saved!==committed||typeof data.status!=='string')throw Error('unconfirmed_reply_group_end');
          ended=data;return;
        }
      }});
      if(!ended)throw Error('reply_group_incomplete');
    }catch(error){
      if(!runtime.deletedIds.has(conversationId)){
        // The server may have committed after the last visible SSE event.
        // Never save a local placeholder or replay an uncertain paid request.
        try{const fresh=await requestJson(`${API.history}?conversation_id=${encodeURIComponent(conversationId)}`);canonical=setHistory(conversationId,fresh.history);}
        catch{setHistory(conversationId,canonical);}
        if(error.name!=='AbortError')toast(`连续回复未确认完成：${error.message}；不会自动重试。`);
      }
    }finally{
      if(runtime.generation===task)runtime.generation=null;
      task.assistantIndex=-1;
      if(!runtime.deletedIds.has(conversationId)){
        setHistory(conversationId,canonical);renderMessages(conversationId);
        if(runtime.currentId===conversationId)runtime.desk?.onConversationChanged(canonical,conversationId);
      }
      if(ended&&committed&&!runtime.deletedIds.has(conversationId)){
        runtime.finalizing=true;runtime.finalizingConversationId=conversationId;
      }
      composerState();
    }
    if(runtime.deletedIds.has(conversationId))return false;
    if(ended?.message&&ended.status==='failed')toast(ended.message+'；已保存的消息保留。');
    if(committed){void voice?.load(conversationId,{force:true});}
    if(ended&&committed){
      try{
        const organized=await runtime.memory?.onReplyCompleted(conversationId,{modelId:lastModel,sequenceId});
        if(organized?.ok===false)toast('回复组已保存；思维壤整理未确认，保留原纸条。');
        dogtalk?.resetCrossWindow?.({room_scope:'conversation',conversation_id:conversationId});
        autoTitle(conversationId,canonical,turnId).catch(()=>undefined);
      }catch(error){console.warn('[memory:reply-sequence]',error);toast('回复组已保存；思维壤整理未确认。');}
      finally{runtime.finalizing=false;runtime.finalizingConversationId=null;composerState();}
    }
    return true;
  }
  return generateSequence;
}
