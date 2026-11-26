package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.remote.RemoteChatMessage
import com.elementeracoast.app.core.network.CoastApiException
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import com.elementeracoast.app.core.remote.*
import com.elementeracoast.app.core.network.RemoteReplyRunRequest
import com.elementeracoast.app.core.network.RemoteReplyRunBudget
import com.elementeracoast.app.core.model.ConversationContextSettings
import com.elementeracoast.app.feature.chat.ChatSyncMapper
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import org.junit.Assert.*
import org.junit.Test

class LocalProviderClientTest {
    private val p = LocalProviderConfig("p", "Test", "https://provider.example/v1", "test-key", listOf("test/model"))

    private fun client(handler: (okhttp3.Request) -> Pair<Int, String>): LocalProviderClient {
        val http = OkHttpClient.Builder().addInterceptor(Interceptor { chain ->
            val r = chain.request()
            val (code, body) = handler(r)
            Response.Builder().request(r).protocol(Protocol.HTTP_1_1).code(code).message("test")
                .body(body.toResponseBody()).build()
        }).build()
        return LocalProviderClient(http)
    }

    @Test fun rejectsPlaintextAndEmbeddedCredentials() {
        assertEquals("https://provider.example/v1", normalizeLocalProviderUrl(" https://provider.example/v1/ "))
        listOf("http://provider.example/v1", "https://" + "u:p@" + "provider.example/v1",
            "https://provider.example/v1?secret=1", "https://provider.example/v1/chat/completions").forEach {
            assertTrue(runCatching { normalizeLocalProviderUrl(it) }.isFailure)
        }
        assertFalse(p.toString().contains(p.apiKey))
    }

    @Test fun modelsAndStreamUseOnlySelectedProvider() = runBlocking {
        val requests = mutableListOf<String>()
        val c = client { r ->
            assertEquals("provider.example", r.url.host)
            assertEquals("Bearer test-key", r.header("Authorization"))
            assertNull(r.header("Cookie"))
            requests.add(r.url.encodedPath)
            if (r.url.encodedPath.endsWith("/models")) 200 to """{"data":[{"id":"test/model"}]}"""
            else {
                val buffer = Buffer()
                r.body!!.writeTo(buffer)
                assertTrue(buffer.readUtf8().contains("test/model"))
                200 to "data: {\"choices\":[{\"delta\":{\"content\":\"hello\"}}]}\n\ndata: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n"
            }
        }
        assertEquals(listOf("test/model"), c.models(p))
        val events=c.stream(p, "test/model", listOf(RemoteChatMessage("user", "hi")), 128).toList()
        assertEquals(LocalProviderEvent.Delta("hello"),events.first())
        assertEquals("stop",(events.last() as LocalProviderEvent.Done).reason)
        assertNull((events.last() as LocalProviderEvent.Done).metadata!!.usage)
        assertEquals(listOf("/v1/models", "/v1/chat/completions"), requests)
    }

    @Test fun failureDoesNotExposeUpstreamSecretsOrBecomeCoastLogout() = runBlocking {
        val c = client { 401 to """{"error":{"message":"test-key"}}""" }
        val error = runCatching { c.models(p) }.exceptionOrNull() as CoastApiException
        assertEquals(com.elementeracoast.app.core.network.CoastApiErrorKind.Model, error.kind)
        assertFalse(error.message.contains(p.apiKey))
    }

    @Test fun authorizationDiagnosticNeverEchoesSecret() = runBlocking {
        val c = client { r ->
            assertEquals("/api/v1/key", r.url.encodedPath)
            assertEquals("Bearer test-key", r.header("Authorization"))
            401 to """{"error":{"message":"User not found test-key"}}"""
        }
        val result = c.authorizationCheck(p.copy(baseUrl = "https://openrouter.ai/api/v1"))
        assertTrue(result.contains("HTTP 401"))
        assertTrue(result.contains("User not found"))
        assertFalse(result.contains("test-key"))
    }

