package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.remote.*
import java.time.Instant

internal object LocalImageRecovery {
    const val GRACE_MS=600000L
    fun recover(history:RemoteHistory,now:Instant=Instant.now()):RemoteHistory {
        var changed=false
        val turns=history.turns.map{t->t.copy(assistant=t.assistant.copy(variantsByUserVariant=t.assistant.variantsByUserVariant.mapValues{(_,vs)->vs.map{v->
            if(v.finishReason !in setOf("image_pending","image_tool_ready","image_saved","sticker_tool_ready","sticker_saved"))v
            else{
                val start=runCatching{Instant.parse(v.createdAt).toEpochMilli()}.getOrNull()
                if(start!=null&&now.toEpochMilli()-start<GRACE_MS)v else{
                    changed=true
                    val saved=v.attachments.any{it.imageGeneration?.messageId==v.id||it.stickerDelivery?.messageId==v.id}
                    val waiting=v.finishReason in setOf("image_tool_ready","sticker_tool_ready")
                    val sticker=v.finishReason?.startsWith("sticker_")==true
                    v.copy(content=if(waiting&&!saved)""else v.content,finishReason=if(saved) { if(sticker)"sticker_saved_interrupted" else "image_saved_interrupted" }else if(waiting)"cancelled"else "image_failed",
                        errorDetail=if(saved)"图片已保存，后续文字未完成。"else if(waiting) {if(sticker)"回复已中断，未发送表情包。" else "回复已中断，未确认发起绘图。"}else "绘图结果未确认；原件未收到或保存未完成，供应商可能已计费。不会自动重试。")
                }
            }
        }}))}
        return if(changed)history.copy(turns=turns,updatedAt=now.toString())else history
    }
    fun protect(old:RemoteHistory,next:RemoteHistory,deleteRevision:String?):RemoteHistory {
        val protected=old.turns.flatMap{t->t.assistant.variantsByUserVariant.flatMap{(k,vs)->vs.map{Triple(t.id,t.user.variants.getOrNull(k.toIntOrNull()?:-1)?.id,it)}}}
        val incoming=next.turns.flatMap{t->t.assistant.variantsByUserVariant.flatMap{(k,vs)->vs.map{Triple(t.id,t.user.variants.getOrNull(k.toIntOrNull()?:-1)?.id,it)}}}
        for((tid,uid,v) in protected){
            val match=incoming.firstOrNull{it.first==tid&&it.second==uid&&it.third.id==v.id}?.third
            val hasImage=v.attachments.any{it.imageGeneration?.messageId==v.id||it.stickerDelivery?.messageId==v.id}
            if(v.finishReason=="image_pending"&&match?.finishReason!="image_pending")throw ManualImageFailure("image_pending","绘图仍在进行；请刷新原窗口，不覆盖任务。",409)
            if(match==null&&hasImage&&deleteRevision!=old.updatedAt)throw ManualImageFailure("image_history_changed","历史已包含新生成的图片，请刷新后再明确删除。",409)
        }
        return next.copy(turns=next.turns.map{t->t.copy(assistant=t.assistant.copy(variantsByUserVariant=t.assistant.variantsByUserVariant.mapValues{(k,vs)->
            val uid=t.user.variants.getOrNull(k.toIntOrNull()?:-1)?.id
            vs.map{v->
                val previous=protected.firstOrNull{it.first==t.id&&it.second==uid&&it.third.id==v.id}?.third
                if(previous==null)v else if(previous.finishReason=="image_pending")previous else {
                    val saved=previous.attachments.filter{it.imageGeneration?.messageId==previous.id||it.stickerDelivery?.messageId==previous.id}
                    val stale=v.finishReason in setOf("image_pending","image_tool_ready","sticker_tool_ready")&&(saved.isNotEmpty()||previous.finishReason in setOf("image_failed","image_saved_interrupted","sticker_saved_interrupted","cancelled"))
                    v.copy(attachments=v.attachments.filterNot{a->saved.any{it.id==a.id}}+saved,
                        finishReason=if(stale)previous.finishReason else v.finishReason,
                        content=if(stale)previous.content else v.content,errorDetail=if(stale)previous.errorDetail else v.errorDetail)
                }
            }
        }))})
    }
}
