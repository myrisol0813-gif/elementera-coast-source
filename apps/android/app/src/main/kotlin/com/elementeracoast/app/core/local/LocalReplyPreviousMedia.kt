package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.remote.*
import kotlinx.serialization.json.*

/** Canonical prior group media only; transient transport parts are never persisted as user messages. */
internal fun localReplyPreviousMedia(store:LocalPersistence,cid:String,previous:List<RemoteVariant>,vision:Boolean?):Pair<List<JsonObject>,List<RemoteDeskSequenceMessage>>{
    val wire=mutableListOf<JsonObject>()
    val receipts=mutableListOf<RemoteDeskSequenceMessage>()
    val originals=LocalAttachmentStore(store)
    for(v in previous){
        if(v.content.isNotBlank())wire.add(buildJsonObject{put("role","assistant");put("content",v.content)})
        val refs=v.attachments.filter{it.imageGeneration?.messageId==v.id||it.stickerDelivery?.messageId==v.id}
        val delivered=mutableListOf<RemoteDeskAttachmentItem>()
        val withheld=mutableListOf<RemoteDeskAttachmentItem>()
        val parts=mutableListOf<JsonObject>()
        for(a in refs){
            val row=originals.entries().singleOrNull{it.metadata["id"]?.jsonPrimitive?.content==a.id&&it.metadata["conversation_id"]?.jsonPrimitive?.content==cid}
            val read=row?.let{prepareGeneratedImageReadback(a.id,originals.bytes(it),a.mime,vision)}
            if(read?.continuationMessage!=null){
                parts.addAll(read.continuationMessage.getValue("content").jsonArray.map{it.jsonObject}.filter{it["type"]?.jsonPrimitive?.content=="image_url"})
                delivered.add(RemoteDeskAttachmentItem(id=a.id,name=a.name,type="image",mode="image"))
            }else withheld.add(RemoteDeskAttachmentItem(id=a.id,name=a.name,type="image",reason=read?.receipt?.get("status")?.jsonPrimitive?.contentOrNull?:"attachment_not_found"))
        }
        if(refs.isNotEmpty()){
            val note="【本组前序媒体 · 系统转交，非人类新发言】原助手消息 "+v.id+"；已保存图像 "+refs.joinToString("、"){it.id}+"。"+if(parts.isEmpty())"本次未递入像素，不要声称看见。" else "附已核验的部分或全部像素；未递入："+withheld.joinToString("、"){it.id}
            wire.add(buildJsonObject{
                if(parts.isEmpty()){put("role","system");put("content",note)}
                else{put("role","user");put("content",JsonArray(listOf(buildJsonObject{put("type","text");put("text",note)})+parts))}
            })
        }
        receipts.add(RemoteDeskSequenceMessage(v.id,v.content,
            if(refs.isEmpty())null else RemoteDeskAttachments(uploaded=refs.size,deliveredToModel=delivered.size,delivered=delivered,notDelivered=withheld,vision=RemoteDeskAttachmentVision(supported=vision==true,imagesDelivered=parts.size))))
    }
    return wire to receipts
}
