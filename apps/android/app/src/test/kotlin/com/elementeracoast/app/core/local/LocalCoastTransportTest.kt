package com.elementeracoast.app.core.local

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class LocalCoastTransportTest {
    private val mime = "application/json".toMediaType()
    private val json = Json
    private fun client(store: LocalPersistence) = OkHttpClient.Builder()
        .dns(object : okhttp3.Dns {
            override fun lookup(hostname: String): List<java.net.InetAddress> =
                throw AssertionError("Local mode attempted DNS")
        })
        .addInterceptor(LocalCoastTransport(store)).build()
    private fun call(client: OkHttpClient, path: String, method: String = "GET", body: String = "{}"): Pair<Int, JsonObject> {
        val builder = Request.Builder().url("https://" + LocalCoastTransport.HOST + path)
        builder.method(method, if (method == "GET" || method == "DELETE") null else body.toRequestBody(mime))
        return client.newCall(builder.build()).execute().use {
            it.code to json.parseToJsonElement(it.body!!.string()).jsonObject
        }
    }

    @Test fun recordsPersistAcrossTransportInstancesAndRemainIsolated() {
        val online = MemoryLocalPersistence()
        val local = MemoryLocalPersistence()
        val a = client(local)
        val created = call(a, "/api/chat/conversations", "POST", """{"title":"本机记录","room_type":"main"}""").second
        val id = created["conversation"]!!.jsonObject["id"]!!.jsonPrimitive.content
        val path = "/api/chat/history?conversation_id=" + id
        assertEquals(200, call(a, path, "PUT", """{"turns":[{"id":"t1","user":{"variants":[{"id":"u1","content":"local only"}]}}]}""").first)
        val reopened = client(local)
        assertTrue(call(reopened, path).second.toString().contains("local only"))
        assertEquals(0, call(client(online), "/api/chat/conversations").second["conversations"]!!.jsonArray.size)
        assertEquals(1, call(reopened, "/api/chat/search?q=local").second["results"]!!.jsonArray.size)
        assertEquals(200, call(reopened, "/api/chat/conversations/" + id, "PATCH", """{"title":"改名"}""").first)
        assertTrue(call(reopened, "/api/export/v1-snapshot").second.toString().contains("local only"))
        assertEquals(200, call(reopened, "/api/chat/conversations/" + id, "DELETE").first)
        assertEquals(404, call(reopened, path).first)
    }

    @Test fun unsupportedOperationsAndWrongHostsCannotReachNetwork() {
        val a = client(MemoryLocalPersistence())
        assertEquals(501, call(a, "/api/chat", "POST").first)
        assertEquals(501, call(a, "/api/memory/user-portrait").first)
        a.newCall(Request.Builder().url("https://example.com/").build()).execute().use {
            assertEquals(403, it.code)
        }
    }

    @Test fun localKnowledgeIsDurableAndInjectedWithoutNetwork(){
        val store=MemoryLocalPersistence()
        val a=client(store)
        assertEquals(200,call(a,"/api/memory/custom-instructions","PUT","""{"content":"Keep original text"}""").first)
        assertEquals(200,call(a,"/api/worldbook","POST","""{"title":"Coast","content":"Matched text","keywords":["wave"]}""").first)
        assertEquals(200,call(a,"/api/worldbook","POST","""{"title":"Visitor","content":"Private visitor text","keywords":["wave"],"scope":"visitor","visitor_safe":true}""").first)
        val reopened=client(store)
        assertTrue(call(reopened,"/api/memory/custom-instructions").second.toString().contains("Keep original text"))
        assertEquals(2,call(reopened,"/api/worldbook").second.getValue("entries").jsonArray.size)
        val id=call(reopened,"/api/chat/conversations","POST").second.getValue("conversation").jsonObject.getValue("id").jsonPrimitive.content
        val body=buildJsonObject{
            put("conversation_id",id);put("source_turn_id","turn1");put("model","fixture");put("local_date","2026-11-24");put("local_datetime","2026-11-24T12:00:00")
            putJsonArray("messages"){add(buildJsonObject{put("role","user");put("content","wave")})}
        }
        val response=call(reopened,"/api/chat/native-context","POST",body.toString())
        assertEquals(200,response.first)
        assertTrue(response.second.toString().contains("Keep original text"));assertTrue(response.second.toString().contains("Matched text"))
        assertFalse(response.second.toString().contains("Private visitor text"))
        assertTrue(LocalKnowledgeStore(store).context(listOf(com.elementeracoast.app.core.remote.RemoteChatMessage("user","wave")),1800,"main_chat").receipt.customInstructions.delivered)
        assertTrue(runCatching{LocalKnowledgeStore(store).context(listOf(com.elementeracoast.app.core.remote.RemoteChatMessage("user","x".repeat(6000))),1800,"main_chat")}.isFailure)
    }
    @Test fun dailyRecordsSurviveReopen() {
        val local = MemoryLocalPersistence()
        val a = client(local)
        assertEquals(200, call(a, "/api/daily/diaries", "POST", """{"date":"2026-11-24","text":"本机日记"}""").first)
        assertTrue(call(client(local), "/api/daily/diaries").second.toString().contains("本机日记"))
    }
}
