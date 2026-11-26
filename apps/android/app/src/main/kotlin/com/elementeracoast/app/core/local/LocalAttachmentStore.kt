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
                items.add(RemoteDeskAttachmentItem(id=id,name=name,type="image",mode="image",reason="图片原件已组装为 image_url；不代表模型实际理解了图片。"))
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
        return AttachmentContext(next,RemoteDeskAttachments(uploaded=ids.size,deliveredToModel=items.size,delivered=items,vision=RemoteDeskAttachmentVision(supported=false,imagesDelivered=images.size)),images)
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

/** Store original atomically in the existing workspace, not in a human upload
 * draft. The caller still owns committing the exact assistant variant. */
internal data class SavedGeneratedImage(val attachment:RemoteAttachment,val readback:GeneratedImageReadback)
internal fun saveGeneratedImageOriginal(store:LocalPersistence,cid:String,tid:String,messageId:String,generated:LocalImageProvider.Generated,visionSupported:Boolean?,reservedUserId:String?=null,modelTool:Boolean=false):SavedGeneratedImage{
    val idPattern=Regex("[A-Za-z0-9_.:-]{1,160}")
    require(listOf(cid,tid,messageId).all{idPattern.matches(it)})
    val model=Regex("[a-z0-9][a-z0-9_.-]{0,79}/[a-z0-9][a-z0-9_.-]{0,119}(:free)?",RegexOption.IGNORE_CASE)
    require(generated.provider=="openrouter"&&model.matches(generated.requestedModel)&&generated.prompt.isNotBlank()&&generated.prompt.length<=4000)
    return store.atomic{s->
        val cache=RemoteCacheStore(s)
        require(cache.conversations().any{it.id==cid&&it.deletedAt==null&&it.roomType in setOf("main","radio")}){"该窗口不允许保存生成图像。"}
        val history=requireNotNull(cache.history(cid))
        require(history.turns.any{it.id==tid&&it.user.variants.isNotEmpty()}&&history.turns.none{t->t.user.variants.any{it.id==messageId}||(t.id!=tid&&t.assistant.variantsByUserVariant.values.flatten().any{it.id==messageId})}){"生成图像的轮次或回复版本不匹配。"}
        val attachments=LocalAttachmentStore(s)
        val id="att_"+java.util.UUID.randomUUID()
        prepareGeneratedImageReadback(id,generated.bytes,generated.mime,false)
        val extension=when(generated.mime){"image/png"->"png";"image/jpeg"->"jpg";else->"webp"}
        val name="generated-"+id+"."+extension
        val stamp=System.currentTimeMillis()
        val meta=buildJsonObject{put("id",id);put("conversation_id",cid);put("turn_id",tid);put("kind","image");put("name",name);put("mime",generated.mime);put("size",generated.bytes.size);put("created_at",stamp);put("updated_at",stamp)}
        val original=LocalAttachmentStore.Original(meta,ArchiveV2Chunks.digest(generated.bytes))
        attachments.publish(original,generated.bytes)
        val saved=attachments.bytes(original)
        val provenance=RemoteImageGeneration(messageId,"openrouter",generated.requestedModel,generated.prompt,generated.reportedModel?.takeIf{model.matches(it)},generated.costUsd?.takeIf{it.isFinite()&&it>=0})
        val attachment=RemoteAttachment(id=id,type="image",name=name,mime=generated.mime,size=saved.size.toLong(),storageKey="chat-attachment:"+id,createdAt=java.time.Instant.ofEpochMilli(stamp).toString(),imageGeneration=provenance)

        if(reservedUserId!=null){
            val t=history.turns.first{it.id==tid}
            val i=t.user.variants.indexOfFirst{it.id==reservedUserId};require(i>=0)
            val k=i.toString();val branch=t.assistant.variantsByUserVariant[k].orEmpty()
            require(branch.count{it.id==messageId&&it.finishReason=="image_pending"&&it.attachments.size<12&&it.attachments.all{a->a.stickerDelivery?.messageId==messageId}}==1){"原回复版本已不再等待生成图像。"}
            val next=t.copy(assistant=t.assistant.copy(variantsByUserVariant=t.assistant.variantsByUserVariant+(k to branch.map{if(it.id==messageId)it.copy(content="",attachments=it.attachments+attachment,finishReason=if(modelTool)"image_saved"else "stop",errorDetail=null)else it})))
            cache.putHistory(cid,history.copy(updatedAt=java.time.Instant.ofEpochMilli(stamp).toString(),turns=history.turns.map{if(it.id==tid)next else it}))
        }
        SavedGeneratedImage(attachment,prepareGeneratedImageReadback(id,saved,generated.mime,visionSupported))
    }
}

