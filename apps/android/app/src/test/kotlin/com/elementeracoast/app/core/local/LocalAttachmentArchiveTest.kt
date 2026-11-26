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

    @Test fun assistantImageRetainsOriginalVariantAndFavoriteAcrossRestore(){
        val dir=Files.createTempDirectory("assistant-image").toFile()
        try{
            val app="com.elementeracoast.source";val from=MemoryLocalPersistence();val cid="picture-chat"
            val cache=RemoteCacheStore(from)
            cache.putConversations(listOf(RemoteConversation(cid,"图片","main","2026-11-24T00:00:00Z","2026-11-24T00:00:00Z")))
            val data=byteArrayOf(137.toByte(),80,78,71,13,10,26,10)
            val history=Json.decodeFromString(RemoteHistory.serializer(),"""{"conversation_id":"picture-chat","updated_at":"2026-11-24T00:00:00Z","turns":[{"id":"turn1","user":{"variants":[{"id":"user1","content":"draw"}]},"assistant":{"activeByUserVariant":{"0":0},"variantsByUserVariant":{"0":[{"id":"assistant1","content":"picture","attachments":[{"id":"picture1","type":"image","name":"picture.png","mime":"image/png","size":8}]}]}}}]}""")
            val meta=buildJsonObject{put("id","picture1");put("conversation_id",cid);put("turn_id","turn1");put("kind","image");put("name","picture.png");put("mime","image/png");put("size",data.size);put("created_at",10L);put("updated_at",20L)}
            val original=LocalAttachmentStore.Original(meta,ArchiveV2Chunks.digest(data))
            cache.putHistory(cid,history)
            from.atomic{LocalAttachmentStore(it).publish(original,data)}
            val side=LocalSideRecords(from)
            val item=side.media("image","",0).getValue("items").jsonArray.single().jsonObject
            assertEquals("assistant",item["role"]!!.jsonPrimitive.content)
            assertEquals("assistant1",item["message_id"]!!.jsonPrimitive.content)
            val favorite=side.saveTreasure(buildJsonObject{put("kind","image");put("conversation_id",cid);put("source_id","picture1");put("notes","original drawing")})
            assertEquals("assistant",favorite["role"]!!.jsonPrimitive.content)
            assertEquals("assistant1",favorite["message_id"]!!.jsonPrimitive.content)
            val zip=File(dir,"complete.zip");val manifest=ArchiveV2Local.export(from,app,zip)
            val stage=ArchiveV2Stage(dir,"verified");ArchiveV2ZipReader.stage(zip,stage)
            val dest=MemoryLocalPersistence()
            ArchiveV2Local.restore(manifest,stage,setOf("chat","attachments","vault"),app,dest,true)
            assertArrayEquals(data,LocalAttachmentStore(dest).bytes(original))
            val restored=LocalSideRecords(dest).treasureRows("image","",cid,"",0).getValue("items").jsonArray.single().jsonObject
            assertEquals("assistant",restored["role"]!!.jsonPrimitive.content)
            assertEquals("assistant1",restored["message_id"]!!.jsonPrimitive.content)
        }finally{dir.deleteRecursively()}
    }

    @Test fun generatedOriginalAndProvenanceSurviveLocalHistoryAndZip(){
        val dir=Files.createTempDirectory("generated-image").toFile()
        try{
            val app="com.elementeracoast.source";val store=MemoryLocalPersistence();val cid="image-chat"
            val cache=RemoteCacheStore(store)
            cache.putConversations(listOf(RemoteConversation(cid,"图片","main","2026-11-26T00:00:00Z","2026-11-26T00:00:00Z")))
            val history=Json.decodeFromString(RemoteHistory.serializer(),"""{"conversation_id":"image-chat","updated_at":"2026-11-26T00:00:00Z","turns":[{"id":"turn1","user":{"variants":[{"id":"user1","content":"draw"}]}}]}""")
            cache.putHistory(cid,history)
            val png=byteArrayOf(137.toByte(),80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,6,0,0,0)
            val generated=LocalImageProvider.Generated(png,"image/png","openrouter","fixture/image:free",null,0.0,"draw a wolf")
            val saved=saveGeneratedImageOriginal(store,cid,"turn1","assistant1",generated,true)
            assertEquals("prepared",saved.readback.receipt["status"]!!.jsonPrimitive.content)
            assertEquals("assistant1",saved.attachment.imageGeneration!!.messageId)
            assertEquals(0.0,saved.attachment.imageGeneration!!.costUsd!!,0.0)
            val original=LocalAttachmentStore(store).entries().single()
            assertEquals("turn1",original.metadata["turn_id"]!!.jsonPrimitive.content)
            assertArrayEquals(png,LocalAttachmentStore(store).bytes(original))
            val next=history.copy(turns=listOf(history.turns.single().copy(assistant=RemoteAssistantBranches(mapOf("0" to 0),mapOf("0" to listOf(RemoteVariant(id="assistant1",content="",attachments=listOf(saved.attachment))))))))
            cache.putHistory(cid,next)
            val zip=File(dir,"complete.zip");val manifest=ArchiveV2Local.export(store,app,zip)
            val stage=ArchiveV2Stage(dir,"verified");ArchiveV2ZipReader.stage(zip,stage)
            val dest=MemoryLocalPersistence()
            ArchiveV2Local.restore(manifest,stage,setOf("chat","attachments"),app,dest,true)
            assertEquals(saved.attachment,RemoteCacheStore(dest).history(cid)!!.turns.single().assistant.variantsByUserVariant.getValue("0").single().attachments.single())
            assertArrayEquals(png,LocalAttachmentStore(dest).bytes(original))
            assertTrue(runCatching{saveGeneratedImageOriginal(store,cid,"missing-turn","assistant2",generated,true)}.isFailure)
            assertEquals(1,LocalAttachmentStore(store).entries().size)
        }finally{dir.deleteRecursively()}
    }
}
