package com.elementeracoast.app.core.local

import java.io.File
import java.io.ByteArrayInputStream
import java.nio.file.Files
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class ArchiveV2CloudToLocalTest {
    @Test fun cloudModelProfileTimestampSurvivesLocalZipRoundtrip() {
        val root=Files.createTempDirectory("profile-v2").toFile()
        try {
            val raw=buildJsonObject {
                put("kind","model_profile");putJsonObject("data"){
                    put("id","owner");put("assistant_avatar_dataurl",JsonNull)
                    put("current_chat_model","fixture-model");put("current_image_model",JsonNull)
                    put("model_box_json","""{"chat":["fixture-model"],"free":[],"image":[]}""")
                    put("updated_at",123456789L)
                }
            }.toString().encodeToByteArray()
            val chunks=listOf(ArchiveV2Chunks.digest(raw))
            val d=ArchiveV2Object(raw.size.toLong(),chunks,ArchiveV2Chunks.fingerprint(raw.size.toLong(),chunks))
            val m=ArchiveV2Manifest("elementera-coast-archive",2,"backend","com.elementeracoast.source","2026-11-24T00:00:00Z",
                ArchiveV2Manifests.modules.map{ArchiveV2Coverage(it,if(it=="model_profile")"partial" else "unavailable",if(it=="model_profile")1 else 0)},
                listOf(ArchiveV2Record("model_profile","owner",d.objectSha256,emptyList(),emptyList())),listOf(d))
            val file=File(root,"cloud.zip")
            ArchiveV2ZipWriter(file.outputStream()).use{it.objectEntry(d,ByteArrayInputStream(raw));it.finish(m)}
            val stage=ArchiveV2Stage(root,"verified")
            assertEquals(m,ArchiveV2ZipReader.stage(file,stage))
            val app="com.elementeracoast.source";val modules=setOf("model_profile");val target=MemoryLocalPersistence()
            ArchiveV2Local.restore(m,stage,modules,app,target,true)
            val profile=com.elementeracoast.app.core.remote.RemoteCacheStore(target).profile()!!
            assertEquals("fixture-model",profile.currentChatModel);assertEquals(123456789L,profile.updatedAt!!)
            val local=File(root,"local.zip");val lm=ArchiveV2Local.export(target,app,local);val ls=ArchiveV2Stage(root,"local")
            assertEquals(lm,ArchiveV2ZipReader.stage(local,ls))
            val again=MemoryLocalPersistence()
            ArchiveV2Local.restore(lm,ls,modules,app,again,true)
            assertEquals(profile,com.elementeracoast.app.core.remote.RemoteCacheStore(again).profile())
        } finally {root.deleteRecursively()}
    }
    @Test fun cloudCalendarRetainsStandaloneProvenanceAcrossLocalArchive(){
        val root=Files.createTempDirectory("coast-cloud-local").toFile()
        try{
            fun fixture(provenance:Boolean):Pair<ArchiveV2Manifest,ArchiveV2Stage>{
                val dir=File(root,if(provenance)"bad" else "good").apply { mkdir() }
                val raw=buildJsonObject{
                    put("kind","calendar");putJsonObject("data"){
                        put("id","calendar-fixture");put("day","2026-11-24");put("kind","event");put("title","纪念");put("body","原文");put("recurrence","none");put("author","owner");put("source","manual")
                        for(k in listOf("conversation_id","source_turn_id","anniversary_start_day","anniversary_mode","anniversary_target_days"))put(k,JsonNull)
                        put("tool_call_id",if(provenance)JsonPrimitive("tool-fixture") else JsonNull)
                        put("model_label",if(provenance)JsonPrimitive("model") else JsonNull);put("created_at",123L);put("updated_at",456L);put("anniversary_pinned",0)
                    }
                }.toString().encodeToByteArray()
                val chunks=listOf(ArchiveV2Chunks.digest(raw))
                val d=ArchiveV2Object(raw.size.toLong(),chunks,ArchiveV2Chunks.fingerprint(raw.size.toLong(),chunks))
                val r=ArchiveV2Record("calendar","calendar-fixture",d.objectSha256,emptyList(),emptyList())
                val m=ArchiveV2Manifest("elementera-coast-archive",2,"backend","com.elementeracoast.source","2026-11-24T00:00:00Z",ArchiveV2Manifests.modules.map{ArchiveV2Coverage(it,if(it=="calendar")"partial" else "unavailable",if(it=="calendar")1 else 0)},listOf(r),listOf(d))
                val file=File(dir,"archive.zip")
                ArchiveV2ZipWriter(file.outputStream()).use { it.objectEntry(d,ByteArrayInputStream(raw));it.finish(m) }
                val stage=ArchiveV2Stage(dir,"verified")
                assertEquals(m,ArchiveV2ZipReader.stage(file,stage))
                return m to stage
            }
            val (m,stage)=fixture(false);val target=MemoryLocalPersistence();val app="com.elementeracoast.source";val modules=setOf("calendar")
            assertEquals(1,ArchiveV2Local.restore(m,stage,modules,app,target,false).counts.getValue("calendar").ready)
            assertEquals(0,LocalCalendarStore(target).snapshot().size)
            ArchiveV2Local.restore(m,stage,modules,app,target,true)
            val row=LocalCalendarStore(target).snapshot()[0].jsonObject
            assertEquals("原文",row.getValue("body").jsonPrimitive.content);assertEquals(123L,row.getValue("created_at").jsonPrimitive.long)
            val (bad,badStage)=fixture(true)
            assertEquals(1,ArchiveV2Local.restore(bad,badStage,modules,app,target,true).counts.getValue("calendar").conflicts)
            assertEquals(row,LocalCalendarStore(target).snapshot()[0])
            val clean=MemoryLocalPersistence()
            ArchiveV2Local.restore(bad,badStage,modules,app,clean,true)
            val restored=LocalCalendarStore(clean).snapshot()[0].jsonObject
            assertEquals("model",restored.getValue("model_label").jsonPrimitive.content)
            assertEquals("tool-fixture",restored.getValue("tool_call_id").jsonPrimitive.content)
            val edited=LocalCalendarStore(clean).save("calendar-fixture",buildJsonObject{put("title","Edited")})
            for(key in listOf("model_label","tool_call_id","author","source"))assertEquals(restored[key],edited[key])
            val exported=File(root,"local-roundtrip.zip")
            val localManifest=ArchiveV2Local.export(clean,app,exported)
            val localStage=ArchiveV2Stage(root,"roundtrip")
            assertEquals(localManifest,ArchiveV2ZipReader.stage(exported,localStage))
            val roundtrip=MemoryLocalPersistence()
            ArchiveV2Local.restore(localManifest,localStage,modules,app,roundtrip,true)
            assertEquals(LocalCalendarStore(clean).snapshot(),LocalCalendarStore(roundtrip).snapshot())
        }finally{root.deleteRecursively()}
    }

    @Test fun differentCloudHistoryAndStorageClocksSurviveLocalZipRoundtrip(){
        val root=Files.createTempDirectory("history-clocks").toFile()
        try{
            val raw=buildJsonObject{
                put("kind","chat");putJsonObject("data"){
                    putJsonObject("conversation"){
                        put("id","clock-fixture");put("title","Clock fixture");put("room_type","main")
                        put("created_at",100L);put("updated_at",456L);put("deleted_at",JsonNull);put("title_manual",0)
                        put("title_generated_at",JsonNull);put("title_model_id",JsonNull);put("source","coast");put("source_window_id",JsonNull)
                    }
                    put("history_json","""{"version":4,"updated_at":"1970-01-01T00:00:00.123Z","turns":[]}""")
                    put("history_updated_at",456L)
                }
            }.toString().encodeToByteArray()
            val chunks=listOf(ArchiveV2Chunks.digest(raw))
            val d=ArchiveV2Object(raw.size.toLong(),chunks,ArchiveV2Chunks.fingerprint(raw.size.toLong(),chunks))
            val m=ArchiveV2Manifest("elementera-coast-archive",2,"backend","com.elementeracoast.source","2026-11-24T00:00:00Z",
                ArchiveV2Manifests.modules.map{ArchiveV2Coverage(it,if(it=="chat")"partial" else "unavailable",if(it=="chat")1 else 0)},
                listOf(ArchiveV2Record("chat","clock-fixture",d.objectSha256,emptyList(),emptyList())),listOf(d))
            val file=File(root,"cloud.zip")
            ArchiveV2ZipWriter(file.outputStream()).use{it.objectEntry(d,ByteArrayInputStream(raw));it.finish(m)}
            val stage=ArchiveV2Stage(root,"verified");assertEquals(m,ArchiveV2ZipReader.stage(file,stage))
            val app="com.elementeracoast.source";val modules=setOf("chat");val target=MemoryLocalPersistence()
            assertEquals(1,ArchiveV2Local.restore(m,stage,modules,app,target,false).counts.getValue("chat").ready)
            val cache=com.elementeracoast.app.core.remote.RemoteCacheStore(target)
            assertNull(cache.history("clock-fixture"))
            ArchiveV2Local.restore(m,stage,modules,app,target,true)
            val history=cache.history("clock-fixture")!!
            assertEquals("1970-01-01T00:00:00.123Z",history.updatedAt);assertEquals(456L,history.archiveStorageUpdatedAt!!)
            val local=File(root,"local.zip");val lm=ArchiveV2Local.export(target,app,local);val ls=ArchiveV2Stage(root,"local")
            assertEquals(lm,ArchiveV2ZipReader.stage(local,ls))
            val again=MemoryLocalPersistence();ArchiveV2Local.restore(lm,ls,modules,app,again,true)
            assertEquals(history,com.elementeracoast.app.core.remote.RemoteCacheStore(again).history("clock-fixture"))
            cache.putHistory("clock-fixture",history.copy(updatedAt="1970-01-01T00:00:01Z"))
            assertNull(cache.history("clock-fixture")!!.archiveStorageUpdatedAt)
        }finally{root.deleteRecursively()}
    }
}
