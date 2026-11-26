package com.elementeracoast.app.core.local

import android.content.Context
import kotlinx.serialization.json.*
import okhttp3.OkHttpClient
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Request
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

/** Separate encrypted credentials; only explicit configuration enables networking.
 * All external requests go to Tavily, never a model-selected host. */
class LocalIndependentWeb(
    private val key: () -> String?,
    private val http: OkHttpClient = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
        .connectTimeout(10,TimeUnit.SECONDS).callTimeout(18,TimeUnit.SECONDS).build()
) {
    constructor(context:Context):this({LocalProviderStore(context,searchOnly=true).load().firstOrNull{it.id=="tavily"}?.apiKey})
    fun configured()=runCatching{!key().isNullOrBlank()}.getOrDefault(false)
    fun execute(name:String,input:JsonObject):JsonObject {
        val secret=key()?.trim()?.takeIf{it.isNotEmpty()}?:error("独立联网尚未配置。")
        fun str(o:JsonObject,k:String)=(o[k] as? JsonPrimitive)?.takeIf{it.isString}?.contentOrNull.orEmpty()
        fun text(o:JsonObject,k:String,max:Int)=str(o,k).trim().take(max)
        val search=name=="independent_web_search"
        require(search||name=="independent_web_read")
        require(input.keys.all{it in if(search)setOf("query","limit") else setOf("url")})
        val limit=if(search) input["limit"]?.let{require(it is JsonPrimitive&&!it.isString);it.int}?:4 else 1
        val query=if(search)text(input,"query",501) else ""
        val url=if(search)null else publicUrl(str(input,"url"))
        require(if(search)query.isNotEmpty()&&query.length<=500&&limit in 1..5 else url!=null)
        val body=buildJsonObject{
            if(search){put("query",query);put("max_results",limit);put("search_depth","basic");put("include_answer",false);put("include_raw_content",false)}
            else{put("urls",JsonArray(listOf(JsonPrimitive(url!!))));put("extract_depth","basic");put("format","text")}
        }
        val req=Request.Builder().url("https://api.tavily.com/"+(if(search)"search"else "extract"))
            .header("Authorization","Bearer "+secret).post(body.toString().toRequestBody("application/json".toMediaType())).build()
        val data=http.newCall(req).execute().use{res->
            if(!res.isSuccessful)error("独立联网供应商未返回成功响应。")
            val response=requireNotNull(res.body);val cap=512L*1024
            require(response.contentLength()<=cap){"独立联网响应超限。"}
            val stream=response.source()
            require(!stream.request(cap+1)){"独立联网响应超限。"}
            Json.parseToJsonElement(stream.readUtf8()).jsonObject
        }
        val rows=data.getValue("results").jsonArray.map{it.jsonObject}
        return buildJsonObject{
            put("ok",true);put("provider","tavily");put("reference_only",true)
            if(search){
                val sources=rows.take(limit).mapNotNull{r->val u=publicUrl(str(r,"url"))?:return@mapNotNull null
                    buildJsonObject{put("url",u);put("title",text(r,"title",200));put("excerpt",text(r,"content",800));put("truncated",str(r,"content").trim().length>800)}}
                put("operation","search");put("coverage","search_excerpts");put("count",sources.size);put("sources",JsonArray(sources))
            }else{
                val row=rows.firstOrNull{publicUrl(str(it,"url"))==url}?:error("未取得网页正文。")
                val content=str(row,"raw_content").trim();require(content.isNotBlank()){"网页没有可用正文。"}
                put("operation","extract");put("source_url",url!!);put("content",content.take(6000));put("truncated",content.length>6000);put("coverage","provider_extracted_text")
            }
        }
    }
    companion object {
        internal fun publicUrl(raw:String):String?{
            if(raw.length>1800)return null
            val u=raw.toHttpUrlOrNull()?:return null
            if(u.username.isNotEmpty()||u.password.isNotEmpty()||u.port!=(if(u.isHttps)443 else 80))return null
            if(!u.host.contains('.')||u.host.firstOrNull()?.isDigit()==true||Regex("\\.(localhost|local|internal|lan|test|invalid|onion|home|example)$",RegexOption.IGNORE_CASE).containsMatchIn(u.host))return null
            if(u.queryParameterNames.any{Regex("token|secret|password|signature|credential|api.?key|auth|session|^code$|^key$",RegexOption.IGNORE_CASE).containsMatchIn(it)})return null
            return u.newBuilder().fragment(null).build().toString()
        }
    }
}
