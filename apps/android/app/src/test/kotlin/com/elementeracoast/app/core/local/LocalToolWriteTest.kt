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
            put("action","create");put("book_id",book);put("kind","annotation");put("body","模型批注");put("chapter_index",0);put("paragraph_index",0)
        }.toString())
        call("c5","memory_write_candidate","""{"title":"候选","content":"尚未确认","destination":"memory"}""")
        assertEquals("model_partner",cache.dailyMoments().single().author)
        assertEquals("fixture-model",cache.dailyDiaries().single().modelLabel)
        assertEquals(tid,cache.dailyDiaries().single().sourceTurnId)
        call("c8","calendar_create","""{"date":"2026-11-25","title":"模型随记","kind":"note","recurrence":"yearly"}""")
        call("c9","calendar_create","""{"date":"2026-11-25","title":"模型纪念日","anniversary":{"startDay":"2026-11-25","mode":"milestone","targetDays":10,"pinned":true}}""")
        val calendar=LocalCalendarStore(s)
        assertEquals("note",calendar.snapshot().map{it.jsonObject}.single{it["title"]?.jsonPrimitive?.content=="模型随记"}["kind"]!!.jsonPrimitive.content)
        assertEquals("yearly",calendar.snapshot().map{it.jsonObject}.single{it["title"]?.jsonPrimitive?.content=="模型随记"}["recurrence"]!!.jsonPrimitive.content)
        assertEquals("2026-12-04",calendar.list(null,pinned=true).single()["day"]!!.jsonPrimitive.content)
        assertEquals(7,LocalToolAudit(s).read().size)
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
    @Test fun modelHighlightsAndEditsOnlyOwnNotes(){
        val s=MemoryLocalPersistence();val cache=RemoteCacheStore(s);val cid="fixture";val tid="turn1"
        cache.putConversations(listOf(RemoteConversation(cid,"窗口")))
        cache.putHistory(cid,RemoteHistory(conversationId=cid,contextSettings=ConversationContextSettings(localModelWriteEnabled=true),
            turns=listOf(RemoteTurn(tid,user=RemoteUserBranch(variants=listOf(RemoteVariant("u1","阅读")))))))
        val side=LocalSideRecords(s)
        val book=side.importBook(buildJsonObject{
            put("title","测试书");put("format","txt");putJsonArray("chapters"){add(buildJsonObject{put("title","第一章");put("body","原文段落")})}
        }).getValue("id").jsonPrimitive.content
        val owner=side.writeNote(book,buildJsonObject{put("kind","annotation");put("body","屋主批注");put("chapter_index",0);put("paragraph_index",0)}).getValue("id").jsonPrimitive.content
        val k=LocalKnowledgeStore(s);val session=k.toolSession(cid,tid,null,k.context(listOf(RemoteChatMessage("user","阅读")),18000,"main_chat",cid).receipt,"fixture-model")!!
        fun call(i:String,input:JsonObject)=session.execute(i,"library_write",input.toString())
        fun highlight(end:Int)=buildJsonObject{put("action","create");put("book_id",book);put("kind","highlight");put("chapter_index",0);put("paragraph_index",0);put("start_offset",0);put("end_offset",end)}
        val created=call("1",highlight(2));assertTrue(created.output,created.ok)
        val id=Json.parseToJsonElement(created.output).jsonObject.getValue("id").jsonPrimitive.content
        assertEquals("原文",side.notes(book).first{it["id"]?.jsonPrimitive?.content==id}["quote"]!!.jsonPrimitive.content)
        val bad=call("2",highlight(99));assertFalse(bad.ok);assertTrue(bad.output.contains("invalid_range"))
        val denied=call("3",buildJsonObject{put("action","delete");put("id",owner)});assertFalse(denied.ok);assertTrue(denied.output.contains("wrong_author"))
        assertTrue(call("4",buildJsonObject{put("action","edit");put("id",id);put("body","模型批注")}).ok)
        assertEquals("annotation",side.notes(book).first{it["id"]?.jsonPrimitive?.content==id}["kind"]!!.jsonPrimitive.content)
        assertTrue(call("5",buildJsonObject{put("action","delete");put("id",id)}).ok)
        assertEquals(owner,side.notes(book).single().getValue("id").jsonPrimitive.content)
    }
    @Test fun portraitProposalRemainsPendingAndHonorsBothSwitches(){
        val s=MemoryLocalPersistence();val cache=RemoteCacheStore(s);val cid="portrait";val tid="turn1"
        cache.putConversations(listOf(RemoteConversation(cid,"窗口")))
        cache.putHistory(cid,RemoteHistory(conversationId=cid,contextSettings=ConversationContextSettings(localModelWriteEnabled=true),
            turns=listOf(RemoteTurn(tid,user=RemoteUserBranch(variants=listOf(RemoteVariant("u1","记录")))))))
        val knowledge=LocalKnowledgeStore(s)
        fun session()=knowledge.toolSession(cid,tid,null,knowledge.context(listOf(RemoteChatMessage("user","记录")),18000,"main_chat",cid).receipt,"fixture-model")!!
        val args="""{"proposed_body":"完整的候选正文","reason":"值得长期保留"}"""
        assertFalse(session().execute("0","global_excerpt_propose",args).ok)
        LocalSoilStore(s).patch(cid,buildJsonObject{put("auto_refresh_enabled",true)})
        val enabled=session()
        val result=enabled.execute("1","global_excerpt_propose",args)
        assertTrue(result.output,result.ok)
        val store=LocalPortraitStore(s)
        assertEquals("",store.body("self_portrait"))
        assertEquals(1,store.read("self_portrait")!!.candidates.size)
        store.patch("self_portrait",buildJsonObject{put("write_enabled",false)})
        assertFalse(enabled.execute("2","global_excerpt_propose",args).ok)
        assertEquals(1,store.read("self_portrait")!!.candidates.size)
        val userResult=enabled.execute("3","user_portrait_propose",args)
        assertTrue(userResult.output,userResult.ok)
        assertEquals("",store.body("user_portrait"))
        val userCandidate=store.read("user_portrait")!!.candidates.single().getValue("id").jsonPrimitive.content
        store.confirm("user_portrait",userCandidate,RemoteGlobalExcerptConfirmRequest("confirm",null,"user"))
        assertEquals("完整的候选正文",store.body("user_portrait"))
        store.patch("user_portrait",buildJsonObject{put("write_enabled",false)})
        assertFalse(enabled.execute("4","user_portrait_propose",args).ok)
    }

    @Test fun bookshelfReadUsesRealIdAndAcceptsOptionalNulls(){
        val s=MemoryLocalPersistence();val cache=RemoteCacheStore(s);val cid="books";val tid="turn1"
        cache.putConversations(listOf(RemoteConversation(cid,"阅读")))
        cache.putHistory(cid,RemoteHistory(conversationId=cid,contextSettings=ConversationContextSettings(localModelToolsEnabled=true,localModelWriteEnabled=true),
            turns=listOf(RemoteTurn(tid,user=RemoteUserBranch(variants=listOf(RemoteVariant("u1","阅读")))))))
        val side=LocalSideRecords(s)
        val book=side.importBook(buildJsonObject{put("title","Fixture book");put("format","txt")
            putJsonArray("chapters"){add(buildJsonObject{put("title","Chapter");put("body","第一段原文")})}
        }).getValue("id").jsonPrimitive.content
        val k=LocalKnowledgeStore(s)
        val session=k.toolSession(cid,tid,null,k.context(listOf(RemoteChatMessage("user","阅读")),18000,"main_chat",cid).receipt,"fixture-model")!!
        fun call(id:String,name:String,args:String):JsonObject {
            val response=session.execute(id,name,args)
            assertTrue(response.output,response.ok)
            return Json.parseToJsonElement(response.output).jsonObject
        }
        val shelf=call("read1","library_books","""{"book_id":null}""")
        assertEquals(book,shelf.getValue("items").jsonArray.single().jsonObject.getValue("id").jsonPrimitive.content)
        val toc=call("read2","library_books",buildJsonObject{put("book_id",book)}.toString())
        assertEquals(0,toc.getValue("book").jsonObject.getValue("chapters").jsonArray.single().jsonObject.getValue("chapter_index").jsonPrimitive.int)
        val page=call("read3","library_read",buildJsonObject{put("book_id",book);put("chapter_index",0);put("start_paragraph",JsonNull);put("limit",JsonNull)}.toString())
        assertEquals("第一段原文",page.getValue("page").jsonObject.getValue("paragraphs").jsonArray.single().jsonObject.getValue("text").jsonPrimitive.content)
        val notes=call("read4","library_notes",buildJsonObject{put("book_id",book);put("chapter_index",JsonNull)}.toString())
        assertTrue(notes.getValue("items").jsonArray.isEmpty())
        assertFalse(session.execute("read5","library_read","""{"book_id":null,"chapter_index":0}""").ok)
    }

}
