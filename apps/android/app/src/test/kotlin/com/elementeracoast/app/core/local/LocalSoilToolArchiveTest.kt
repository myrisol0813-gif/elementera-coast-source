package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.remote.*
import kotlinx.serialization.json.*
import java.io.File
import java.nio.file.Files
import org.junit.Assert.*
import org.junit.Test

class LocalSoilToolArchiveTest {
    @Test fun soilHistoryAuditAndBinaryIsolation(){
        val dir=Files.createTempDirectory("soil-tools").toFile()
        try{
            val app="com.elementeracoast.source";val from=MemoryLocalPersistence()
            val cid="fixture-chat";val cache=RemoteCacheStore(from)
            cache.putConversations(listOf(RemoteConversation(cid,"窗口","main","2026-11-24T00:00:00Z","2026-11-24T00:00:00Z")))
            val history=Json.decodeFromString(RemoteHistory.serializer(),"""{"conversation_id":"fixture-chat","updated_at":"2026-11-24T00:00:00Z","turns":[{"id":"turn1","user":{"variants":[{"id":"user1","content":"hello"}]},"assistant":{"variantsByUserVariant":{"0":[{"id":"assistant1","content":"reply"}]}}}]}""")
            cache.putHistory(cid,history)
            val soil=LocalSoilStore(from)
            soil.patch(cid,buildJsonObject{put("current_text","原始思维壤");putJsonArray("afterthoughts"){add("一张纸条")};put("manual_locked",true);put("auto_refresh_enabled",true)})
            val past=buildJsonObject{put("conversation_id",cid);put("turn_id","turn1");put("assistant_message_id","assistant1");put("current_text","历史原文");put("afterthoughts_json","[]");put("revision",1);put("model_label","fixture");put("display_author","Historical");put("created_at",100L)}
            soil.write(soil.read().copy(history=listOf(past)))
            val audit=buildJsonObject{put("id","audit1");put("conversation_id",cid);put("tool_key","memory.search");put("actor","api_model_partner");put("room_scope","main_chat");put("status","success");put("created_at",10L);put("finished_at",20L)}
            LocalToolAudit(from).write(listOf(audit))
            assertTrue(runCatching{LocalToolAudit.validateRow(JsonObject(audit+("input_summary" to JsonPrimitive("secret"))))}.isFailure)
            assertTrue(runCatching{LocalToolAudit.validateRow(JsonObject(audit+("tool_key" to JsonPrimitive("mailbox.reply"))))}.isFailure)
            val zip=File(dir,"soil.zip");val manifest=ArchiveV2Local.export(from,app,zip);val stage=ArchiveV2Stage(dir,"verified");assertEquals(manifest,ArchiveV2ZipReader.stage(zip,stage))
            val dest=MemoryLocalPersistence();val modules=setOf("chat","thinking_soil","thinking_soil_history","tools")
            assertTrue(runCatching{ArchiveV2Local.restore(manifest,stage,setOf("thinking_soil_history"),app,dest,true)}.isFailure)
            ArchiveV2Local.restore(manifest,stage,modules,app,dest,true)
            assertEquals(soil.read(),LocalSoilStore(dest).read());assertEquals(listOf(audit),LocalToolAudit(dest).read())
            assertTrue(LocalKnowledgeStore(dest).context(listOf(RemoteChatMessage("user","hello")),1800,"main_chat",cid).receipt.thinkingSoil.delivered)
            LocalSoilStore(dest).patch(cid,buildJsonObject{put("auto_refresh_enabled",false)})
            assertFalse(LocalKnowledgeStore(dest).context(listOf(RemoteChatMessage("user","hello")),1800,"main_chat",cid).receipt.thinkingSoil.delivered)
            assertEquals(1,ArchiveV2Local.restore(manifest,stage,modules,app,dest,true).counts.getValue("tools").existing)
            val bytes=byteArrayOf(0,1,2,-1,-128,10,13)
            dest.putBinary("fixture-binary",bytes)
            assertArrayEquals(bytes,dest.getBinary("fixture-binary"))
            assertTrue(runCatching{dest.atomic{it.putBinary("fixture-binary",byteArrayOf(9));error("abort")}}.isFailure)
            assertArrayEquals(bytes,dest.getBinary("fixture-binary"))
        }finally{dir.deleteRecursively()}
    }
}
