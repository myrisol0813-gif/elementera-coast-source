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
        assertEquals(501, call(a, "/api/memory/user-portrait/candidates", "POST").first)
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

    @Test fun nativeToolRouteUsesOnlyAuthorizedLocalSession() {
        val local=MemoryLocalPersistence()
        val a=client(local)
        fun create(title:String)=call(a,"/api/chat/conversations","POST",buildJsonObject{put("title",title)}.toString()).second
            .getValue("conversation").jsonObject.getValue("id").jsonPrimitive.content
        val cid=create("current");val old=create("old")
        assertEquals(200,call(a,"/api/chat/history?conversation_id="+cid,"PUT",
            """{"context_settings":{"cross_window_auto":true},"turns":[{"id":"t1","user":{"variants":[{"id":"u1","content":"问题"}]}}]}""").first)
        assertEquals(200,call(a,"/api/chat/history?conversation_id="+old,"PUT",
            """{"turns":[{"id":"t2","user":{"variants":[{"id":"u2","content":"旧信全文"}]}}]}""").first)
        val request=buildJsonObject{
            put("conversation_id",cid);put("source_turn_id","t1");put("message_id","assistant1");put("model","fixture")
            put("local_date","2026-11-25");put("local_datetime","2026-11-25T12:00:00")
            putJsonObject("cross_window"){put("mode","model_decides")}
            putJsonArray("messages"){add(buildJsonObject{put("role","user");put("content","问题")})}
        }
        val context=call(a,"/api/chat/native-context","POST",request.toString())
        assertEquals(200,context.first)
        assertTrue(context.second.getValue("tools").toString().contains("cross_window_keyword_search"))
        assertFalse(context.second.getValue("model_messages").toString().contains("旧信全文"))
        fun invoke(id:String,name:String,args:String):Pair<Int,JsonObject>{
            val body=JsonObject(request+("tool_call" to buildJsonObject{
                put("id",id);put("type","function");putJsonObject("function"){put("name",name);put("arguments",args)}
            }))
            return call(a,"/api/chat/native-tool","POST",body.toString())
        }
        val found=invoke("call1","cross_window_keyword_search","""{"query":"旧信"}""")
        assertEquals(200,found.first);assertTrue(found.second.getValue("ok").jsonPrimitive.boolean)
        val args=buildJsonObject{putJsonArray("messages"){add(buildJsonObject{put("conversation_id",old);put("message_id","u2")})}}.toString()
        val read=invoke("call2","cross_window_read_messages",args)
        assertTrue(read.second.getValue("ok").jsonPrimitive.boolean)
        assertTrue(read.second.getValue("output").jsonPrimitive.content.contains("旧信全文"))
        assertEquals(2,LocalToolAudit(local).read().size)
        assertEquals(200,call(a,"/api/chat/history?conversation_id="+cid,"PUT",
            """{"turns":[{"id":"t1","user":{"variants":[{"id":"u1","content":"问题"}]}}]}""").first)
        assertFalse(invoke("call3","cross_window_keyword_search","""{"query":"旧信"}""").second.getValue("ok").jsonPrimitive.boolean)
    }

    @Test fun localEchoReadsHistoricalAndActualMetadataWithoutNetwork(){
        val local=MemoryLocalPersistence();val a=client(local)
        val id=call(a,"/api/chat/conversations","POST").second.getValue("conversation").jsonObject.getValue("id").jsonPrimitive.content
        val payload="""{"turns":[{"id":"t1","user":{"variants":[{"id":"u1","content":"问题"}]},"assistant":{"variantsByUserVariant":{"0":[{"id":"a1","content":"旧回复","model_id":"fixture","finish_reason":"stop"},{"id":"a2","content":"新回复","model_echo":{"provider":"fixture.example","requested_model":"fixture","reasoning_text":"返回的摘要","finish_reason":"stop"},"usage":{"prompt_tokens":100,"cached_tokens":25,"completion_tokens":10}}]}}}]}"""
        assertEquals(200,call(a,"/api/chat/history?conversation_id="+id,"PUT",payload).first)
        fun get(mid:String)=call(client(local),"/api/chat/message-metadata?conversation_id="+id+"&message_id="+mid+"&include_raw=1")
        assertEquals("not_returned",get("a1").second.getValue("status").jsonPrimitive.content)
        val echo=get("a2");assertEquals(200,echo.first)
        assertEquals("saved",echo.second.getValue("status").jsonPrimitive.content)
        assertEquals(25,echo.second.getValue("metadata").jsonObject.getValue("usage").jsonObject.getValue("cached_tokens").jsonPrimitive.int)
        assertEquals(404,get("u1").first)
        assertEquals(404,get("missing").first)
    }
}
