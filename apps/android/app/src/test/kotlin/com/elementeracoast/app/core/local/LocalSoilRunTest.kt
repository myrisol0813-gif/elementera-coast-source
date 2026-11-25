package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.remote.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class LocalSoilRunTest {
    private val cid="local-window"
    private val model="fixture-model"
    private fun fixture():MemoryLocalPersistence {
        val s=MemoryLocalPersistence()
        val cache=RemoteCacheStore(s)
        cache.putConversations(listOf(RemoteConversation(cid,"窗口","main","2026-11-25T00:00:00Z","2026-11-25T00:00:00Z")))
        cache.putHistory(cid,RemoteHistory(conversationId=cid,turns=listOf(
            RemoteTurn("turn1",user=RemoteUserBranch(variants=listOf(RemoteVariant("user1","对话"))),
                assistant=RemoteAssistantBranches(variantsByUserVariant=mapOf("0" to listOf(RemoteVariant("assistant1","回复",modelId=model,finishReason="stop")))))
        )))
        LocalSoilStore(s).patch(cid,buildJsonObject{put("auto_refresh_enabled",true)})
        return s
    }
    private val result="""{"current_text":"新纸条","afterthoughts":["余思"],"memory_candidates":[{"title":"记忆","content":"候选原文","source_refs":[{"turn_id":"turn1","role":"turn"}],"source_excerpt":"回复"}],"seed_candidates":[],"user_portrait":{"should_update":false,"proposed_body":"","reason":"","source_excerpt":""},"self_portrait":{"should_update":true,"proposed_body":"候选画像","reason":"理由","source_excerpt":"回复"}}"""
    @Test fun commitsOnceAndCandidatesDoNotBecomeFormalMemory() {
        val s=fixture();val p=LocalSoilRun.prepare(s,cid,model)!!
        LocalSoilRun.commit(s,p,result)
        val soil=LocalSoilStore(s).read()
        assertEquals("新纸条",soil.current.single()["current_text"]!!.jsonPrimitive.content)
        assertEquals("assistant1",soil.history.single()["assistant_message_id"]!!.jsonPrimitive.content)
        assertEquals(1,LocalMemoryStore(s).pockets(cid).size)
        assertTrue(LocalMemoryStore(s).snapshot().entries.isEmpty())
        assertEquals("",LocalPortraitStore(s).body("self_portrait"))
        assertEquals(1,LocalPortraitStore(s).read("self_portrait")!!.candidates.size)
        assertNull(LocalSoilRun.prepare(s,cid,model))
        assertTrue(runCatching{LocalSoilRun.commit(s,p,result)}.isFailure)
        assertEquals(soil,LocalSoilStore(s).read())
    }
    @Test fun invalidAndStaleResultsLeaveOldRowsIntact() {
        val s=fixture();val p=LocalSoilRun.prepare(s,cid,model)!!
        val before=LocalSoilStore(s).read()
        assertTrue(runCatching{LocalSoilRun.commit(s,p,result.replace("turn1","unknown"))}.isFailure)
        assertEquals(before,LocalSoilStore(s).read())
        assertTrue(LocalMemoryStore(s).pockets(cid).isEmpty())
        LocalSoilStore(s).patch(cid,buildJsonObject{put("auto_refresh_enabled",false)})
        val disabled=LocalSoilStore(s).read()
        assertTrue(runCatching{LocalSoilRun.commit(s,p,result)}.isFailure)
        assertEquals(disabled,LocalSoilStore(s).read())
        assertNull(LocalSoilRun.prepare(s,cid,model))
    }

    @Test fun organizedRecordsRoundTripThroughExistingArchive() {
        val s=fixture();LocalSoilRun.commit(s,LocalSoilRun.prepare(s,cid,model)!!,result)
        val dir=java.nio.file.Files.createTempDirectory("local-organized-archive").toFile()
        try {
            val app="com.elementeracoast.source"
            val zip=java.io.File(dir,"organized.zip")
            val manifest=ArchiveV2Local.export(s,app,zip)
            val stage=ArchiveV2Stage(dir,"verified")
            assertEquals(manifest,ArchiveV2ZipReader.stage(zip,stage))
            val dest=MemoryLocalPersistence()
            ArchiveV2Local.restore(manifest,stage,setOf("chat","thinking_soil","thinking_soil_history","memory_entries","memory_pockets","self_portrait"),app,dest,true)
            assertEquals(LocalSoilStore(s).read(),LocalSoilStore(dest).read())
            assertEquals(LocalMemoryStore(s).snapshot(),LocalMemoryStore(dest).snapshot())
            assertEquals(LocalPortraitStore(s).read("self_portrait"),LocalPortraitStore(dest).read("self_portrait"))
            assertNull(LocalSoilRun.prepare(dest,cid,model))
        } finally { dir.deleteRecursively() }
    }

    @Test fun fencedMinimalResultAndDistinctFailureReasons(){
        val s=fixture();val p=LocalSoilRun.prepare(s,cid,model)!!
        val before=LocalSoilStore(s).read()
        val error=runCatching{LocalSoilRun.commit(s,p,"invalid")}.exceptionOrNull() as LocalSoilFailure
        assertEquals("整理回包格式不符合约定",error.detail)
        assertEquals(before,LocalSoilStore(s).read())
        LocalSoilRun.commit(s,p,"```JSON\n{\"current_text\":\"纸条\",\"afterthoughts\":[]}\n```")
        assertEquals("纸条",LocalSoilStore(s).read().current.single()["current_text"]!!.jsonPrimitive.content)
        assertTrue(LocalMemoryStore(s).pockets(cid).isEmpty())
    }
    @Test fun explicitLengthRetriesOnceAndOnlyReturnsCompleteAttempt()=kotlinx.coroutines.runBlocking{
        val budgets=mutableListOf<Int>()
        val result=collectLocalSoilReply("fixture"){prompt,budget->
            budgets.add(budget)
            if(budgets.size==1)kotlinx.coroutines.flow.flowOf(LocalProviderEvent.Delta("{unfinished"),LocalProviderEvent.Done("length"))
            else {
                assertTrue(prompt.contains("上一次输出达到供应商上限"))
                kotlinx.coroutines.flow.flowOf(LocalProviderEvent.Delta("{\"current_text\":\"完整\",\"afterthoughts\":[]}"),LocalProviderEvent.Done("stop"))
            }
        }
        assertEquals(listOf(8192,16384),budgets)
        val s=fixture()
        LocalSoilRun.commit(s,LocalSoilRun.prepare(s,cid,model)!!,result)
        assertEquals("完整",LocalSoilStore(s).read().current.single()["current_text"]!!.jsonPrimitive.content)
    }
    @Test fun exhaustedAndNonLengthFailuresNeverKeepPartialOutput()=kotlinx.coroutines.runBlocking{
        val s=fixture();val before=LocalSoilStore(s).read()
        val budgets=mutableListOf<Int>()
        val fail=runCatching{collectLocalSoilReply("fixture"){_,budget->
            budgets.add(budget)
            kotlinx.coroutines.flow.flowOf(LocalProviderEvent.Delta("{unfinished"),LocalProviderEvent.Done("length"))
        }}.exceptionOrNull() as LocalSoilFailure
        assertTrue(fail.detail.contains("16384"))
        assertEquals(listOf(8192,16384),budgets)
        assertEquals(before,LocalSoilStore(s).read())
        budgets.clear()
        assertTrue(runCatching{collectLocalSoilReply("fixture"){_,budget->
            budgets.add(budget)
            kotlinx.coroutines.flow.flowOf(LocalProviderEvent.Done("content_filter"))
        }}.isFailure)
        assertEquals(listOf(8192),budgets)
    }
    @Test fun wrapperAndInvalidJsonRetryPreserveCompleteRoot()=kotlinx.coroutines.runBlocking{
        val s=fixture();val prepared=LocalSoilRun.prepare(s,cid,model)!!
        val before=LocalSoilStore(s).read()
        val budgets=mutableListOf<Int>()
        val raw=collectLocalSoilReply("fixture",3200,8192,{LocalSoilRun.validate(prepared,it)}){_,budget->
            budgets.add(budget)
            val body=if(budgets.size==1)"""{"outer":{"current_text":"不得救出内部对象","afterthoughts":[]}"""
                else """整理结果：{"current_text":"完整纸条","afterthoughts":[]}"""
            kotlinx.coroutines.flow.flowOf(LocalProviderEvent.Delta(body),LocalProviderEvent.Done("stop"))
        }
        assertEquals(listOf(3200,8192),budgets)
        assertEquals(before,LocalSoilStore(s).read())
        LocalSoilRun.commit(s,prepared,raw)
        assertEquals("完整纸条",LocalSoilStore(s).read().current.single()["current_text"]!!.jsonPrimitive.content)
    }
    @Test fun organizerUsesOnlineDigestAndAutonomousWording() {
        val p=LocalSoilRun.prepare(fixture(),cid,model)!!
        val input=Json.parseToJsonElement(p.prompt.substringAfter("整理输入结构：\n")).jsonObject
        assertEquals("reply_incremental",input["mode"]!!.jsonPrimitive.content)
        val latest=input["latest_turn"]!!.jsonObject
        assertEquals("turn1",latest["turn_id"]!!.jsonPrimitive.content)
        assertEquals("assistant1",latest["assistant"]!!.jsonObject["message_id"]!!.jsonPrimitive.content)
        assertEquals(JsonNull,input["previous_turn_excerpt"])
        assertEquals(JsonArray(emptyList()),input["missed_since_success"])
        assertTrue(input["portraits"]!!.jsonObject.containsKey("self"))
        assertTrue(p.prompt.contains("是否提出候选，由你自行判断"))
        assertFalse(p.prompt.contains("通常200至800字"))
    }
}
