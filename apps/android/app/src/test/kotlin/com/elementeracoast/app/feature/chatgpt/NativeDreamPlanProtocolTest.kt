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

    @Test fun streamRequiresExplicitCompletionAndKeepsCompletedToolFrames(){
        val stream=NativeDreamPlanStream(setOf("dream_write_note"))
        assertNull(stream.line("data: "+"""{"type":"response.output_text.delta","delta":"partial"}"""))
        assertNull(stream.line(""));assertNull(stream.finish())
        val done=NativeDreamPlanStream(emptySet())
        assertNull(done.line("data: "+"""{"type":"response.completed","response":{"status":"completed","usage":{"total_tokens":10},"output":[]}}"""))
        val step=done.line("")!!
        assertEquals(JsonPrimitive(10),step.normalized.getValue("usage").jsonObject["total_tokens"])
        val denied=NativeDreamPlanStream(emptySet())
        denied.line("data: "+"""{"type":"response.failed","response":{"error":{"code":"subscription_sharing_usage_limit_exceeded"}}}""")
        val failure=runCatching{denied.line("")}.exceptionOrNull() as NativeDreamPlanFailure
        assertEquals("plan_usage_limit",failure.reason)
    }
    @Test fun sessionDoesNotReplayFailedReservationOrSpendAfterMissingUsage()=kotlinx.coroutines.runBlocking{
        val tool=Json.parseToJsonElement("""{"type":"function","function":{"name":"dream_write_note","description":"optional note","parameters":{"type":"object"}}}""")
        val tools=JsonArray(listOf(tool))
        var attempts=0;var reservations=0
        val broken=NativeDreamPlanSession(grant,"invitation",10000,500){_,_->attempts++;throw NativeDreamPlanFailure("plan_usage_limit")}
        assertTrue(runCatching{broken.step(0,tools,emptyList(),reserve={reservations++;true},authorize={true})}.isFailure)
        assertFalse(broken.canContinue())
        assertTrue(runCatching{broken.step(0,tools,emptyList(),reserve={reservations++;true},authorize={true})}.isFailure)
        assertEquals(1,attempts);assertEquals(1,reservations)
        val unknown=NativeDreamPlanSession(grant,"invitation",10000,500){_,exposed->
            NativeDreamPlanProtocol.complete(Json.parseToJsonElement("""{"status":"completed","output":[{"type":"function_call","namespace":"coast","name":"dream_write_note","call_id":"c1","arguments":"{}"}]}""").jsonObject,emptyMap(),exposed)
        }
        val step=unknown.step(0,tools,emptyList(),reserve={true},authorize={true})
        assertEquals(JsonNull,step.normalized["usage"]);assertFalse(unknown.canContinue())
        val small=NativeDreamPlanSession(grant,"invitation",1,500){_,_->error("must not send")}
        assertTrue(runCatching{small.step(0,tools,emptyList(),reserve={error("must not reserve")},authorize={true})}.isFailure)
    }


    @Test fun deviceGrantFencePausesEveryExistingWindowAndRearmOnlyRestoresOne(){
        val store=com.elementeracoast.app.core.local.MemoryLocalPersistence()
        val grants=NativeDreamPlanGrants(store)
        val m="chatgpt-plan:fixture-model";val names=setOf("fixture-model")
        assertFalse(grants.grant("window","revision",m,account,"epoch",names,false,3))
        assertFalse(grants.grant("window","revision",m,account,"epoch",emptySet(),true,3))
        assertTrue(grants.grant("window","revision",m,account,"epoch",names,true,3))
        assertTrue(grants.grant("other","other-revision",m,account,"epoch",names,true,2))
        assertEquals(grant,grants.resolve("window","revision",m,account,"epoch"))
        assertNull(grants.resolve("window","revision",m,account,"new-epoch"))
        assertNull(grants.resolve("window","revision",m,account.copy(hostId="other-host"),"epoch"))
        assertNull(grants.resolve("window","revision",m,account.copy(scopes=emptyList()),"epoch"))
        assertNull(grants.resolve("window","revision",m,null,null))
        val stored=store.get("local.dream.plan.grant.window")
        for(secret in listOf(account.email,account.accessToken,account.refreshToken,"\"subject\"","\"client\""))assertFalse(stored.contains(secret))
        grants.pause(account,"epoch")
        assertEquals("paused",grants.status("window","revision",m,account,"epoch"))
        assertNull(grants.resolve("other","other-revision",m,account,"epoch"))
        assertTrue(grants.grant("window","next-revision",m,account,"epoch",names,true,3))
        assertNull(grants.resolve("window","revision",m,account,"epoch"))
        assertNotNull(grants.resolve("window","next-revision",m,account,"epoch"))
        assertNull(grants.resolve("other","other-revision",m,account,"epoch"))
        grants.revoke("window")
        assertNull(grants.resolve("window","next-revision",m,account,"epoch"))
        assertEquals("plan_usage_unavailable",NativeDreamPlanProtocol.failure(503,"subscription_sharing_usage_unavailable"))
    }

}
