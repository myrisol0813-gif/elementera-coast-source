package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.remote.*
import kotlinx.serialization.json.*
import java.io.File
import java.nio.file.Files
import org.junit.Assert.*
import org.junit.Test

class LocalMemoryArchiveTest {
    @Test fun manualMemorySurvivesArchiveAndConfirmedCandidatesOnlyEnterRecall(){
        val root=Files.createTempDirectory("memory-v2").toFile()
        try{
            val app="com.elementeracoast.source";val from=MemoryLocalPersistence()
            val store=LocalMemoryStore(from)
            val saved=store.save(null,RemoteMemoryEntryWriteRequest("memory","海浪","原始生命核",content="原始内容",status="active",tag="历史锚点",sourceTime="2025-08-13T10:20:30Z"))
            val old=store.snapshot().entries.single()
            store.save(saved.id,RemoteMemoryEntryWriteRequest("memory","海浪","原始生命核",content="原始内容",status="active",tag="历史锚点",sourceTime="2025-08-13"))
            assertEquals(old["source_time"],store.snapshot().entries.single()["source_time"])
            val seed=store.save(null,RemoteMemoryEntryWriteRequest("seed","海浪","未确认构想",status="dormant",tag="海岸世界观"))
            assertEquals(setOf(saved.id,seed.id),store.recall("今天看海浪","").map{it.id}.toSet())
            assertTrue(store.recall("不相关词汇","").isEmpty())
            assertTrue(store.recall("未确认构想","",explicit=true).any{it.id==seed.id})
            val cid="fixture-chat"
            val cache=RemoteCacheStore(from);cache.putConversations(listOf(RemoteConversation(cid,"窗口","main","2026-11-24T00:00:00Z","2026-11-24T00:00:00Z")))
            cache.putHistory(cid,RemoteHistory(conversationId=cid,updatedAt="2026-11-24T00:00:00Z"))
            val common=old.filterKeys{it !in setOf("entry_type","scope","promoted_from_id","memory_level","user_confirmed")}
            val candidate=JsonObject(common+buildJsonObject{
                put("id","candidate1");put("conversation_id",cid);put("source_type","soil");put("source_ref_json","{}")
                put("title","海鸥");put("life_core","候选生命核");put("content","原始候选正文");put("status","pending")
                put("source_text","原始候选正文");put("suggested_title","海鸥");put("suggested_life_core","候选生命核");put("suggested_usage_hint","");put("suggested_avoid_hint","")
                put("candidate_id","candidate1");put("source_refs_json","[]");put("source_excerpt","原始引用");put("fingerprint","fixture-fingerprint");put("resolved_entry_id",JsonNull)
            })
            store.write(store.snapshot().copy(pockets=listOf(candidate)))
            assertTrue(store.recall("海鸥",cid).isEmpty())
            val zip=File(root,"memory.zip");val manifest=ArchiveV2Local.export(from,app,zip)
            val stage=ArchiveV2Stage(root,"stage");assertEquals(manifest,ArchiveV2ZipReader.stage(zip,stage))
            val target=MemoryLocalPersistence()
            assertTrue(runCatching{ArchiveV2Local.restore(manifest,stage,setOf("memory_pockets"),app,target,true)}.isFailure)
            assertTrue(LocalMemoryStore(target).snapshot().pockets.isEmpty())
            val selected=setOf("chat","memory_entries","memory_pockets")
            val preview=ArchiveV2Local.restore(manifest,stage,selected,app,target,false)
            assertEquals(2,preview.counts.getValue("memory_entries").ready)
            assertTrue(LocalMemoryStore(target).snapshot().entries.isEmpty())
            ArchiveV2Local.restore(manifest,stage,selected,app,target,true)
            val restored=LocalMemoryStore(target)
            assertEquals(store.snapshot(),restored.snapshot())
            val resolved=restored.resolve("candidate1",RemoteMemoryPocketResolveRequest("memory",tag="关系"))
            assertEquals("confirmed",resolved.pocket.status)
            assertEquals(resolved.entry!!.id,restored.recall("海鸥",cid).single().id)
            assertTrue(runCatching{restored.resolve("candidate1",RemoteMemoryPocketResolveRequest("discard"))}.isFailure)
            assertEquals(1,ArchiveV2Local.restore(manifest,stage,selected,app,target,true).counts.getValue("memory_pockets").conflicts)
            assertEquals("confirmed",restored.snapshot().pockets.single()["status"]!!.jsonPrimitive.content)
            restored.delete(seed.id)
            assertTrue(restored.entries("seed").isEmpty())
        }finally{root.deleteRecursively()}
    }
}