    @Test fun interruptedStreamDoesNotFabricateDone() = runBlocking {
        val c = client { 200 to "data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n" }
        assertTrue(runCatching { c.stream(p, "test/model", listOf(RemoteChatMessage("user", "hi")), 128).toList() }.isFailure)
    }
    @Test fun sequenceControlIsNotAnOrdinaryToolAndUsesCumulativeUsage()=runBlocking {
        val payloads=mutableListOf<kotlinx.serialization.json.JsonObject>()
        val c=client { r->
            val buffer=Buffer();r.body!!.writeTo(buffer)
            payloads.add(kotlinx.serialization.json.Json.parseToJsonElement(buffer.readUtf8()) as kotlinx.serialization.json.JsonObject)
            val content=if(payloads.size==1)
                """{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"continue_reply","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}"""
            else """{"choices":[{"delta":{"content":"first"},"finish_reason":"stop"}]}"""
            200 to "data: $content\n\ndata: {\"choices\":[],\"usage\":{\"prompt_tokens\":30,\"completion_tokens\":10,\"total_tokens\":40}}\n\ndata: [DONE]\n\n"
        }
        val events=c.streamWithTools(p,"test/model",listOf(RemoteChatMessage("user","hi")),128,emptyList(),null,sequence=LocalSequenceControl(true,0,1000)).toList()
        val done=events.last() as LocalProviderEvent.Done
        assertTrue(done.continueRequested);assertEquals(0,done.ordinaryToolCalls);assertEquals(80L,done.metadata?.usage?.totalTokens)
        assertEquals(2,payloads.size)
        assertTrue(payloads.first().getValue("tools").toString().contains("continue_reply"))
        assertFalse(payloads.last().containsKey("tools"))
        assertTrue(events.none{it is LocalProviderEvent.Tool})
    }

