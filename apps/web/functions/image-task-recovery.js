// Grace period is longer than the provider's 120s deadline. Recovery never
// contacts a provider and never retries a paid operation.
export const IMAGE_RECOVERY_MS=10*60*1000;
export const IMAGE_UNCONFIRMED='绘图结果未确认；原件未收到或保存未完成，供应商可能已计费。不会自动重试。';
export function recoverImageTasks(state,now=Date.now()){
  let changed=false;
  for(const t of state.turns||[])for(const v of Object.values(t.assistant?.variantsByUserVariant||{}).flat()){
    if(!['image_pending','image_tool_ready','image_saved','sticker_tool_ready','sticker_saved'].includes(v.finish_reason))continue;
    const start=Date.parse(v.created_at||'');
    if(Number.isFinite(start)&&now-start<IMAGE_RECOVERY_MS)continue;
    const saved=(v.attachments||[]).some(a=>a.image_generation?.message_id===v.id||a.sticker_delivery?.message_id===v.id);
    const sticker=v.finish_reason.startsWith('sticker_');
    const waiting=v.finish_reason==='image_tool_ready'||v.finish_reason==='sticker_tool_ready';
    v.finish_reason=saved?(sticker?'sticker_saved_interrupted':'image_saved_interrupted'):waiting?'cancelled':'image_failed';
    v.errorDetail=saved?'图片已保存，后续文字未完成。':waiting?(sticker?'回复已中断，未发送表情包。':'回复已中断，未确认发起绘图。'):IMAGE_UNCONFIRMED;
    if(waiting&&!saved)v.content='';
    changed=true;
  }
  return changed;
}
export function protectImageHistory(old,next,{allowDelete=false}={}){
  for(const t of old.turns||[]){
    const incoming=next.turns.find(x=>x.id===t.id);
    for(const [key,variants] of Object.entries(t.assistant.variantsByUserVariant)){
      const uid=t.user.variants[Number(key)]?.id;
      const i=incoming?.user.variants.findIndex(v=>v.id===uid)??-1;
      for(const v of variants){
        const match=i<0?null:incoming.assistant.variantsByUserVariant[String(i)]?.find(x=>x.id===v.id);
        const saved=(v.attachments||[]).filter(a=>a.image_generation?.message_id===v.id||a.sticker_delivery?.message_id===v.id);
        if(v.finish_reason==='image_pending'){
          if(!match||match.finish_reason!=='image_pending')return 'image_pending';
          // Preserve the actual reservation, including its clock.
          Object.assign(match,v);
        }
        if(!match){if(saved.length&&!allowDelete)return 'image_history_changed';continue;}
        if(saved.length){
          match.attachments=[...(match.attachments||[]).filter(a=>!saved.some(x=>x.id===a.id)),...saved];
          if(['image_pending','image_tool_ready','sticker_tool_ready'].includes(match.finish_reason)){
            match.finish_reason=v.finish_reason;match.content=v.content;match.errorDetail=v.errorDetail;
          }
        }
        if(['image_failed','image_saved_interrupted','sticker_saved_interrupted','cancelled'].includes(v.finish_reason)&&['image_pending','image_tool_ready','sticker_tool_ready'].includes(match.finish_reason)){
          match.finish_reason=v.finish_reason;match.errorDetail=v.errorDetail;match.content=v.content;
        }
      }
    }
  }
  return null;
}
