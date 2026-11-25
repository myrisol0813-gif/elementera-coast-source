package com.elementeracoast.app.core.local

import kotlinx.serialization.json.*
import okhttp3.HttpUrl.Companion.toHttpUrl

/** Provider-neutral organization policy. Capabilities are taken from the selected
 * model's actual catalog entry, never inferred from a model name. */
internal data class LocalSoilPolicy(
    val nonStreaming:Boolean=false,
    val parameters:Set<String> = emptySet(),
    val efforts:List<String> = emptyList(),
    val outputLimit:Int?=null
) {
    val lowEffort:String? get() = if("reasoning" !in parameters) null else
        listOf("none","minimal","low").firstOrNull { it in efforts }
            ?: if(efforts.isEmpty()) "minimal" else null
    val firstBudget:Int get() = bounded(if(lowEffort!=null)3200 else LOCAL_SOIL_FIRST_OUTPUT_TOKENS)
    val retryBudget:Int get() = bounded(LOCAL_SOIL_RETRY_OUTPUT_TOKENS)
    private fun bounded(n:Int)=minOf(n,outputLimit?:n)
    fun options():JsonObject=buildJsonObject {
        if("temperature" in parameters)put("temperature",0.2)
        if("structured_outputs" in parameters)put("response_format",soilResponseFormat())
        else if("response_format" in parameters)put("response_format",buildJsonObject{put("type","json_object")})
        if("reasoning" in parameters&&lowEffort!=null)put("reasoning",buildJsonObject{
            put("effort",lowEffort);put("exclude",true)
        })
    }
    companion object {
        fun forProvider(p:LocalProviderConfig,model:String,catalog:JsonObject?):LocalSoilPolicy {
            if(!isOpenRouter(p))return LocalSoilPolicy()
            val entry=(catalog?.get("data") as? JsonArray)?.mapNotNull{it as? JsonObject}
                ?.firstOrNull{(it["id"] as? JsonPrimitive)?.contentOrNull==model}
            fun strings(v:JsonElement?)=(v as? JsonArray)?.mapNotNull{(it as? JsonPrimitive)?.contentOrNull}.orEmpty()
            val parameters=strings(entry?.get("supported_parameters")).toSet()
            val reasoning=entry?.get("reasoning") as? JsonObject
            val efforts=strings(entry?.get("supported_reasoning_efforts")?:entry?.get("reasoning_efforts")?:reasoning?.get("efforts")?:reasoning?.get("supported_efforts"))
            val max=((entry?.get("top_provider") as? JsonObject)?.get("max_completion_tokens") as? JsonPrimitive)?.intOrNull?.takeIf{it>0}
            return LocalSoilPolicy(true,parameters,efforts,max)
        }
        fun isOpenRouter(p:LocalProviderConfig):Boolean {
            val url=normalizeLocalProviderUrl(p.baseUrl).toHttpUrl()
            return url.host=="openrouter.ai"&&url.port==443&&url.encodedPath.trimEnd('/')=="/api/v1"
        }
    }
}
private fun soilResponseFormat():JsonObject {
    fun type(t:String)=buildJsonObject{put("type",t)}
    fun array(item:JsonObject)=buildJsonObject{put("type","array");put("items",item)}
    fun obj(fields:Map<String,JsonObject>)=buildJsonObject {
        put("type","object");put("additionalProperties",false)
        put("properties",JsonObject(fields));put("required",JsonArray(fields.keys.map(::JsonPrimitive)))
    }
    val string=type("string")
    val refs=array(obj(mapOf("turn_id" to string,"role" to buildJsonObject{
        put("type","string");put("enum",JsonArray(listOf("user","assistant","turn").map(::JsonPrimitive)))
    })))
    val candidates=array(obj(mapOf("title" to string,"content" to string,"source_refs" to refs,"source_excerpt" to string)))
    val portrait=obj(mapOf("should_update" to type("boolean"),"proposed_body" to string,"reason" to string,"source_refs" to refs,"source_excerpt" to string))
    return buildJsonObject {
        put("type","json_schema");put("json_schema",buildJsonObject{
            put("name","thought_soil_v3_portraits");put("strict",true)
            put("schema",obj(mapOf("current_text" to string,"afterthoughts" to array(string),"memory_candidates" to candidates,
                "seed_candidates" to candidates,"user_portrait" to portrait,"self_portrait" to portrait)))
        })
    }
}
