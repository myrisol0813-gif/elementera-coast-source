package com.elementeracoast.app.feature.chatgpt

import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class NativeDreamPlanProtocolTest {
    private val account=ChatGptConnection("client","host","subject","fixture@example.invalid","id","access","refresh",
        listOf("chatgpt.tokens.use.direct","resource.invoke"),999999999L)
    private val grant=NativeDreamPlanProtocol.Grant("window","revision","subject","client","fixture-model",true,3)
    @Test fun authorizationPinsModelAccountWindowAndRevision(){
        fun allowed(g:NativeDreamPlanProtocol.Grant?=grant,w:String="window",r:String="revision",a:ChatGptConnection?=account,
                    m:String="chatgpt-plan:fixture-model",models:Set<String> = setOf("fixture-model"))=
            NativeDreamPlanProtocol.permitted(g,w,r,a,m,models)
        assertTrue(allowed())
        assertFalse(allowed(g=null));assertFalse(allowed(w="other"));assertFalse(allowed(r="new"))
        assertFalse(allowed(a=account.copy(subject="other")));assertFalse(allowed(a=account.copy(clientId="other")))
        assertFalse(allowed(a=account.copy(scopes=listOf("resource.invoke"))))
        assertFalse(allowed(m="local:provider/fixture-model"));assertFalse(allowed(models=emptySet()))
        assertFalse(allowed(g=grant.copy(softBudgetAccepted=false)));assertFalse(allowed(g=grant.copy(requestLimit=0)))
    }
    @Test fun statelessBodyDoesNotPretendHumanTurnOrHardLimit(){
        val tools=JsonArray(listOf(Json.parseToJsonElement("""{"type":"function","function":{"name":"dream_write_note","description":"optional note","parameters":{"type":"object","properties":{"body":{"type":"string"}},"required":["body"],"additionalProperties":false}}}""")))
        val body=NativeDreamPlanProtocol.body("fixture-model","invitation",emptyList(),tools,1000)
        assertEquals(JsonPrimitive(false),body["store"]);assertEquals(JsonPrimitive(true),body["stream"])
        assertTrue(body.getValue("input").jsonArray.all{it.jsonObject["role"]==JsonPrimitive("developer")})
        assertTrue(body.getValue("instructions").jsonPrimitive.content.contains("软 token"))
        for(field in listOf("background","max_output_tokens","max_tool_calls","previous_response_id","temperature","metadata","user"))assertFalse(field in body)
        val namespace=body.getValue("tools").jsonArray.single().jsonObject
        assertEquals(JsonPrimitive("coast"),namespace["name"])
        assertEquals(JsonPrimitive("dream_write_note"),namespace.getValue("tools").jsonArray.single().jsonObject["name"])
        assertTrue(runCatching{NativeDreamPlanProtocol.body("fixture-model","invitation",emptyList(),tools,0)}.isFailure)
    }
    @Test fun completedResponseUsesExactToolIdentityAndNoImaginaryCost(){
        val response=Json.parseToJsonElement("""{"status":"completed","model":"fixture-model","usage":{"input_tokens":100,"output_tokens":20,"total_tokens":120},"output":[{"type":"reasoning","encrypted_content":"opaque-fixture"},{"type":"function_call","namespace":"coast","name":"dream_write_note","call_id":"c1","arguments":"{\"body\":\"note\"}"}]}""").jsonObject
        val step=NativeDreamPlanProtocol.complete(response,emptyMap(),setOf("dream_write_note"))
        assertEquals(JsonPrimitive(120),step.normalized.getValue("usage").jsonObject["total_tokens"])
        assertFalse("cost" in step.normalized.getValue("usage").jsonObject)
        val results=listOf(buildJsonObject{put("role","tool");put("tool_call_id","c1");put("name","dream_write_note");put("content","{\"ok\":true}")})
        val next=NativeDreamPlanProtocol.continuation(step,results)
        assertEquals(JsonPrimitive("opaque-fixture"),next.first()["encrypted_content"])
        assertEquals(JsonPrimitive("function_call_output"),next.last()["type"])
        assertEquals(JsonPrimitive("c1"),next.last()["call_id"])
        assertTrue(runCatching{NativeDreamPlanProtocol.continuation(step,emptyList())}.isFailure)
        assertTrue(runCatching{NativeDreamPlanProtocol.complete(response,emptyMap(),emptySet())}.isFailure)
        assertTrue(runCatching{NativeDreamPlanProtocol.complete(JsonObject(response+("status" to JsonPrimitive("incomplete"))),emptyMap(),setOf("dream_write_note"))}.isFailure)
        assertEquals(JsonNull,NativeDreamPlanProtocol.complete(JsonObject(response- "usage"),emptyMap(),setOf("dream_write_note")).normalized["usage"])
        assertEquals("plan_usage_limit",NativeDreamPlanProtocol.failure(429,null))
        assertEquals("plan_authorization_unavailable",NativeDreamPlanProtocol.failure(403,"subscription_sharing_user_not_eligible"))
    }
}
