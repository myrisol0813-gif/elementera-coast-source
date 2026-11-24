package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.remote.*
import kotlinx.serialization.json.*
import java.io.File
import java.nio.file.Files
import org.junit.Assert.*
import org.junit.Test

class LocalPortraitArchiveTest {
    @Test fun portraitHistoryRemainsWholeAndOnlyConfirmedBodyReachesContext(){
        val dir=Files.createTempDirectory("portrait-v2").toFile()
        try{
            val app="com.elementeracoast.source";val from=MemoryLocalPersistence()
            val source=LocalPortraitStore(from)
            val module="self_portrait"
            val root=buildJsonObject{put("id","global");put("body","正式原文");put("revision",2);put("write_enabled",0);put("created_at",100L);put("updated_at",200L)}
            val candidate=buildJsonObject{
                put("id","candidate1");put("proposed_body","候选正文");put("change_kind","rewrite");put("reason","原始理由")
                put("source_conversation_id","old-window");put("source_message_id","old-message");put("source_model","fixture");put("created_at",300L)
            }
            val revision=buildJsonObject{
                put("id","revision1");put("revision",2);put("before_body","最早正文");put("after_body","正式原文")
                put("source_conversation_id","old-window");put("source_message_id","old-message");put("model_reason","最早理由")
                put("confirmation_mode","confirm");put("operator","user");put("created_at",200L)
            }
            val document=LocalPortraitStore.Document(root,listOf(candidate),listOf(revision))
            source.write(module,document)
            source.patch("user_portrait",buildJsonObject{put("write_enabled",false)})
            val zip=File(dir,"portrait.zip");val manifest=ArchiveV2Local.export(from,app,zip)
            val stage=ArchiveV2Stage(dir,"verified");assertEquals(manifest,ArchiveV2ZipReader.stage(zip,stage))
            val target=MemoryLocalPersistence();val selected=LocalPortraitStore.modules
            val preview=ArchiveV2Local.restore(manifest,stage,selected,app,target,false)
            assertEquals(3,preview.counts.getValue(module).ready)
            assertNull(LocalPortraitStore(target).read(module))
            ArchiveV2Local.restore(manifest.copy(workspace="backend"),stage,selected,app,target,true)
            val local=LocalPortraitStore(target)
            assertEquals(document,local.read(module))
            assertEquals(source.read("user_portrait"),local.read("user_portrait"))
            assertEquals(3,ArchiveV2Local.restore(manifest,stage,selected,app,target,true).counts.getValue(module).existing)
            val context=LocalKnowledgeStore(target).context(listOf(RemoteChatMessage("user","hello")),1800,"main_chat")
            assertEquals("正式原文",context.receipt.globalExcerpt.content)
            assertTrue(context.receipt.globalExcerpt.delivered)
            assertFalse(context.messages.any{it.content.contains("候选正文")})
            local.confirm(module,"candidate1",RemoteGlobalExcerptConfirmRequest("confirm","修改后确认","user"))
            val updated=local.read(module)!!
            assertEquals(3,updated.root.getValue("revision").jsonPrimitive.int)
            assertEquals("修改后确认",local.body(module));assertTrue(updated.candidates.isEmpty())
            assertEquals("old-message",updated.revisions.last().getValue("source_message_id").jsonPrimitive.content)
            assertTrue(runCatching{ArchiveV2Local.restore(manifest,stage,selected,app,target,true)}.isFailure)
            assertTrue(runCatching{local.patch(module,buildJsonObject{put("action","clear");put("expected_revision",2)})}.isFailure)
            local.patch(module,buildJsonObject{put("action","clear");put("expected_revision",3)})
            assertEquals("",local.body(module));assertEquals(3,local.read(module)!!.revisions.size)
            assertTrue(runCatching{LocalPortraitStore.validate(document.copy(revisions=emptyList()))}.isFailure)
            val reexport=File(dir,"updated.zip");val next=ArchiveV2Local.export(target,app,reexport)
            assertEquals(4,next.records.count{it.module==module})
        }finally{dir.deleteRecursively()}
    }
}
