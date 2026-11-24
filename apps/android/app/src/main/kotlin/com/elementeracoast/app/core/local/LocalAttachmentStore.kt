package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.remote.*
import kotlinx.serialization.json.*
import java.io.File

/** Verified attachment originals, stored as binary generation members, never as paths
 * from another device or base64 in the JSON database. */
internal class LocalAttachmentStore(private val store:LocalPersistence){
    data class Original(val metadata:JsonObject,val digest:String)
    fun entries():List<Original>{
        val raw=store.get(INDEX)
        if(raw.isEmpty())return emptyList()
        return Json.parseToJsonElement(raw).jsonArray.map{value->
            val r=value.jsonObject;require(r.keys==setOf("metadata","sha256"))
            Original(r.getValue("metadata").jsonObject,r.str("sha256")).also{validate(it.metadata);require(hex.matches(it.digest))}
        }.also{require(it.map{x->x.metadata.str("id")}.distinct().size==it.size)}
    }
    fun bytes(original:Original):ByteArray{
        val data=requireNotNull(store.getBinary(key(original.metadata.str("id")))){"附件原件缺失。"}
        require(data.size.toLong()==original.metadata.getValue("size").jsonPrimitive.long&&ArchiveV2Chunks.digest(data)==original.digest){"附件原件校验失败。"}
        return data
    }
    fun publish(original:Original,data:ByteArray){
        validate(original.metadata);require(data.size.toLong()==original.metadata.getValue("size").jsonPrimitive.long&&ArchiveV2Chunks.digest(data)==original.digest)
        val rows=entries();require(rows.none{it.metadata.str("id")==original.metadata.str("id")})
        store.putBinary(key(original.metadata.str("id")),data)
        require(bytes(original).contentEquals(data))
        writeIndex(rows+original)
    }
    fun upload(cid:String,name:String,mime:String,data:ByteArray):RemoteAttachment{
        val id=java.util.UUID.randomUUID().toString();val now=System.currentTimeMillis()
        val normalizedMime=mime.trim().lowercase(java.util.Locale.ROOT).ifBlank{"application/octet-stream"}
        val kind=if(normalizedMime in setOf("image/png","image/jpeg","image/webp"))"image" else "file"
        val meta=buildJsonObject{put("id",id);put("conversation_id",cid);put("turn_id",JsonNull);put("kind",kind);put("name",name.trim().ifBlank{"附件"});put("mime",normalizedMime);put("size",data.size);put("created_at",now);put("updated_at",now)}
        publish(Original(meta,ArchiveV2Chunks.digest(data)),data)
        return RemoteAttachment(id=id,type=kind,name=meta.str("name"),mime=normalizedMime,size=data.size.toLong(),storageKey="chat-attachment:"+id,createdAt=java.time.Instant.ofEpochMilli(now).toString())
    }
    fun needsHistoryLink(cid:String,history:RemoteHistory):Boolean{
        val linked=entries().filter{it.metadata.str("conversation_id")==cid}.associateBy{it.metadata.str("id")}
        return history.turns.any{t->(t.user.variants+t.assistant.variantsByUserVariant.values.flatten()).any{v->v.attachments.any{a->linked[a.id]?.metadata?.get("turn_id")==JsonNull}}}
    }
    fun linkHistory(cid:String,history:RemoteHistory){
        val rows=entries();val lookup=rows.associateBy{it.metadata.str("id")}
        val turnMap=mutableMapOf<String,String>()
        for(t in history.turns){
            for(v in t.user.variants+t.assistant.variantsByUserVariant.values.flatten()){
                require(v.attachments.size<=12)
                for(a in v.attachments){
                    checkReference(cid,t.id,a,lookup.mapValues{it.value.metadata})
                    val previous=turnMap.put(a.id,t.id);require(previous==null||previous==t.id){"附件不能同时绑定不同轮次。"}
                }
            }
        }
        val now=System.currentTimeMillis()
        val next=rows.map{r->val id=r.metadata.str("id");val turn=turnMap[id]
            if(turn!=null&&r.metadata["turn_id"]==JsonNull)r.copy(metadata=JsonObject(r.metadata+mapOf("turn_id" to JsonPrimitive(turn),"updated_at" to JsonPrimitive(now))))else r
        }
        if(next!=rows)writeIndex(next)
    }
    fun remove(cid:String,id:String):Boolean{
        val rows=entries();val row=rows.firstOrNull{it.metadata.str("conversation_id")==cid&&it.metadata.str("id")==id}?:return false
        writeIndex(rows-row);store.remove(key(id));return true
    }
    data class AttachmentContext(val messages:List<RemoteChatMessage>,val receipt:RemoteDeskAttachments,val imageParts:List<JsonObject> = emptyList())
    fun attachmentContext(cid:String,ids:List<String>,messages:List<RemoteChatMessage>):AttachmentContext{
        require(ids.size<=12&&ids.distinct().size==ids.size){"每轮附件最多12个，不能重复。"}
        if(ids.isEmpty())return AttachmentContext(messages,RemoteDeskAttachments())
        val available=entries().filter{it.metadata.str("conversation_id")==cid}.associateBy{it.metadata.str("id")}
        val items=mutableListOf<RemoteDeskAttachmentItem>();val content=mutableListOf<String>();val images=mutableListOf<JsonObject>();var imageBytes=0L
        for(id in ids){
            val r=requireNotNull(available[id]){"本轮附件不存在或不属于本窗口。"}
            val mime=r.metadata.str("mime");val name=r.metadata.str("name")
            if(r.metadata.str("kind")=="image"){
                val b=bytes(r);imageBytes+=b.size
                require(imageBytes<=16L*1024*1024){"本机单轮图片原件合计最多16 MiB。"}
                fun sig(offset:Int,vararg expected:Int)=b.size>=offset+expected.size&&expected.indices.all{(b[offset+it].toInt() and 255)==expected[it]}
                require(when(mime){"image/png"->sig(0,137,80,78,71,13,10,26,10);"image/jpeg"->sig(0,255,216,255);"image/webp"->sig(0,82,73,70,70)&&sig(8,87,69,66,80);else->false}){"图片 MIME 与原件不一致。"}
                val url="data:"+mime+";base64,"+java.util.Base64.getEncoder().encodeToString(b)
                images.add(buildJsonObject{put("type","image_url");putJsonObject("image_url"){put("url",url)}})
                items.add(RemoteDeskAttachmentItem(id=id,name=name,type="image",mode="image"))
                continue
            }
            val suffix=name.substringAfterLast('.',"").lowercase(java.util.Locale.ROOT)
            require(mime.startsWith("text/")||mime in setOf("application/json","application/xml")||suffix in setOf("txt","md","markdown","json","csv","tsv","xml","yaml","yml","toml","ini","py","js","ts","kt","java","css","html","sql","log","sh","rs","go","c","cpp")){"本机推理支持 PNG/JPEG/WebP 与 UTF-8 文本；其他原件可保存，不能静默发送。"}
            val bytes=bytes(r);require(bytes.size<=1024*1024){"文本附件超过 1 MiB 读取上限。"}
            val text=bytes.decodeToString(throwOnInvalidSequence=true)
            require(!text.contains('\u0000')){"附件不是有效文本。"}
            items.add(RemoteDeskAttachmentItem(id=id,name=name,type=r.metadata.str("kind"),mode="text"))
            content.add("附件："+name+"\n"+text)
        }
        val index=messages.indexOfLast{it.role=="user"};require(index>=0){"附件缺少本轮用户消息。"}
        val next=messages.toMutableList()
        if(content.isNotEmpty())next[index]=next[index].copy(content=next[index].content+"\n\n"+content.joinToString("\n\n"))
        return AttachmentContext(next,RemoteDeskAttachments(uploaded=ids.size,deliveredToModel=items.size,delivered=items,vision=RemoteDeskAttachmentVision(supported=images.isNotEmpty(),imagesDelivered=images.size)),images)
    }
    fun deleteConversation(cid:String){
        val rows=entries();val removed=rows.filter{it.metadata.str("conversation_id")==cid}
        writeIndex(rows-removed.toSet())
        removed.forEach{store.remove(key(it.metadata.str("id")))}
    }
    private fun writeIndex(rows:List<Original>){
        store.put(INDEX,JsonArray(rows.map{buildJsonObject{put("metadata",it.metadata);put("sha256",it.digest)}}).toString())
        require(entries()==rows)
    }
    companion object{
        const val MAX_BYTES=8L*1024*1024
        private const val INDEX="local.attachment.index.v2"
        private val hex=Regex("[0-9a-f]{64}")
        private val id=Regex("[A-Za-z0-9_.:-]{1,160}")
        private val mime=Regex("[a-z0-9.+-]+/[a-z0-9.+-]+")
        private fun key(id:String)="local.attachment.original.v2."+id
        fun JsonObject.str(k:String):String{val v=getValue(k);require(v is JsonPrimitive&&v.isString);return v.content}
        fun validate(m:JsonObject){
            require(m.keys==setOf("id","conversation_id","turn_id","kind","name","mime","size","created_at","updated_at"))
            require(id.matches(m.str("id"))&&id.matches(m.str("conversation_id"))&&(m["turn_id"]==JsonNull||id.matches(m.str("turn_id"))))
            require(m.str("kind") in setOf("image","file")&&m.str("name").length in 1..180&&m.str("mime").length<=120&&mime.matches(m.str("mime")))
            val size=m.getValue("size").jsonPrimitive;require(!size.isString&&size.long in 1..MAX_BYTES)
            for(k in listOf("created_at","updated_at")){val n=m.getValue(k).jsonPrimitive;require(!n.isString&&n.long>=0)}
        }
        fun checkReference(cid:String,tid:String,a:RemoteAttachment,metadata:Map<String,JsonObject>){
            val m=requireNotNull(metadata[a.id]){"聊天引用的附件原件未选择或缺失。"}
            require(m.str("conversation_id")==cid&&(m["turn_id"]==JsonNull||m.str("turn_id")==tid)&&m.str("kind")==a.type&&m.str("name")==a.name&&m.str("mime")==a.mime&&m.getValue("size").jsonPrimitive.long==a.size){"附件原件与消息引用不一致。"}
        }
    }
}

