package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.remote.*
import kotlinx.serialization.json.*
import java.io.File
import java.nio.file.Files
import java.util.Base64
import org.junit.Assert.*
import org.junit.Test

class LocalSideArchiveRoundtripTest {
    @Test fun originalsLibraryVaultAndAppearanceRestoreTogether(){
        val dir=Files.createTempDirectory("side-archive").toFile()
        try{
            val app="com.elementeracoast.source";val from=MemoryLocalPersistence();val cid="fixture-chat";val cache=RemoteCacheStore(from)
            cache.putConversations(listOf(RemoteConversation(cid,"Window","main","2026-11-24T00:00:00Z","2026-11-24T00:00:00Z")))
            val attachment=LocalAttachmentStore(from).upload(cid,"note.txt","text/plain","原始文字".encodeToByteArray())
            val msg=Json.encodeToJsonElement(RemoteAttachment.serializer(),attachment)
            val h=Json.decodeFromJsonElement(RemoteHistory.serializer(),buildJsonObject{
                put("version",4);put("conversation_id",cid);put("updated_at","2026-11-24T00:00:00Z")
                putJsonArray("turns"){add(buildJsonObject{
                    put("id","turn1")
                    putJsonObject("user"){put("active",0);putJsonArray("variants"){add(buildJsonObject{put("id","user1");put("content","hello");put("created_at","2026-11-24T00:00:00Z");put("attachments",JsonArray(listOf(msg)))})}}
                    putJsonObject("assistant"){putJsonObject("variantsByUserVariant"){putJsonArray("0"){add(buildJsonObject{put("id","assistant1");put("content","reply");put("created_at","2026-11-24T00:00:00Z")})}};putJsonObject("activeByUserVariant"){put("0",0)}}
                })}
            })
            LocalAttachmentStore(from).linkHistory(cid,h);cache.putHistory(cid,h)
            val input=LocalAttachmentStore(from).attachmentContext(cid,listOf(attachment.id),listOf(RemoteChatMessage("user","hello")))
            assertTrue(input.messages.last().content.contains("原始文字"))
            assertEquals(1,input.receipt.deliveredToModel)
            val side=LocalSideRecords(from)
            val audio=byteArrayOf(1,0,-1,-128,4)
            val voice=LocalSideRecords.Row("voice",buildJsonObject{
                put("id","voice1");put("conversation_id",cid);put("turn_id","turn1");put("message_id","assistant1");put("source","manual");put("model_label","fixture");put("voice_id","fixture-voice");put("text","reply");put("audio_bytes",audio.size);put("created_at",10)
            },ArchiveV2Chunks.digest(audio))
            side.putOriginal(voice,audio);side.save(listOf(voice))
            side.saveTreasure(buildJsonObject{put("kind","audio");put("conversation_id",cid);put("source_id","voice1");put("notes","保留旧声音")})
            side.saveTreasure(buildJsonObject{put("kind","file");put("conversation_id",cid);put("source_id",attachment.id);put("notes","保留原件")})
            val book=side.importBook(buildJsonObject{put("title","Fixture");put("format","txt");putJsonArray("chapters"){add(buildJsonObject{put("title","One");put("body","First paragraph.\n\nSecond paragraph.")})}})
            val bookId=book.getValue("id").jsonPrimitive.content
            side.progress(bookId,0,1)
            side.writeNote(bookId,buildJsonObject{put("kind","annotation");put("chapter_index",0);put("paragraph_index",1);put("body","原来的批注")})
            val png=Base64.getDecoder().decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X4ZkAAAAASUVORK5CYII=")
            side.saveCover(bookId,png,"image/png")
            val originalRoot=File(dir,"original").apply{mkdir()}
            val bg=File(File(originalRoot,"chat-background-local").apply{mkdir()},"background.png").apply{writeBytes(png)}
            from.put("wolf.chatBackgroundPath",bg.absolutePath);from.put("wolf.chatBackgroundName","背景");from.put("wolf.messageSurfaceAlpha","0.94")
            val targetRoot=File(dir,"target").apply{mkdir()}
            val zip=File(dir,"full.zip");val m=ArchiveV2Local.export(from,app,zip,originalRoot)
            val stage=ArchiveV2Stage(dir,"verified");assertEquals(m,ArchiveV2ZipReader.stage(zip,stage))
            val target=MemoryLocalPersistence()
            val selected=setOf("chat","attachments","voice","vault","library","appearance")
            assertEquals(1,ArchiveV2Local.restore(m,stage,selected,app,target,false,targetRoot).counts.getValue("voice").ready)
            assertTrue(LocalSideRecords(target).rows().isEmpty());assertFalse(File(targetRoot,"coast-appearance-local").exists())
            ArchiveV2Local.restore(m,stage,selected,app,target,true,targetRoot)
            val restored=LocalSideRecords(target)
            assertEquals(side.rows(),restored.rows())
            assertArrayEquals(audio,restored.bytes(requireNotNull(restored.audio("voice1"))))
            assertArrayEquals(png,restored.bytes(requireNotNull(restored.cover(bookId))))
            assertEquals(side.notes(bookId),restored.notes(bookId))
            assertEquals(1,restored.book(bookId).getValue("reader_paragraph_index").jsonPrimitive.int)
            assertEquals(2,restored.treasureRows("all","","","",0).getValue("items").jsonArray.size)
            val path=target.get("wolf.chatBackgroundPath");assertNotEquals(bg.absolutePath,path);assertArrayEquals(png,File(path).readBytes())
            assertEquals(1,ArchiveV2Local.restore(m,stage,selected,app,target,true,targetRoot).counts.getValue("appearance").existing)
            assertFalse(m.records.any{it.id.contains(bg.absolutePath)})
        }finally{dir.deleteRecursively()}
    }
}
