package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.remote.*
import kotlinx.serialization.json.*
import java.io.File
import java.nio.file.Files
import org.junit.Assert.*
import org.junit.Test

class LocalAttachmentArchiveTest {
    @Test fun attachmentOriginalSurvivesZipAndIsNeverSilentlyOmitted(){
        val dir=Files.createTempDirectory("attachment-v2").toFile()
        try{
            val app="com.elementeracoast.source";val from=MemoryLocalPersistence();val cid="fixture-chat"
            val cache=RemoteCacheStore(from)
            cache.putConversations(listOf(RemoteConversation(cid,"窗口","main","2026-11-24T00:00:00Z","2026-11-24T00:00:00Z")))
            val data=byteArrayOf(0,1,2,-1,-128,10,13)
            val history=Json.decodeFromString(RemoteHistory.serializer(),"""{"conversation_id":"fixture-chat","updated_at":"2026-11-24T00:00:00Z","turns":[{"id":"turn1","user":{"variants":[{"id":"user1","content":"hello","attachments":[{"id":"attachment1","type":"file","name":"original.bin","mime":"application/octet-stream","size":7}]}]}}]}""")
            cache.putHistory(cid,history)
            val meta=buildJsonObject{put("id","attachment1");put("conversation_id",cid);put("turn_id","turn1");put("kind","file");put("name","original.bin");put("mime","application/octet-stream");put("size",data.size);put("created_at",10L);put("updated_at",20L)}
            val store=LocalAttachmentStore(from);val original=LocalAttachmentStore.Original(meta,ArchiveV2Chunks.digest(data))
            assertTrue(runCatching{ArchiveV2Local.export(from,app,File(dir,"incomplete.zip"))}.isFailure)
            from.atomic{LocalAttachmentStore(it).publish(original,data)}
            assertArrayEquals(data,store.bytes(original))
            val zip=File(dir,"complete.zip");val manifest=ArchiveV2Local.export(from,app,zip)
            val stage=ArchiveV2Stage(dir,"verified");assertEquals(manifest,ArchiveV2ZipReader.stage(zip,stage))
            val dest=MemoryLocalPersistence()
            assertTrue(runCatching{ArchiveV2Local.restore(manifest,stage,setOf("chat"),app,dest,true)}.isFailure)
            assertTrue(RemoteCacheStore(dest).conversations().isEmpty())
            val modules=setOf("chat","attachments")
            assertEquals(1,ArchiveV2Local.restore(manifest,stage,modules,app,dest,false).counts.getValue("attachments").ready)
            assertTrue(LocalAttachmentStore(dest).entries().isEmpty())
            ArchiveV2Local.restore(manifest,stage,modules,app,dest,true)
            assertEquals(history,RemoteCacheStore(dest).history(cid))
            assertArrayEquals(data,LocalAttachmentStore(dest).bytes(original))
            assertEquals(1,ArchiveV2Local.restore(manifest,stage,modules,app,dest,true).counts.getValue("attachments").existing)
            dest.putBinary("local.attachment.original.v2.attachment1",byteArrayOf(9))
            assertTrue(runCatching{ArchiveV2Local.export(dest,app,File(dir,"corrupt.zip"))}.isFailure)
        }finally{dir.deleteRecursively()}
    }
}