internal object ArchiveV2Attachments{
    data class Item(val metadata:JsonObject,val descriptor:ArchiveV2Object,val file:File)
    fun read(m:ArchiveV2Manifest,stage:ArchiveV2Stage,selection:Set<String>):List<Item>{
        if("attachments" !in selection)return emptyList()
        val objects=m.objects.associateBy{it.objectSha256}
        return m.records.filter{it.module=="attachments"}.map{r->
            require(r.mediaObjects.size==1)
            val record=objects.getValue(r.recordObject)
            val raw=Json.parseToJsonElement(stage.verify(record,1800000).readText(Charsets.UTF_8)).jsonObject
            require(raw.keys==setOf("kind","data")&&raw.getValue("kind")==JsonPrimitive("attachment"))
            val row=raw.getValue("data").jsonObject;LocalAttachmentStore.validate(row)
            val cid=row.getValue("conversation_id").jsonPrimitive.content
            require(r.id==row.getValue("id").jsonPrimitive.content&&r.dependencies==listOf("chat/"+cid))
            val d=objects.getValue(r.mediaObjects.single())
            require(d.size==row.getValue("size").jsonPrimitive.long)
            Item(row,d,stage.verify(d,LocalAttachmentStore.MAX_BYTES))
        }
    }
    fun apply(items:List<Item>,target:LocalPersistence,histories:Map<String,RemoteHistory>,conflictingParents:Set<String>,write:Boolean):LocalRestoreCount{
        val store=LocalAttachmentStore(target);val existing=store.entries().associateBy{it.metadata.getValue("id").jsonPrimitive.content}
        var ready=0;var matched=0;var conflicts=0
        for(item in items){
            val id=item.metadata.getValue("id").jsonPrimitive.content;val cid=item.metadata.getValue("conversation_id").jsonPrimitive.content
            val parent=requireNotNull(histories[cid]){"附件所属原窗口不存在。"}
            require(cid !in conflictingParents){"附件原窗口存在冲突。"}
            val tid=item.metadata["turn_id"]?.jsonPrimitive?.contentOrNull
            require(tid==null||parent.turns.any{it.id==tid}){"附件所属原轮次不存在。"}
            val data=item.file.readBytes()
            require(data.size.toLong()==item.descriptor.size)
            item.file.inputStream().use{ArchiveV2Chunks.stage(item.descriptor,it,object:java.io.OutputStream(){override fun write(b:Int){};override fun write(b:ByteArray,off:Int,len:Int){}},LocalAttachmentStore.MAX_BYTES)}
            val original=LocalAttachmentStore.Original(item.metadata,ArchiveV2Chunks.digest(data))
            val old=existing[id]
            if(old!=null){matched++;if(old!=original||!store.bytes(old).contentEquals(data))conflicts++}
            else{ready++;if(write)store.publish(original,data)}
        }
        require(conflicts==0){"附件 ID 与目标原件冲突，不覆盖。"}
        return LocalRestoreCount(ready,matched,conflicts)
    }
}