internal class ManualImageFailure(val type:String,override val message:String,val status:Int):IllegalStateException(message)

/** Explicit owner request, exact reserved branch, no repeated provider request.
 * The network is deliberately outside the workspace transaction and router lock. */
internal fun runLocalManualImageGeneration(store:LocalPersistence,config:LocalProviderConfig?,input:JsonObject,discover:(String)->List<LocalImageProvider.Model> = {key->LocalImageProvider().discover(key)},generate:(LocalImageProvider.Config,JsonObject)->LocalImageProvider.Generated={c,p->LocalImageProvider().generate(c,p)},modelTool:Boolean=false,visionSupported:Boolean?=null,expectedModel:String?=null,onSaved:((SavedGeneratedImage)->Unit)?=null):JsonObject{
    fun fail(type:String,message:String,status:Int=400):Nothing=throw ManualImageFailure(type,message,status)
    if(input.keys!=setOf("conversation_id","turn_id","user_variant_id","message_id","prompt"))fail("image_request_invalid","生成图像请求无效。")
    fun str(k:String)=(input[k] as? JsonPrimitive)?.takeIf{it.isString}?.content?:fail("image_request_invalid","缺少消息版本或绘图提示。")
    val cid=str("conversation_id");val tid=str("turn_id");val uid=str("user_variant_id");val mid=str("message_id");val prompt=str("prompt").trim()
    if(listOf(cid,tid,uid,mid).any{!Regex("[A-Za-z0-9_.:-]{1,160}").matches(it)}||prompt.length !in 1..4000)fail("image_request_invalid","缺少明确的消息版本或绘图提示。")
    val selected=RemoteCacheStore(store,strictReads=true).profile()?.currentImageModel.orEmpty()
    if(expectedModel!=null&&selected!=expectedModel)fail("image_model_changed","生图模型选择已变化。",409)
    val model=config?.models?.firstOrNull{config.modelId(it)==selected&&Regex("[a-z0-9][a-z0-9_.-]{0,79}/[a-z0-9][a-z0-9_.-]{0,119}(:free)?",RegexOption.IGNORE_CASE).matches(it)}
    if(config==null||model==null||config.apiKey.isBlank()||config.baseUrl.trimEnd('/')!="https://openrouter.ai/api/v1")fail("image_not_configured","请在模型箱选择已配置的 OpenRouter 生图模型。",503)
    val catalog=try{discover(config.apiKey)}catch(_:Exception){fail("image_catalog_unavailable","无法核验生图模型目录，未发起生成。",502)}
    if(catalog.none{it.id==model})fail("image_model_unavailable","所选模型不在独立生图 API 目录中，未发起生成。",409)
    store.atomic{s->
        val cache=RemoteCacheStore(s,strictReads=true)
        if(cache.profile()?.currentImageModel!=selected)fail("image_model_changed","生成模型选择已变化，请重新发起。",409)
        if(cache.conversations().none{it.id==cid&&it.deletedAt==null&&it.roomType in setOf("main","radio")})fail("generated_surface_invalid","该窗口不允许生成图像。",403)
        val original=cache.history(cid)?:fail("generated_source_invalid","找不到原消息。",409)
        val h=LocalImageRecovery.recover(original)
        val t=h.turns.firstOrNull{it.id==tid}?:fail("generated_source_invalid","找不到原轮次。",409)
        val i=t.user.variants.indexOfFirst{it.id==uid}
        if(i<0||i!=t.user.active||t.user.variants[i].hidden)fail("generated_source_invalid","原消息版本已变化。",409)
        val existing=h.turns.flatMap{it.user.variants+it.assistant.variantsByUserVariant.values.flatten()}
        val k=i.toString();val branch=t.assistant.variantsByUserVariant[k].orEmpty()
        val target=branch.singleOrNull{it.id==mid}
        if(modelTool&&!h.contextSettings.localModelWriteEnabled)fail("image_permission_revoked","本机模型写入权限未开启。",403)
        if(existing.any{it.finishReason=="image_pending"}||(if(modelTool) target==null||target.hidden||target.finishReason !in setOf("image_tool_ready","sticker_saved")||target.attachments.size>=12||target.attachments.any{it.stickerDelivery?.messageId!=mid}||existing.count{it.id==mid}!=1 else existing.any{it.id==mid}))fail("image_already_reserved","已有生成任务或此请求已使用；不会再次生成。",409)
        if(!modelTool&&branch.size>=20)fail("image_branch_full","当前回复版本已满。",409)
        val now=java.time.Instant.now().toString()
        val pending=RemoteVariant(id=mid,content="",createdAt=now,modelId=model,finishReason="image_pending",generationSource="chat")
        val variants=if(modelTool)branch.map{if(it.id==mid)it.copy(finishReason="image_pending",createdAt=now)else it}else branch+pending
        val next=t.copy(assistant=t.assistant.copy(variantsByUserVariant=t.assistant.variantsByUserVariant+(k to variants),activeByUserVariant=if(modelTool)t.assistant.activeByUserVariant else t.assistant.activeByUserVariant+(k to branch.size)))
        cache.putHistory(cid,h.copy(updatedAt=now,turns=h.turns.map{if(it.id==tid)next else it}))
    }
    try{
        val generated=generate(LocalImageProvider.Config(config.apiKey,model,true),buildJsonObject{put("prompt",prompt)})
        val saved=saveGeneratedImageOriginal(store,cid,tid,mid,generated,visionSupported,uid,modelTool)
        onSaved?.invoke(saved)
        val history=store.readConsistent{requireNotNull(RemoteCacheStore(it,strictReads=true).history(cid))}
        val codec=Json{encodeDefaults=false;explicitNulls=false}
        return buildJsonObject{put("ok",true);put("attachment",codec.encodeToJsonElement(RemoteAttachment.serializer(),saved.attachment));put("readback",saved.readback.receipt);put("history",codec.encodeToJsonElement(RemoteHistory.serializer(),history.copy(conversationId=cid)))}
    }catch(e:Exception){
        store.atomic{s->
            val cache=RemoteCacheStore(s,strictReads=true)
            val h=cache.history(cid)
            if(h!=null&&cache.conversations().any{it.id==cid&&it.deletedAt==null}){
                val t=h.turns.firstOrNull{it.id==tid}
                val i=t?.user?.variants?.indexOfFirst{it.id==uid}?:-1
                val k=i.toString();val branch=t?.assistant?.variantsByUserVariant?.get(k).orEmpty()
                if(t!=null&&i>=0&&branch.any{it.id==mid&&it.finishReason=="image_pending"}){
                    val next=t.copy(assistant=t.assistant.copy(variantsByUserVariant=t.assistant.variantsByUserVariant+(k to branch.map{if(it.id==mid&&it.finishReason=="image_pending")it.copy(finishReason="image_failed",errorDetail="图像生成或保存未完成；不自动重试，供应商可能已计费。")else it})))
                    cache.putHistory(cid,h.copy(updatedAt=java.time.Instant.now().toString(),turns=h.turns.map{if(it.id==tid)next else it}))
                }
            }
        }
        if(e is ManualImageFailure)throw e
        fail("image_generation_failed","图像生成或保存未完成；不自动重试，供应商可能已计费。",502)
    }
}
