package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.remote.*
import com.elementeracoast.app.core.local.LocalAttachmentStore.Companion.str
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerialName
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.*
import java.time.Instant
import java.util.UUID

/** Workspace-scoped index over real attachment originals. No network or image
 * provider is involved. All mutations use the existing local transaction. */
internal class LocalStickerLibrary(private val store:LocalPersistence){
    @Serializable data class Entry(
        val id:String,@SerialName("conversation_id") val conversationId:String,
        @SerialName("attachment_id") val attachmentId:String,val description:String,
        val author:String,val enabled:Boolean=true,@SerialName("created_at") val createdAt:Long,
        @SerialName("updated_at") val updatedAt:Long=createdAt
    )
    data class Delivery(val attachment:RemoteAttachment,val reused:Boolean)
    private val serializer=ListSerializer(Entry.serializer())
    private val json=Json{ignoreUnknownKeys=false;encodeDefaults=true}
    private fun entries(s:LocalPersistence):List<Entry>{
        val raw=s.get(KEY)
        return if(raw.isBlank())emptyList()else json.decodeFromString(serializer,raw).also{rows->
            require(rows.map{it.id}.distinct().size==rows.size)
            require(rows.map{it.conversationId to it.attachmentId}.distinct().size==rows.size)
            rows.forEach{require(ID.matches(it.id)&&ID.matches(it.conversationId)&&ID.matches(it.attachmentId)&&it.author in setOf("owner","assistant")&&it.createdAt>=0&&it.updatedAt>=it.createdAt);require(description(it.description)==it.description)}
        }
    }
    private fun write(s:LocalPersistence,rows:List<Entry>){s.put(KEY,json.encodeToString(serializer,rows));require(entries(s)==rows)}
    private fun description(raw:String)=raw.trim().also{require(it.length in 1..500&&it.none{c->c.code<32&&c !in listOf('\n','\r','\t')||c.code==127}){"请输入1—500字的素材说明。"}}
    private fun source(s:LocalPersistence,cid:String,aid:String):LocalAttachmentStore.Original?{
        if(RemoteCacheStore(s,strictReads=true).conversations().none{it.id==cid&&it.deletedAt==null})return null
        return LocalAttachmentStore(s).entries().singleOrNull{it.metadata.str("conversation_id")==cid&&it.metadata.str("id")==aid&&it.metadata.str("kind")=="image"&&it.metadata.str("mime") in MIMES}
    }
    private fun original(s:LocalPersistence,cid:String,aid:String):Pair<LocalAttachmentStore.Original,ByteArray>{
        val row=requireNotNull(source(s,cid,aid)){"素材原件不可用。"}
        val bytes=LocalAttachmentStore(s).bytes(row)
        prepareGeneratedImageReadback(aid,bytes,row.metadata.str("mime"),false)
        return row to bytes
    }
    fun upload(name:String,mime:String,raw:String,bytes:ByteArray):Entry=store.atomic{s->
        val desc=description(raw)
        require(mime in MIMES&&bytes.size in 1..8*1024*1024){"请选择8 MiB以内的 PNG、JPEG 或 WebP。"}
        prepareGeneratedImageReadback("upload",bytes,mime,false)
        val safeName=name.map{if(it in listOf('\\','/','\r','\n','\t'))' ' else it}.joinToString("").trim().take(180).ifBlank{"表情包"}
        val cache=RemoteCacheStore(s,strictReads=true);val all=cache.conversations()
        val now=Instant.now().toString()
        val source=all.filter{it.source=="sticker_library"&&it.deletedAt==null}.sortedWith(compareBy<RemoteConversation>{it.createdAt.orEmpty()}.thenBy{it.id}).firstOrNull()
            ?:RemoteConversation("sticker-source-"+UUID.randomUUID(),"表情包原件","main",now,now,source="sticker_library",titleManual=true).also{c->
                cache.putConversations(all+c);cache.putHistory(c.id,RemoteHistory(conversationId=c.id,updatedAt=now))
            }
        val attachment=LocalAttachmentStore(s).upload(source.id,safeName,mime,bytes)
        require(original(s,source.id,attachment.id).second.contentEquals(bytes))
        val e=Entry("sticker_"+UUID.randomUUID(),source.id,attachment.id,desc,"owner",true,System.currentTimeMillis())
        write(s,entries(s)+e);e
    }
    fun listOwner():List<Entry> = store.readConsistent{entries(it)}
    fun archiveRows():List<JsonObject>{
        val live=RemoteCacheStore(store,strictReads=true).conversations().filter{it.deletedAt==null}.map{it.id}.toSet()
        return entries(store).filter{it.conversationId in live}.map{e->
            original(store,e.conversationId,e.attachmentId)
            buildJsonObject{
                put("id",e.id);put("conversation_id",e.conversationId);put("attachment_id",e.attachmentId);put("description",e.description)
                put("author",e.author);put("enabled",if(e.enabled)1 else 0);put("created_at",e.createdAt);put("updated_at",e.updatedAt)
            }
        }
    }
    fun restoreRows(rows:List<JsonObject>,histories:Map<String,RemoteHistory>,conflicts:Set<String>,attachments:List<JsonObject>,write:Boolean):LocalRestoreCount{
        val incoming=rows.map{r->
            require(r.keys==setOf("id","conversation_id","attachment_id","description","author","enabled","created_at","updated_at"))
            val enabled=r.getValue("enabled").jsonPrimitive.int;require(enabled in 0..1)
            val e=json.decodeFromJsonElement(Entry.serializer(),JsonObject(r+("enabled" to JsonPrimitive(enabled==1))))
            require(ID.matches(e.id)&&e.id.startsWith("sticker_")&&ID.matches(e.conversationId)&&ID.matches(e.attachmentId)&&e.author in setOf("owner","assistant")&&e.createdAt>=0&&e.updatedAt>=e.createdAt&&description(e.description)==e.description)
            require(e.conversationId in histories&&e.conversationId !in conflicts)
            require(attachments.any{it.str("id")==e.attachmentId&&it.str("conversation_id")==e.conversationId&&it.str("kind")=="image"&&it.str("mime") in MIMES}){"表情包缺少原始图片。"}
            e
        }
        val old=entries(store);val byId=old.associateBy{it.id}
        require(incoming.map{it.id}.distinct().size==incoming.size&&incoming.all{byId[it.id]==null||byId[it.id]==it}){"目标已有不同的表情包，不覆盖。"}
        val fresh=incoming.filter{it.id !in byId}
        val next=old+fresh
        require(next.map{it.conversationId to it.attachmentId}.distinct().size==next.size){"素材已用另一编号登记。"}
        if(write){incoming.forEach{original(store,it.conversationId,it.attachmentId)};write(store,next)}
        return LocalRestoreCount(ready=fresh.size,existing=incoming.size-fresh.size,conflicts=0)
    }
    fun ownerPage(query:String="",cursor:Int=0):JsonObject=store.readConsistent{s->
        require(query.length<=100&&cursor in 0..100000)
        val rows=entries(s).filter{it.description.contains(query.trim(),ignoreCase=true)}.sortedWith(compareByDescending<Entry>{it.createdAt}.thenByDescending{it.id}).drop(cursor).take(41)
        buildJsonObject{
            put("ok",true)
            put("items",JsonArray(rows.take(40).map{e->
                val a=source(s,e.conversationId,e.attachmentId)
                buildJsonObject{
                    put("id",e.id);put("conversation_id",e.conversationId);put("attachment_id",e.attachmentId)
                    put("description",e.description);put("author",e.author);put("enabled",e.enabled);put("available",a!=null)
                    put("name",a?.metadata?.str("name").orEmpty())
                }
            }))
            put("next_cursor",if(rows.size>40)JsonPrimitive(cursor+40)else JsonNull)
        }
    }
    fun register(cid:String,aid:String,raw:String,actor:String,allowModelAdd:Boolean=false,activeConversationId:String?=null):Entry = store.atomic{s->
        require(actor in setOf("owner","assistant")&&ID.matches(cid)&&ID.matches(aid))
        val desc=description(raw)
        val (row,_)=original(s,cid,aid)
        if(actor=="assistant"){
            val h=RemoteCacheStore(s,strictReads=true).history(cid)
            require(allowModelAdd&&activeConversationId==cid&&h?.contextSettings?.stickerAddEnabled==true&&h.contextSettings.localModelWriteEnabled){"未授权模型添加素材。"}
            val origin=attachmentOrigin(h,row.metadata)
            require(origin.role=="assistant"&&origin.status=="linked"&&h.turns.flatMap{it.assistant.variantsByUserVariant.values.flatten()}.any{v->v.id==origin.messageId&&v.attachments.any{it.id==aid&&it.imageGeneration?.messageId==v.id}}){"仅可登记自己已保存的生成图片。"}
        }
        val rows=entries(s)
        rows.firstOrNull{it.conversationId==cid&&it.attachmentId==aid}?:Entry("sticker_"+UUID.randomUUID(),cid,aid,desc,actor,true,System.currentTimeMillis()).also{write(s,rows+it)}
    }
    fun update(id:String,actor:String,desc:String?=null,enabled:Boolean?=null)=store.atomic{s->
        require(actor=="owner"&&ID.matches(id));val rows=entries(s)
        require(rows.any{it.id==id})
        write(s,rows.map{if(it.id==id)it.copy(description=desc?.let(::description)?:it.description,enabled=enabled?:it.enabled,updatedAt=maxOf(it.updatedAt,System.currentTimeMillis()))else it})
    }
    fun remove(id:String,actor:String)=store.atomic{s->
        require(actor=="owner"&&ID.matches(id));write(s,entries(s).filterNot{it.id==id})
    }
    fun search(cid:String,query:String="",cursor:Int=0,allowSend:Boolean=false):JsonObject=store.readConsistent{s->
        val h=RemoteCacheStore(s,strictReads=true).history(cid)
        require(allowSend&&h?.contextSettings?.stickerSendEnabled==true&&h.contextSettings.localModelToolsEnabled){"当前窗口未授权表情包。"}
        require(query.length<=100&&cursor in 0..100000)
        val rows=entries(s).asSequence().filter{it.enabled&&it.description.contains(query.trim(),ignoreCase=true)}
            .sortedWith(compareByDescending<Entry>{it.createdAt}.thenByDescending{it.id})
            .mapNotNull{e->source(s,e.conversationId,e.attachmentId)?.let{e to it}}.drop(cursor).take(41).toList()
        buildJsonObject{
            put("items",JsonArray(rows.take(40).map{(e,a)->buildJsonObject{put("id",e.id);put("description",e.description);put("author",e.author);put("mime",a.metadata.str("mime"));put("size",a.metadata.getValue("size"))}}))
            put("next_cursor",if(rows.size>40)JsonPrimitive(cursor+40)else JsonNull)
        }
    }
    fun deliver(cid:String,tid:String,uid:String,mid:String,stickerId:String,allowSend:Boolean=false):Delivery=store.atomic{s->
        require(allowSend&&listOf(cid,tid,uid,mid,stickerId).all(ID::matches))
        val cache=RemoteCacheStore(s,strictReads=true)
        require(cache.conversations().any{it.id==cid&&it.deletedAt==null&&it.roomType in setOf("main","radio")})
        val h=requireNotNull(cache.history(cid))
        require(h.contextSettings.stickerSendEnabled&&h.contextSettings.localModelWriteEnabled&&h.contextSettings.localModelToolsEnabled){"当前窗口未授权发送表情包。"}
        val t=h.turns.single{it.id==tid};val i=t.user.active
        require(t.user.variants.getOrNull(i)?.let{it.id==uid&&!it.hidden}==true)
        val key=i.toString();val variants=t.assistant.variantsByUserVariant[key].orEmpty()
        val v=variants.single{it.id==mid}
        require(!v.hidden&&v.finishReason in setOf("sticker_tool_ready","sticker_saved","image_tool_ready","image_saved"))
        val e=entries(s).single{it.id==stickerId&&it.enabled}
        val (row,data)=original(s,e.conversationId,e.attachmentId)
        v.attachments.firstOrNull{it.stickerDelivery==RemoteStickerDelivery(mid,stickerId)}?.let{a->
            val saved=LocalAttachmentStore(s).entries().single{it.metadata.str("id")==a.id&&it.metadata.str("conversation_id")==cid&&it.metadata.str("turn_id")==tid}
            require(LocalAttachmentStore(s).bytes(saved).contentEquals(data))
            return@atomic Delivery(a,true)
        }
        require(v.attachments.size<12){"本轮附件已满。"}
        val id="att_"+UUID.randomUUID();val now=System.currentTimeMillis()
        val name=row.metadata.str("name");val mime=row.metadata.str("mime")
        val meta=buildJsonObject{put("id",id);put("conversation_id",cid);put("turn_id",tid);put("kind","image");put("name",name);put("mime",mime);put("size",data.size);put("created_at",now);put("updated_at",now)}
        LocalAttachmentStore(s).publish(LocalAttachmentStore.Original(meta,ArchiveV2Chunks.digest(data)),data)
        val a=RemoteAttachment(id=id,type="image",name=name,mime=mime,size=data.size.toLong(),storageKey="chat-attachment:"+id,createdAt=Instant.ofEpochMilli(now).toString(),stickerDelivery=RemoteStickerDelivery(mid,stickerId))
        val next=t.copy(assistant=t.assistant.copy(variantsByUserVariant=t.assistant.variantsByUserVariant+(key to variants.map{if(it.id==mid)it.copy(attachments=it.attachments+a,finishReason="sticker_saved",errorDetail=null)else it})))
        cache.putHistory(cid,h.copy(turns=h.turns.map{if(it.id==tid)next else it},updatedAt=Instant.ofEpochMilli(now).toString()))
        Delivery(a,false)
    }
    companion object{
        const val KEY="local.sticker.library.v1"
        private val ID=Regex("[A-Za-z0-9_.:-]{1,160}")
        private val MIMES=setOf("image/png","image/jpeg","image/webp")
    }
}
