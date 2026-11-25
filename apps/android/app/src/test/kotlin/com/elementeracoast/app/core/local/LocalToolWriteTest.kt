package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.model.ConversationContextSettings
import com.elementeracoast.app.core.remote.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class LocalToolWriteTest {
    @Test fun writesRetainModelProvenanceAndRoundTrip(){
        val s=MemoryLocalPersistence();val cache=RemoteCacheStore(s)
        val cid="fixture";val tid="turn1"
        cache.putConversations(listOf(RemoteConversation(cid,"窗口")))
        cache.putHistory(cid,RemoteHistory(conversationId=cid,contextSettings=ConversationContextSettings(localModelWriteEnabled=true),
            turns=listOf(RemoteTurn(tid,user=RemoteUserBranch(variants=listOf(RemoteVariant("u1","记录")))))))
        val book=LocalSideRecords(s).importBook(buildJsonObject{
            put("title","测试书");put("format","txt")
            putJsonArray("chapters"){add(buildJsonObject{put("title","第一章");put("body","原文段落")})}
        }).getValue("id").jsonPrimitive.content
        val k=LocalKnowledgeStore(s)
        val ctx=k.context(listOf(RemoteChatMessage("user","记录")),18000,"main_chat",cid)
        val session=k.toolSession(cid,tid,null,ctx.receipt,"fixture-model")!!
        fun call(id:String,name:String,args:String):RemoteNativeToolResult{
            val result=session.execute(id,name,args)
            assertTrue(result.output,result.ok)
            return result
        }
        call("c1","create_moment","""{"date":"2026-11-25","text":"模型动态"}""")
        call("c2","create_diary","""{"date":"2026-11-25","text":"模型日记"}""")
        call("c3","calendar_create","""{"date":"2026-11-25","title":"模型事项"}""")
        call("c4","library_write",buildJsonObject{
            put("book_id",book);put("kind","annotation");put("body","模型批注");put("chapter_index",0);put("paragraph_index",0)
        }.toString())
        call("c5","memory_write_candidate","""{"title":"候选","content":"尚未确认","destination":"memory"}""")
        assertEquals("model_partner",cache.dailyMoments().single().author)
        assertEquals("fixture-model",cache.dailyDiaries().single().modelLabel)
        assertEquals(tid,cache.dailyDiaries().single().sourceTurnId)
        assertEquals(5,LocalToolAudit(s).read().size)
        assertEquals("assistant",LocalSideRecords(s).rows().single{it.kind=="library_notes"}.data["author"]!!.jsonPrimitive.content)
        assertTrue(LocalMemoryStore(s).snapshot().entries.isEmpty())
        assertEquals(1,LocalMemoryStore(s).pockets(cid).size)
        assertFalse(session.execute("c1","create_moment","""{"date":"2026-11-25","text":"重复"}""").ok)
        assertFalse(session.execute("c6","create_diary","""{"date":"bad","text":"不应保存"}""").ok)
        assertEquals(1,cache.dailyDiaries().size)
        val dir=java.nio.file.Files.createTempDirectory("local-tool-archive").toFile()
        try {
            val zip=java.io.File(dir,"writes.zip")
            val manifest=ArchiveV2Local.export(s,"com.elementeracoast.source",zip)
            val stage=ArchiveV2Stage(dir,"verified")
            assertEquals(manifest,ArchiveV2ZipReader.stage(zip,stage))
            val dest=MemoryLocalPersistence()
            ArchiveV2Local.restore(manifest,stage,setOf("chat","daily","calendar","library","memory_pockets","tools"),"com.elementeracoast.source",dest,true)
            assertEquals(cache.dailyMoments(),RemoteCacheStore(dest).dailyMoments())
            assertEquals(cache.dailyDiaries(),RemoteCacheStore(dest).dailyDiaries())
            assertEquals(LocalCalendarStore(s).snapshot(),LocalCalendarStore(dest).snapshot())
            assertEquals(LocalSideRecords(s).rows(),LocalSideRecords(dest).rows())
            assertEquals(LocalMemoryStore(s).snapshot(),LocalMemoryStore(dest).snapshot())
            assertEquals(LocalToolAudit(s).read(),LocalToolAudit(dest).read())
            assertTrue(RemoteCacheStore(dest).history(cid)!!.contextSettings.localModelWriteEnabled)
        }finally{dir.deleteRecursively()}
        cache.putHistory(cid,cache.history(cid)!!.copy(contextSettings=ConversationContextSettings()))
        assertFalse(session.execute("c7","create_diary","""{"date":"2026-11-25","text":"权限撤销"}""").ok)
        assertEquals(1,cache.dailyDiaries().size)
    }
}
