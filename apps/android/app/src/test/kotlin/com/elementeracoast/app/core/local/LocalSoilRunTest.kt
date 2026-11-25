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
}
