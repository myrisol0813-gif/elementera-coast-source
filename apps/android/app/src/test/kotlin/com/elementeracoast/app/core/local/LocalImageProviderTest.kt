package com.elementeracoast.app.core.local

import kotlinx.serialization.json.*
import okhttp3.*
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import org.junit.Assert.*
import org.junit.Test
import java.util.Base64

class LocalImageProviderTest{
    @Test fun freeDiscoveryAndExplicitCostAuthorization(){
        val png=byteArrayOf(137.toByte(),80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,6,0,0,0)
        var calls=0
        val client=OkHttpClient.Builder().addInterceptor{chain->
            val r=chain.request();calls++
            assertEquals("openrouter.ai",r.url.host)
            val value=if(r.url.encodedPath.endsWith("/models"))"""{"data":[{"id":"fixture/paid","architecture":{"output_modalities":["image"]}},{"id":"fixture/free:free","architecture":{"output_modalities":["image"]}},{"id":"fixture/text:free","architecture":{"output_modalities":["text"]}}]}""" else {
                assertEquals("/api/v1/images",r.url.encodedPath);assertEquals("Bearer fixture-key",r.header("Authorization"))
                val buf=Buffer();r.body!!.writeTo(buf)
                val payload=Json.parseToJsonElement(buf.readUtf8()).jsonObject
                assertEquals(setOf("model","prompt","n"),payload.keys)
                assertEquals("fixture/free:free",payload["model"]!!.jsonPrimitive.content)
                assertEquals("one drawing",payload["prompt"]!!.jsonPrimitive.content)
                buildJsonObject{
                    put("model","fixture/free:free");put("data",JsonArray(listOf(buildJsonObject{put("b64_json",Base64.getEncoder().encodeToString(png))})))
                    put("usage",buildJsonObject{put("cost",0)})
                }.toString()
            }
            Response.Builder().request(r).protocol(Protocol.HTTP_1_1).code(200).message("ok").body(value.toResponseBody()).build()
        }.build()
        val provider=LocalImageProvider(client)
        assertEquals(listOf("fixture/free:free","fixture/paid"),provider.discover().map{it.id})
        val config=LocalImageProvider.Config("fixture-key","fixture/free:free")
        val input=buildJsonObject{put("prompt","one drawing")}
        val result=provider.generate(config,input)
        assertArrayEquals(png,result.bytes);assertEquals("image/png",result.mime);assertEquals("fixture/free:free",result.reportedModel);assertEquals(0.0,result.costUsd!!,0.0)
        val rejected=runCatching{provider.generate(config.copy(model="fixture/paid"),input)}.exceptionOrNull() as LocalImageProvider.Failure
        assertEquals("paid_not_authorized",rejected.code)
        assertTrue(runCatching{provider.generate(config,buildJsonObject{put("prompt","x");put("history","private")})}.isFailure)
        assertEquals(2,calls)
        assertFalse(config.toString().contains("fixture-key"))
    }
}
