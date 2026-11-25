package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.remote.*
import kotlinx.serialization.json.*
import okhttp3.HttpUrl.Companion.toHttpUrl

/** Retains only explicit provider metadata; never retains raw HTTP frames or headers. */
internal class LocalProviderEcho(private val provider:LocalProviderConfig,private val model:String,private val maxTokens:Int) {
    private val usages=mutableListOf<RemoteModelUsage?>()
    private var currentUsage:RemoteModelUsage?=null
    private var actual:String?=null
    private val reasoning=StringBuilder()
    private val summary=StringBuilder()
    private fun safe(value:String):String=value.replace(provider.apiKey.takeIf{it.isNotEmpty()}?:"\u0000","[REDACTED]")
        .replace(Regex("(?i)Bearer\\s+[A-Za-z0-9._~+/=-]{8,}"),"Bearer [REDACTED]")
        .replace(Regex("(?i)\\b(?:sk-|or-v1-)[A-Za-z0-9_-]{8,}"),"[REDACTED]")
        .replace(Regex("(?i)bce-v3/[A-Za-z0-9_./-]+"),"[REDACTED]")
        .replace(Regex("\\beyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\b"),"[REDACTED]")
    private fun JsonObject.long(k:String)=(get(k) as? JsonPrimitive)?.longOrNull?.takeIf{it>=0&&it<=1_000_000_000}
    private fun JsonObject.num(k:String)=(get(k) as? JsonPrimitive)?.doubleOrNull?.takeIf{it.isFinite()}
    private fun JsonObject.obj(k:String)=get(k) as? JsonObject
    fun observe(chunk:JsonObject) {
        (chunk["model"] as? JsonPrimitive)?.contentOrNull?.takeIf{it.isNotBlank()}?.let{actual=safe(it).take(180)}
        chunk.obj("usage")?.let{u->
            val prompt=u.obj("prompt_tokens_details")?:u.obj("input_tokens_details")
            val output=u.obj("completion_tokens_details")?:u.obj("output_tokens_details")
            val v=RemoteModelUsage(
                promptTokens=u.long("prompt_tokens")?:u.long("input_tokens"),
                completionTokens=u.long("completion_tokens")?:u.long("output_tokens"),
                reasoningTokens=u.long("reasoning_tokens")?:output?.long("reasoning_tokens"),
                cachedTokens=u.long("cached_tokens")?:prompt?.long("cached_tokens"),
                cacheWriteTokens=u.long("cache_write_tokens")?:prompt?.long("cache_write_tokens")?:prompt?.long("cache_creation_tokens"),
                cacheDiscount=u.num("cache_discount"),totalTokens=u.long("total_tokens"),cost=u.num("cost")?:u.num("total_cost"))
            if(v!=RemoteModelUsage())currentUsage=v // cumulative chunks: use last report, not sum
        }
        val delta=(chunk["choices"] as? JsonArray)?.firstOrNull()?.let{it as? JsonObject}?.obj("delta")?:return
        fun append(target:StringBuilder,keys:List<String>,limit:Int){
            val part=keys.firstNotNullOfOrNull{(delta[it] as? JsonPrimitive)?.takeIf{v->v.isString}?.contentOrNull}?:return
            if(target.length<limit)target.append(part.take(limit-target.length))
        }
        append(reasoning,listOf("reasoning_content","reasoning_text","reasoning"),16000)
        append(summary,listOf("reasoning_summary"),8000)
    }
    fun endRound(){usages.add(currentUsage);currentUsage=null}
    private fun sum(field:(RemoteModelUsage)->Long?):Long? {
        if(usages.isEmpty()||usages.any{it==null||field(it)==null})return null
        return usages.sumOf{field(it!!)!!}
    }
    private fun sumDouble(field:(RemoteModelUsage)->Double?):Double? {
        if(usages.isEmpty()||usages.any{it==null||field(it)==null})return null
        return usages.sumOf{field(it!!)!!}.takeIf{it.isFinite()}
    }
    fun metadata(reason:String):RemoteModelMetadata {
        val usage=RemoteModelUsage(promptTokens=sum{it.promptTokens},completionTokens=sum{it.completionTokens},
            reasoningTokens=sum{it.reasoningTokens},cachedTokens=sum{it.cachedTokens},cacheWriteTokens=sum{it.cacheWriteTokens},
            totalTokens=sum{it.totalTokens},cacheDiscount=sumDouble{it.cacheDiscount},cost=sumDouble{it.cost})
        val text=safe(reasoning.toString()).take(16000).ifBlank{null}
        val overview=safe(summary.toString()).take(8000).ifBlank{null}
        return RemoteModelMetadata(provider=normalizeLocalProviderUrl(provider.baseUrl).toHttpUrl().host,
            requestedModel=safe(model).take(180),resolvedModel=actual,reasoningText=text,reasoningSummary=overview,
            reasoningStatus=if(text!=null||overview!=null)"returned"else "not_returned",usage=usage.takeUnless{it==RemoteModelUsage()},
            finishReason=reason,isStream=true,request=RemoteModelRequestMetadata(maxTokens=maxTokens.coerceIn(64,65536).toLong(),stream=true))
    }
}
