package com.elementeracoast.app.feature.chatgpt

import com.elementeracoast.app.core.local.LocalContextPolicy
import kotlinx.serialization.json.*

/** Ephemeral state for one claim. It cannot start a schedule, grant OAuth,
 * execute tools, or write a message. The caller owns every durable reservation.
 * A failed transmission consumes the slot: never retry via another model. */
internal class NativeDreamPlanSession(
    private val grant:NativeDreamPlanProtocol.Grant,
    private val instructions:String,
    private val tokenBudget:Int,
    private val outputHint:Int,
    private val send:suspend (JsonObject,Set<String>)->NativeDreamPlanProtocol.Step
){
    init{require(grant.softBudgetAccepted&&grant.requestLimit in 1..129&&tokenBudget in 1..1000000&&outputHint in 1..65536)}
    private val history=mutableListOf<JsonObject>()
    private var previous:NativeDreamPlanProtocol.Step?=null
    private var used=0L
    private var requests=0
    private var ended=false
    private fun JsonObject.str(key:String)=(get(key) as? JsonPrimitive)?.contentOrNull.orEmpty()

    suspend fun step(index:Int,tools:JsonArray,results:List<JsonObject>,images:List<JsonObject> = emptyList(),
                     reserve:suspend ()->Boolean,authorize:suspend ()->Boolean):NativeDreamPlanProtocol.Step{
        if(ended||index!=requests||requests>=grant.requestLimit)throw NativeDreamPlanFailure("plan_step_limit")
        if(!authorize())throw NativeDreamPlanFailure("plan_authorization_unavailable")
        val prefix=previous?.let{NativeDreamPlanProtocol.continuation(it,results)}
            ?:emptyList<JsonObject>().also{require(results.isEmpty())}
        val pixels=images.map{image->
            require(image.str("role")=="user")
            val parts=image.getValue("content").jsonArray
            require(parts.size==2&&parts[0].jsonObject.str("type")=="text"&&parts[1].jsonObject.str("type")=="image_url")
            require(parts[0].jsonObject.str("text").contains("系统转交"))
            val url=parts[1].jsonObject.getValue("image_url").jsonObject.str("url")
            require(url.startsWith("data:image/")&&url.length<=12*1024*1024)
            normalizeNativeInput(image)
        }
        require(pixels.sumOf{it.toString().length.toLong()}<=12L*1024*1024)
        val base=history+prefix
        val estimate=LocalContextPolicy.estimate(instructions)+LocalContextPolicy.estimate(JsonArray(base).toString())+
            LocalContextPolicy.estimate(tools.toString())+pixels.size*2048+256
        val remaining=tokenBudget.toLong()-used-estimate
        if(remaining<1){ended=true;throw NativeDreamPlanFailure("plan_soft_budget_exhausted")}
        val allowed=tools.map{it.jsonObject.getValue("function").jsonObject.str("name")}.toSet()
        val body=NativeDreamPlanProtocol.body(grant.model,instructions+"\\n本次建议输出不超过 "+minOf(remaining,outputHint.toLong())+" token。",base+pixels,tools,remaining)
        if(!authorize()||!reserve()){ended=true;throw NativeDreamPlanFailure("plan_authorization_unavailable")}
        requests++
        // Once reserved, failure is terminal. Previous successful receipts and
        // originals are left intact. Pixels and opaque items stay in memory.
        val step=try{
            if(!authorize())throw NativeDreamPlanFailure("plan_authorization_unavailable")
            send(body,allowed)
        }catch(e:Exception){ended=true;throw e}
        history.addAll(prefix)
        if(pixels.isNotEmpty())history.add(buildJsonObject{
            put("role","developer");put("content","上一请求曾转交本次活动图像；本请求不重复附送像素。")
        })
        previous=step
        val usage=step.normalized["usage"] as? JsonObject
        val total=usage?.get("total_tokens")?.jsonPrimitive?.longOrNull
        if(total==null||total<0){ended=true}
        else{used+=total;if(used>=tokenBudget)ended=true}
        if(step.output.toolCalls.isEmpty())ended=true
        return step
    }
    fun canContinue()=!ended&&requests<grant.requestLimit
    override fun toString()="NativeDreamPlanSession(redacted)"
}
