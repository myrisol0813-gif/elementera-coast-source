package com.elementeracoast.app.core.local

import kotlinx.serialization.json.*
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.Base64
import java.util.concurrent.TimeUnit

/** Independent image transport only. A caller must explicitly authorize cost
 * and save the resulting original with its actual assistant message identity. */
internal class LocalImageProvider(
    private val http:OkHttpClient=OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
        .retryOnConnectionFailure(false).connectTimeout(10,TimeUnit.SECONDS).callTimeout(120,TimeUnit.SECONDS).build()
){
    data class Config(val key:String,val model:String,val allowPaid:Boolean=false){
        override fun toString()="ImageConfig(model="+model+", credentials=redacted)"
    }
    data class Model(val id:String,val name:String,val free:Boolean)
    data class Generated(val bytes:ByteArray,val mime:String,val provider:String,val requestedModel:String,val reportedModel:String?,val costUsd:Double?,val prompt:String)
    class Failure(val code:String,override val message:String):IllegalStateException(message)
    private fun fail(code:String,message:String):Nothing=throw Failure(code,message)
    private fun request(req:Request,cap:Long):JsonObject{
        try{
            return http.newCall(req).execute().use{res->
                if(!res.isSuccessful)fail("provider_http","图像供应商返回HTTP "+res.code+"；未保存图像，可能已产生费用。")
                val body=res.body?:fail("empty_response","没有供应商响应。")
                if(body.contentLength()>cap||body.source().request(cap+1))fail("response_limit","供应商响应超限。")
                Json.parseToJsonElement(body.source().readUtf8()).jsonObject
            }
        }catch(e:Failure){throw e}catch(_:Exception){fail("provider_unavailable","图像供应商连接或解析失败；不自动重试，可能已产生费用。")}
    }
    private fun JsonObject.str(k:String)=(this[k] as? JsonPrimitive)?.takeIf{it.isString}?.contentOrNull
    fun discover():List<Model>{
        val data=request(Request.Builder().url(BASE+"/models").get().build(),4L*1024*1024)
        val rows=data["data"] as? JsonArray?:fail("catalog_invalid","图像模型目录不可用。")
        return rows.mapNotNull{v->
            val m=v as? JsonObject?:return@mapNotNull null
            val id=m.str("id")?.takeIf{MODEL.matches(it)}?:return@mapNotNull null
            val output=(m["architecture"] as? JsonObject)?.get("output_modalities") as? JsonArray
            if(output?.any{it==JsonPrimitive("image")}!=true)return@mapNotNull null
            Model(id,(m.str("name")?:id).take(180),id.endsWith(":free"))
        }.sortedWith(compareByDescending<Model>{it.free}.thenBy{it.id})
    }
    fun generate(config:Config,input:JsonObject):Generated{
        if(config.key.isBlank()||!MODEL.matches(config.model))fail("not_configured","请配置独立生图模型。")
        if(!config.model.endsWith(":free")&&!config.allowPaid)fail("paid_not_authorized","非免费生图模型未获明确付费授权。")
        val prompt=input.str("prompt")?.trim()
        if(input.keys!=setOf("prompt")||prompt==null||prompt.length !in 1..4000)fail("invalid_arguments","只接收1—4000字符的绘图提示词。")
        val payload=buildJsonObject{put("model",config.model);put("prompt",prompt);put("n",1)}
        val req=Request.Builder().url(BASE).header("Authorization","Bearer "+config.key.trim())
            .post(payload.toString().toRequestBody("application/json".toMediaType())).build()
        val result=request(req,12L*1024*1024)
        val rows=result["data"] as? JsonArray
        if(rows?.size!=1)fail("image_count","供应商没有返回恰好一张图像。")
        val raw=(rows[0] as? JsonObject)?.str("b64_json")
        if(raw==null||raw.isEmpty()||raw.length>4*((MAX_BYTES+2)/3)||raw.length%4!=0||!B64.matches(raw))fail("image_invalid","图像不是有效的内联Base64原件。")
        val bytes=try{Base64.getDecoder().decode(raw)}catch(_:IllegalArgumentException){fail("image_invalid","图像原件解码失败。")}
        if(bytes.isEmpty()||bytes.size>MAX_BYTES)fail("image_limit","图像超过8MiB或为空。")
        fun starts(vararg signature:Int,offset:Int=0)=signature.indices.all{i->bytes.getOrNull(i+offset)?.toInt()?.and(255)==signature[i]}
        val mime=when{
            bytes.size>=24&&starts(137,80,78,71,13,10,26,10)->"image/png"
            bytes.size>=4&&starts(255,216,255)->"image/jpeg"
            bytes.size>=16&&starts(82,73,70,70)&&starts(87,69,66,80,offset=8)->"image/webp"
            else->fail("image_invalid","供应商未返回可识别的PNG、JPEG或WebP。")
        }
        val reported=result.str("model")?.takeIf{MODEL.matches(it)}
        val cost=((result["usage"] as? JsonObject)?.get("cost") as? JsonPrimitive)?.takeIf{!it.isString}?.doubleOrNull?.takeIf{it.isFinite()&&it>=0}
        return Generated(bytes,mime,"openrouter",config.model,reported,cost,prompt)
    }
    companion object {
        private const val BASE="https://openrouter.ai/api/v1/images"
        private const val MAX_BYTES=8*1024*1024
        private val MODEL=Regex("[a-z0-9][a-z0-9_.-]{0,79}/[a-z0-9][a-z0-9_.-]{0,119}(:free)?",RegexOption.IGNORE_CASE)
        private val B64=Regex("[A-Za-z0-9+/]+={0,2}")
    }
}
