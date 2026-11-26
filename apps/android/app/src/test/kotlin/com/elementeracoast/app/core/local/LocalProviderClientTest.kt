package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.remote.RemoteChatMessage
import com.elementeracoast.app.core.network.CoastApiException
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking
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

}
