package com.elementeracoast.app.core.local

import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.flow.toList
import kotlinx.serialization.json.*
import okhttp3.*
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import org.junit.Assert.*
import org.junit.Test

class LocalSoilPolicyTest {
    private val provider=LocalProviderConfig("p","fixture","https://openrouter.ai/api/v1","test-key")
    private val catalog=Json.parseToJsonElement("""{"data":[{"id":"fixture","supported_parameters":["reasoning","temperature","response_format","structured_outputs"],"reasoning_efforts":["low","high"],"top_provider":{"max_completion_tokens":10000}}]}""").jsonObject
    @Test fun adaptsOnlyDeclaredCapabilities(){
        val p=LocalSoilPolicy.forProvider(provider,"fixture",catalog)
        assertTrue(p.nonStreaming);assertEquals(3200,p.firstBudget);assertEquals(10000,p.retryBudget)
        assertEquals("low",p.options().getValue("reasoning").jsonObject.getValue("effort").jsonPrimitive.content)
        assertEquals("json_schema",p.options().getValue("response_format").jsonObject.getValue("type").jsonPrimitive.content)
        val unknown=LocalSoilPolicy.forProvider(provider,"unknown",catalog)
        assertTrue(unknown.options().isEmpty());assertEquals(8192,unknown.firstBudget)
        val other=LocalSoilPolicy.forProvider(provider.copy(baseUrl="https://example.com/v1"),"fixture",catalog)
        assertFalse(other.nonStreaming);assertTrue(other.options().isEmpty())
    }
    @Test fun nonStreamingWireUsesSelectedModelAndCatalogCache()=runBlocking{
        var calls=0
        val http=OkHttpClient.Builder().addInterceptor{chain->
            val r=chain.request();calls++
            val body=if(r.url.encodedPath.endsWith("/models"))catalog.toString() else{
                val buf=Buffer();r.body!!.writeTo(buf);val payload=Json.parseToJsonElement(buf.readUtf8()).jsonObject
                assertEquals("fixture",payload.getValue("model").jsonPrimitive.content)
                assertFalse(payload.getValue("stream").jsonPrimitive.boolean)
                assertEquals(3200,payload.getValue("max_tokens").jsonPrimitive.int)
                assertFalse("tools" in payload)
                assertTrue("reasoning" in payload&&"response_format" in payload)
                """{"choices":[{"finish_reason":"stop","message":{"content":"{\"current_text\":\"纸条\",\"afterthoughts\":[]}"}}]}"""
            }
            Response.Builder().request(r).protocol(Protocol.HTTP_1_1).code(200).message("ok").body(body.toResponseBody()).build()
        }.build()
        val c=LocalProviderClient(http);val p=c.soilPolicy(provider,"fixture")
        val events=c.organize(provider,"fixture","fixture prompt",p.firstBudget,p).toList()
        assertEquals("stop",(events.last() as LocalProviderEvent.Done).reason)
        assertTrue((events.first() as LocalProviderEvent.Delta).text.contains("纸条"))
        c.soilPolicy(provider,"fixture");assertEquals(2,calls)
    }
}
