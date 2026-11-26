package com.elementeracoast.app.core.local

import kotlinx.serialization.json.*
import okhttp3.*
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import org.junit.Assert.*
import org.junit.Test

class LocalIndependentWebTest {
    @Test fun fixedEndpointReturnsSourcesWithoutHistory(){
        var calls=0
        val http=OkHttpClient.Builder().addInterceptor{chain->
            val r=chain.request();assertEquals("api.tavily.com",r.url.host);assertEquals("Bearer fixture",r.header("Authorization"))
            val buffer=Buffer();r.body!!.writeTo(buffer);val payload=Json.parseToJsonElement(buffer.readUtf8()).jsonObject
            assertFalse(payload.containsKey("history"));assertFalse(payload.containsKey("api_key"));calls++
            val value=if(r.url.encodedPath=="/search")"""{"results":[{"url":"https://www.iana.org/domains","title":"IANA","content":"excerpt"},{"url":"http://127.0.0.1/","title":"bad"}]}""" else """{"results":[{"url":"https://www.iana.org/domains","raw_content":"actual page"}]}"""
            Response.Builder().request(r).protocol(Protocol.HTTP_1_1).code(200).message("ok").body(value.toResponseBody()).build()
        }.build()
        val web=LocalIndependentWeb({"fixture"},http)
        val found=web.execute("independent_web_search",buildJsonObject{put("query","public fixture")})
        assertEquals(1,found.getValue("count").jsonPrimitive.int)
        assertFalse(found.toString().contains("fixture"))
        assertEquals("actual page",web.execute("independent_web_read",buildJsonObject{put("url","https://www.iana.org/domains")}).getValue("content").jsonPrimitive.content)
        assertTrue(runCatching{web.execute("independent_web_read",buildJsonObject{put("url","https://private.local/a")})}.isFailure)
        assertTrue(runCatching{web.execute("independent_web_read",buildJsonObject{put("url","https://www.iana.org/?token=secret")})}.isFailure)
        assertTrue(runCatching{web.execute("independent_web_search",buildJsonObject{put("query","x");put("history","private")})}.isFailure)
        assertEquals(2,calls)
    }
}