    @Test fun priorGroupOriginalsReachLocalProviderOnlyWithVision()=runBlocking {
        val store=MemoryLocalPersistence();val cache=RemoteCacheStore(store);val cid="mixed-local"
        cache.putConversations(listOf(RemoteConversation(cid,"test","main")))
        val settings=ConversationContextSettings(replySequenceEnabled=true,stickerSendEnabled=true,localModelToolsEnabled=true,localModelWriteEnabled=true)
        val h=ChatSyncMapper.appendUser(RemoteHistory(conversationId=cid,contextSettings=settings),"hello")
        cache.putHistory(cid,h.history)
        val uid=h.history.turns.single().user.variants.single().id
        val req=RemoteReplyRunRequest(cid,h.turnId,uid,"seq","model",RemoteReplyRunBudget(3,4,48000),"2026-11-26","2026-11-26 12:00",JsonObject(emptyMap()))
        val png=byteArrayOf(137.toByte(),80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,6,0,0,0)
        val lib=LocalStickerLibrary(store);val sticker=lib.upload("wolf.png","image/png","wolf",png)
        val ledger=LocalReplyRunStore(store)
        assertTrue(ledger.acquire(req));assertTrue(ledger.reserve(cid,"seq","a0",0));assertNotNull(ledger.claim(cid,"seq","a0"))
        assertTrue(ledger.reserveMedia(cid,"seq","a0","model",false))
        val ctx=LocalKnowledgeStore(store).context(listOf(RemoteChatMessage("user","hello")),6000,"main_chat",cid)
        val session=LocalKnowledgeStore(store).toolSession(cid,h.turnId,null,ctx.receipt,"test/model",messageId="a0",sequenceId="seq")!!
        val tool= session.execute("sticker-call","sticker_send",buildJsonObject{put("sticker_id",sticker.id)}.toString())
        assertTrue(tool.output,tool.ok);assertTrue(session.stickerSaved)
        assertNotNull(ledger.commit(cid,"seq",RemoteVariant("a0","",finishReason="stop"),LocalReplyRunStore.Usage("a0",1,120,true)))
        assertTrue(ledger.reserve(cid,"seq","a1",1));assertNotNull(ledger.claim(cid,"seq","a1"));assertTrue(ledger.reserveMedia(cid,"seq","a1","model",true))
        val old=cache.history(cid)!!;val turn=old.turns.single();val branch=turn.assistant.variantsByUserVariant.getValue("0")
        // The image provider result is synthetic; use the actual saved-original transaction.
        val pending=turn.copy(assistant=turn.assistant.copy(variantsByUserVariant=mapOf("0" to branch.map{if(it.id=="a1")it.copy(finishReason="image_pending")else it})))
        store.atomic{ s->RemoteCacheStore(s).putHistory(cid,old.copy(turns=listOf(pending)));LocalReplyRunStore(s).syncMediaHistory(cid,"seq")}
        saveGeneratedImageOriginal(store,cid,h.turnId,"a1",LocalImageProvider.Generated(png,"image/png","openrouter","fixture/paid",null,null,"draw"),true,uid,true,sequenceId="seq")
        assertNotNull(ledger.commit(cid,"seq",RemoteVariant("a1","",finishReason="stop"),LocalReplyRunStore.Usage("a1",1,120,true)))
        assertTrue(ledger.reserve(cid,"seq","a2",2));val claim=ledger.claim(cid,"seq","a2")!!
        val (vision,receipts)=localReplyPreviousMedia(store,cid,claim.previous,true)
        val (textOnly,withheld)=localReplyPreviousMedia(store,cid,claim.previous,false)
        assertEquals(listOf("a0","a1"),receipts.map{it.messageId})
        assertTrue(receipts.all{it.mediaReceipt?.vision?.imagesDelivered==1})
        assertTrue(withheld.all{it.mediaReceipt?.notDelivered?.single()?.reason=="model_no_vision"})
        assertTrue(textOnly.all{it["role"]?.jsonPrimitive?.content=="system"&&!it.toString().contains("base64")})
        val calls=mutableListOf<JsonObject>()
        val c=client{r->
            val b=Buffer();r.body!!.writeTo(b);calls.add(Json.parseToJsonElement(b.readUtf8()).jsonObject)
            200 to "data: {\"choices\":[{\"delta\":{\"content\":\"after both\"},\"finish_reason\":\"stop\"}]}\n\ndata: {\"choices\":[],\"usage\":{\"prompt_tokens\":100,\"completion_tokens\":20,\"total_tokens\":120}}\n\ndata: [DONE]\n\n"
        }
        val events=c.streamWithTools(p,"test/model",listOf(RemoteChatMessage("user","hello")),128,emptyList(),null,sequence=LocalSequenceControl(false,0,claim.tokens),priorGroupMessages=vision).toList()
        val wire=calls.single().getValue("messages").jsonArray
        val images=wire.flatMap{(it.jsonObject["content"] as? JsonArray).orEmpty()}.filter{it.jsonObject["type"]?.jsonPrimitive?.content=="image_url"}
        assertEquals(2,images.size)
        val expected="data:image/png;base64,"+java.util.Base64.getEncoder().encodeToString(png)
        assertTrue(images.all{it.jsonObject.getValue("image_url").jsonObject.getValue("url").jsonPrimitive.content==expected})
        assertTrue(wire.filter{it.jsonObject["content"] is JsonArray}.all{it.toString().contains("非人类新发言")})
        val done=events.last() as LocalProviderEvent.Done
        assertNotNull(ledger.commit(cid,"seq",RemoteVariant("a2","after both",finishReason=done.reason),LocalReplyRunStore.Usage("a2",done.ordinaryToolCalls,done.metadata?.usage?.totalTokens,false)))
        assertTrue(ledger.settle(cid,"seq","completed"))
        assertEquals(listOf("a0","a1","a2"),cache.history(cid)!!.turns.single().assistant.variantsByUserVariant.getValue("0").map{it.id})
    }

}
