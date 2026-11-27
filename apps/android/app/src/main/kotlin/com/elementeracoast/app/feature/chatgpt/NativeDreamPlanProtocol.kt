package com.elementeracoast.app.feature.chatgpt

import kotlinx.serialization.json.*

/** Separate from API-key providers. This contract is intentionally not a live
 * scheduler binding yet. Account tokens, request bodies and opaque reasoning
 * items never belong in the portable wake ledger. */
internal object NativeDreamPlanProtocol {
    const val PREFIX="chatgpt-plan:"
    const val ENDPOINT="https://api.openai.com/v1/responses"
    const val USAGE_URL="https://chatgpt.com/settings/usage"
    private fun JsonObject.str(key:String)=(get(key) as? JsonPrimitive)?.contentOrNull.orEmpty()
    fun slug(modelId:String):String?=modelId.takeIf{it.startsWith(PREFIX)}?.removePrefix(PREFIX)
        ?.takeIf{it.matches(Regex("[A-Za-z0-9_.:-]{1,160}"))}

    /** A separate consent, pinned to one window revision, account registration
     * and exact catalog model. Kept outside exported configuration. */
    data class Grant(val window:String,val revision:String,val subject:String,val clientId:String,val model:String,
        val softBudgetAccepted:Boolean,val requestLimit:Int){
        override fun toString()="PlanWakeGrant(redacted)"
    }
    fun permitted(grant:Grant?,window:String,revision:String,account:ChatGptConnection?,modelId:String,advertised:Set<String>):Boolean{
        val model=slug(modelId)?:return false
        return grant!=null&&account!=null&&grant.window==window&&grant.revision==revision&&grant.model==model&&
            grant.subject==account.subject&&grant.clientId==account.clientId&&grant.softBudgetAccepted&&
            grant.requestLimit in 1..129&&model in advertised&&
            setOf("chatgpt.tokens.use.direct","resource.invoke").all{it in account.scopes}
    }

    /** A system-origin invitation, not a fabricated human turn. In this
     * preview max_output_tokens/background/previous_response_id are unsupported.
     * The budget is a local admission check, not a provider hard output cap. */
    fun body(model:String,instructions:String,items:List<JsonObject>,completionsTools:JsonArray,softRemaining:Long):JsonObject{
        require(slug(PREFIX+model)==model&&instructions.isNotBlank()&&softRemaining>0)
        require(items.none{it.str("role")=="system"})
        val tools=completionsTools.map{v->
            val item=v.jsonObject
            require(item.str("type")=="function")
            val f=item.getValue("function").jsonObject
            require(f.str("name").matches(Regex("[A-Za-z0-9_-]{1,120}")))
            buildJsonObject{
                put("type","function");put("name",f.str("name"));put("description",f.str("description"))
                put("parameters",f.getValue("parameters"));put("strict",false)
            }
        }
        require(tools.map{it.str("name")}.distinct().size==tools.size)
        return buildJsonObject{
            put("model",model);put("store",false);put("stream",true)
            put("instructions",instructions+"\n本次为系统发起的独立活动，不是人类新发言。剩余软 token 预算约 "+softRemaining+"，请简洁结束；这不是供应商强制上限。")
            put("input",JsonArray(items.ifEmpty{listOf(buildJsonObject{put("role","developer");put("content","自主活动开始；请按已授权邀请自行决定是否使用工具。")})}))
            put("include",JsonArray(listOf(JsonPrimitive("reasoning.encrypted_content"))))
            if(tools.isNotEmpty())put("tools",JsonArray(listOf(buildJsonObject{
                put("type","namespace");put("name","coast");put("description","本次活动已授权的海岸工具");put("tools",JsonArray(tools))
            })))
        }
    }

    /** Keep exact completed output items in RAM for the immediate stateless
     * continuation. The executor sees only a normalized step and must reserve
     * every tool separately. No tool runs inside the transport. */
    data class Step(val output:NativeResponseOutput,val normalized:JsonObject){
        override fun toString()="PlanWakeStep(redacted)"
    }
    fun complete(response:JsonObject,streamed:Map<Int,JsonObject>,exposed:Set<String>):Step{
        require(response.str("status")=="completed"){"套餐响应未完整结束。"}
        val output=readNativeResponseOutput(response,streamed)
        require(output.toolCalls.size<=128)
        val requested=output.toolCalls.map{tool->
            val call=parseNativeCoastToolCall(tool)
            require(call.name in exposed&&call.callId.length<=160)
            val args=tool.str("arguments")
            require(args.length<=60000&&Json.parseToJsonElement(args) is JsonObject)
            buildJsonObject{
                put("id",call.callId);put("type","function")
                putJsonObject("function"){put("name",call.name);put("arguments",args)}
            }
        }
        require(requested.map{it.str("id")}.distinct().size==requested.size)
        val u=response["usage"] as? JsonObject
        val total=u?.get("total_tokens")?.jsonPrimitive?.longOrNull?.takeIf{it in 0L..1000000000L}
        val usage=if(total==null)JsonNull else buildJsonObject{
            put("total_tokens",total)
            u?.get("input_tokens")?.jsonPrimitive?.longOrNull?.takeIf{it>=0}?.let{put("prompt_tokens",it)}
            u?.get("output_tokens")?.jsonPrimitive?.longOrNull?.takeIf{it>=0}?.let{put("completion_tokens",it)}
        }
        val normalized=buildJsonObject{
            put("model",response.str("model").take(180));put("usage",usage)
            put("choices",JsonArray(listOf(buildJsonObject{
                put("finish_reason",if(requested.isEmpty())"stop" else "tool_calls")
                putJsonObject("message"){put("content",output.finalText);put("tool_calls",JsonArray(requested))}
            })))
        }
        return Step(output,normalized)
    }
    fun continuation(step:Step,results:List<JsonObject>):List<JsonObject>{
        val calls=step.output.toolCalls.map(::parseNativeCoastToolCall)
        require(results.size==calls.size&&results.map{it.str("tool_call_id")}.distinct().size==results.size)
        val byId=results.associateBy{it.str("tool_call_id")}
        return step.output.items.map{it.jsonObject}+calls.map{call->
            val result=requireNotNull(byId[call.callId])
            require(result.str("role")=="tool"&&result.str("name")==call.name&&result.str("content").length<=60000)
            nativeCoastToolOutput(call,result.str("content"))
        }
    }
    fun failure(http:Int,code:String?):String=when{
        code=="subscription_sharing_usage_unavailable"->"plan_usage_unavailable"
        code=="subscription_sharing_usage_limit_exceeded"||http==429->"plan_usage_limit"
        code in setOf("subscription_sharing_user_not_eligible","chatpass_v2_scope_not_authorized","chatpass_v2_invalid_authorization_context")||http in setOf(401,403)->"plan_authorization_unavailable"
        code=="subscription_sharing_unsupported_capability"||http==400->"plan_capability_unavailable"
        else->"plan_request_unconfirmed"
    }
}
