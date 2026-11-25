package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.model.ConversationContextSettings
import com.elementeracoast.app.core.remote.*
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.flow.toList
import kotlinx.serialization.json.*
import okhttp3.*
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import org.junit.Assert.*
import org.junit.Test

class LocalToolSessionTest {
    private fun fixture(auto:Boolean=true,tools:Boolean=false):MemoryLocalPersistence {
        val store=MemoryLocalPersistence();val cache=RemoteCacheStore(store)
        cache.putConversations(listOf(RemoteConversation("current","Current"),RemoteConversation("old","Old")))
        cache.putHistory("current",RemoteHistory(conversationId="current",contextSettings=ConversationContextSettings(crossWindowAuto=auto,localModelToolsEnabled=tools),
            turns=listOf(RemoteTurn("turn-now",user=RemoteUserBranch(variants=listOf(RemoteVariant("u-now","现在的问题")))))))
        cache.putHistory("old",RemoteHistory(conversationId="old",turns=listOf(
            RemoteTurn("turn-old",user=RemoteUserBranch(variants=listOf(RemoteVariant("u-old","海岸旧信完整原文"+"x".repeat(220)),RemoteVariant("u-hidden","海岸隐藏分支",hidden=true))),
                assistant=RemoteAssistantBranches(variantsByUserVariant=mapOf("0" to listOf(RemoteVariant("a-old","其他内容"))))))))
        return store
    }
    private fun open(s:MemoryLocalPersistence):LocalToolSession? {
        val k=LocalKnowledgeStore(s)
        val req=RemoteCrossWindowRequest("model_decides")
        val c=k.context(listOf(RemoteChatMessage("user","现在的问题")),12000,"main_chat","current",crossWindow=req)
        return k.toolSession("current","turn-now",req,c.receipt)
    }
    private val select="""{"messages":[{"conversation_id":"old","message_id":"u-old"}]}"""
    @Test fun permissionSearchAndReadAreSeparateAndAuditIsRedacted(){
        val s=fixture();val tool=open(s)!!
        assertFalse(tool.receipt.crossWindow.delivered)
        assertFalse(tool.execute("call1","cross_window_read_messages",select).ok)
        val search=tool.execute("call2","cross_window_keyword_search","""{"query":"海岸"}""")
        assertTrue(search.ok);assertTrue(search.output.contains("u-old"));assertFalse(search.output.contains("u-hidden"))
        assertFalse(tool.receipt.crossWindow.delivered)
        val read=tool.execute("call3","cross_window_read_messages",select)
        assertTrue(read.ok);assertTrue(read.output.contains("x".repeat(220)))
        assertEquals(1,read.deskSlip.crossWindow.deliveredToModelMessages)
        assertEquals("u-old",read.deskSlip.crossWindow.messages.single().messages.single().messageId)
        assertFalse(tool.execute("call3","cross_window_read_messages",select).ok)
        val audit=LocalToolAudit(s).read()
        assertEquals(3,audit.size);assertFalse(audit.toString().contains("完整原文"))
        val cache=RemoteCacheStore(s);cache.putHistory("current",cache.history("current")!!.copy(contextSettings=ConversationContextSettings()))
        assertFalse(tool.execute("call4","cross_window_keyword_search","""{"query":"海岸"}""").ok)
        assertTrue(runCatching{open(s)}.isFailure)
    }
    @Test fun directProviderReplaysActualToolOutput()=runBlocking{
        val s=fixture();val session=open(s)!!
        var n=0
        val http=OkHttpClient.Builder().addInterceptor{chain->
            val r=chain.request();val buffer=Buffer();r.body!!.writeTo(buffer)
            val payload=Json.parseToJsonElement(buffer.readUtf8()).jsonObject
            assertEquals("provider.example",r.url.host)
            val body=if(n++==0){
                assertTrue(payload.getValue("tools").toString().contains("cross_window_keyword_search"))
                val chunk=buildJsonObject{putJsonArray("choices"){add(buildJsonObject{
                    putJsonObject("delta"){putJsonArray("tool_calls"){add(buildJsonObject{
                        put("index",0);put("id","call1");putJsonObject("function"){put("name","cross_window_keyword_search");put("arguments","""{"query":"海岸"}""")}
                    })}}
                    put("finish_reason","tool_calls")
                })}}
                "data: "+chunk.toString()+"\n\ndata: [DONE]\n\n"
            }else{
                val messages=payload.getValue("messages").jsonArray
                assertTrue(messages.last().jsonObject.getValue("content").jsonPrimitive.content.contains("u-old"))
                "data: {\"choices\":[{\"delta\":{\"content\":\"查到了\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n"
            }
            Response.Builder().request(r).protocol(Protocol.HTTP_1_1).code(200).message("ok").body(body.toResponseBody()).build()
        }.build()
        val p=LocalProviderConfig("p","Test","https://provider.example/v1","test-key",listOf("test/model"))
        val events=LocalProviderClient(http).streamWithTools(p,"test/model",listOf(RemoteChatMessage("user","hi")),128,emptyList(),session).toList()
        assertEquals(2,n);assertTrue(events.any{it is LocalProviderEvent.Tool&&it.result.ok})
        assertEquals("stop",(events.last() as LocalProviderEvent.Done).reason)
    }
    @Test fun completedOrEditedTurnCannotReuseAnOldToolSession(){
        val s=fixture();val tool=open(s)!!
        val cache=RemoteCacheStore(s)
        val h=cache.history("current")!!
        cache.putHistory("current",h.copy(turns=h.turns.map{t->if(t.id=="turn-now")t.copy(user=t.user.copy(variants=t.user.variants.map{it.copy(content="edited")}))else t}))
        assertFalse(tool.execute("stale","cross_window_keyword_search","""{"query":"海岸"}""").ok)
    }
}
