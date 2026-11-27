package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.remote.RemoteCacheStore
import kotlinx.serialization.json.*

/** An independent activity original never requires a fictional chat turn. */
internal class LocalDreamImage(
    private val store:LocalPersistence,private val claim:LocalDreamLedger.Claim,
    private val selected:String,private val resolve:(String)->LocalProviderConfig?,
    private val discover:(String)->List<LocalImageProvider.Model> = {LocalImageProvider().discover(it)},
    private val generate:(LocalImageProvider.Config,JsonObject)->LocalImageProvider.Generated={c,p->LocalImageProvider().generate(c,p)}
){
    private var attempts=0
    private fun config():Pair<LocalProviderConfig,String>?{
        val p=resolve(selected)?:return null
        val m=p.models.firstOrNull{p.modelId(it)==selected}?:return null
        if(p.apiKey.isBlank()||p.baseUrl.trimEnd('/')!="https://openrouter.ai/api/v1")return null
        return p to m
    }
    fun configured()=config()!=null
    fun execute(callId:String,input:JsonObject):JsonObject{
        require(attempts<requireNotNull(claim.config.execution).imageLimit&&input.keys==setOf("prompt"))
        val prompt=input.getValue("prompt").jsonPrimitive.let{require(it.isString);it.content.trim()}
        require(prompt.length in 1..4000)
        val (p,model)=requireNotNull(config())
        val id="att_dream_"+callId.replace(':','_')
        fun allowed(s:LocalPersistence):Boolean{
            val cache=RemoteCacheStore(s,strictReads=true)
            return cache.profile()?.currentImageModel==selected&&cache.history(claim.cid)?.contextSettings?.localModelWriteEnabled==true&&
                LocalDreamLedger(s).toolClaimed(claim,callId,"image_generate")&&
                LocalAttachmentStore(s).entries().none{it.metadata["id"]?.jsonPrimitive?.contentOrNull==id}
        }
        require(store.readConsistent{allowed(it)})
        attempts++
        require(discover(p.apiKey).any{it.id==model})
        require(config()==(p to model)&&store.readConsistent{allowed(it)})
        val generated=generate(LocalImageProvider.Config(p.apiKey,model,true),buildJsonObject{put("prompt",prompt)})
        require(generated.provider=="openrouter"&&generated.requestedModel==model)
        prepareGeneratedImageReadback(id,generated.bytes,generated.mime,false)
        return store.atomic{s->
            require(allowed(s)&&config()==(p to model)){"自主生图权限或模型已变化，未保存。"}
            val ext=mapOf("image/png" to "png","image/jpeg" to "jpg","image/webp" to "webp").getValue(generated.mime)
            val stamp=System.currentTimeMillis()
            val meta=buildJsonObject{
                put("id",id);put("conversation_id",claim.cid);put("turn_id",JsonNull);put("kind","image")
                put("name","自主活动图像-"+id+"."+ext);put("mime",generated.mime);put("size",generated.bytes.size);put("created_at",stamp);put("updated_at",stamp)
            }
            val originals=LocalAttachmentStore(s)
            val original=LocalAttachmentStore.Original(meta,ArchiveV2Chunks.digest(generated.bytes))
            originals.publish(original,generated.bytes)
            require(originals.bytes(original).contentEquals(generated.bytes))
            buildJsonObject{
                put("ok",true);put("id",id);put("mime",generated.mime);put("size",generated.bytes.size);put("requested_model",model)
                put("reported_model",generated.reportedModel?.let(::JsonPrimitive)?:JsonNull);put("cost_usd",generated.costUsd?.let(::JsonPrimitive)?:JsonNull);put("readback","not_delivered")
            }
        }
    }
}
