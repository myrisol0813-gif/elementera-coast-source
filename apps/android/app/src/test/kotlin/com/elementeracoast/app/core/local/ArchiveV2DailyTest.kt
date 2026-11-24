package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.remote.RemoteCacheStore
import java.io.ByteArrayInputStream
import java.io.File
import java.nio.file.Files
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class ArchiveV2DailyTest {
    @Test fun dailyCloudZipRetainsCommentsLikesProfileAndHistory(){
        val app="com.elementeracoast.source";val owner="owner";val partner="model_partner"
        val root=Files.createTempDirectory("daily-v2").toFile()
        try{
            val objects=mutableListOf<ArchiveV2Object>();val records=mutableListOf<ArchiveV2Record>();val bytes=mutableListOf<ByteArray>()
            fun add(kind:String,data:JsonObject,deps:List<String> = emptyList()):ArchiveV2Record{
                val keys=if(kind=="daily_likes")listOf("moment_id","actor")else listOf("id")
                val id=kind+":"+ArchiveV2Chunks.digest(JsonArray(keys.map{data.getValue(it)}).toString().encodeToByteArray())
                val raw=buildJsonObject{put("kind",kind);put("data",data)}.toString().encodeToByteArray()
                val chunks=listOf(ArchiveV2Chunks.digest(raw))
                val descriptor=ArchiveV2Object(raw.size.toLong(),chunks,ArchiveV2Chunks.fingerprint(raw.size.toLong(),chunks))
                return ArchiveV2Record("daily",id,descriptor.objectSha256,emptyList(),deps).also{records.add(it);objects.add(descriptor);bytes.add(raw)}
            }
            fun common(id:String)=buildJsonObject{
                put("id",id);put("date","2026-11-24");put("author",partner);put("source","manual");put("text","Original")
                for(k in listOf("conversation_id","source_turn_id","tool_call_id","model_nickname"))put(k,JsonNull)
                put("actor",partner);put("surface","official_mcp");put("model_label","fixture-model");put("symbol","~");put("display_author","Historical name")
                put("created_at",123L);put("updated_at",456L)
            }
            val moment=add("daily_moments",JsonObject(common("moment1")+mapOf("status" to JsonPrimitive("published"),"reason" to JsonPrimitive("source reason"),"published_at" to JsonPrimitive(123L))))
            val childDep=listOf("daily/"+moment.id)
            add("daily_comments",buildJsonObject{
                put("id","comment1");put("moment_id","moment1");put("author",owner);put("text","Original comment");put("created_at",789L);put("model_id","fixture-model");put("usage_json","""{"total_tokens":12}""")
            },childDep)
            for(actor in listOf(owner,partner))add("daily_likes",buildJsonObject{put("moment_id","moment1");put("actor",actor);put("created_at",987L)},childDep)
            add("daily_diaries",JsonObject(common("diary1")+mapOf("weather" to JsonPrimitive("snow"),"mood" to JsonPrimitive("warm"),"tags_json" to JsonPrimitive("""["home"]"""))))
            add("daily_profile",buildJsonObject{
                put("id","owner");put("owner_avatar_dataurl","");put("model_partner_avatar_dataurl","");put("moment_cover_dataurl","");put("model_partner_display_name","Original name");put("updated_at",555L)
            })
            val manifest=ArchiveV2Manifest("elementera-coast-archive",2,"backend",app,"2026-11-24T00:00:00Z",ArchiveV2Manifests.modules.map{ArchiveV2Coverage(it,if(it=="daily")"partial" else "unavailable",if(it=="daily")records.size else 0)},records,objects)
            val file=File(root,"cloud.zip")
            ArchiveV2ZipWriter(file.outputStream()).use{writer->objects.forEachIndexed{i,d->writer.objectEntry(d,ByteArrayInputStream(bytes[i]))};writer.finish(manifest)}
            val stage=ArchiveV2Stage(root,"verified");assertEquals(manifest,ArchiveV2ZipReader.stage(file,stage))
            val local=MemoryLocalPersistence();val modules=setOf("daily")
            val malformed=manifest.copy(records=records.map{if(it.id.startsWith("daily_comments:"))it.copy(dependencies=emptyList())else it})
            assertTrue(runCatching{ArchiveV2Local.restore(malformed,stage,modules,app,local,true)}.isFailure)
            assertTrue(RemoteCacheStore(local).dailyMoments().isEmpty())
            ArchiveV2Local.restore(manifest,stage,modules,app,local,true)
            val cache=RemoteCacheStore(local);val saved=cache.dailyMoments().single()
            assertEquals(partner,saved.author);assertEquals("Historical name",saved.displayAuthor);assertEquals("source reason",saved.reason)
            assertEquals(2,saved.likeCount);assertTrue(saved.liked);assertEquals(setOf(owner,partner),saved.likes!!.map{it.actor}.toSet())
            assertEquals(12L,saved.comments.single().usage!!.totalTokens!!)
            assertEquals("1970-01-01T00:00:00.987Z",saved.likes!!.first().createdAt)
            assertEquals(listOf("home"),cache.dailyDiaries().single().tags)
            assertEquals("1970-01-01T00:00:00.555Z",cache.dailyProfile()!!.updatedAt)
            val exported=File(root,"local.zip");val lm=ArchiveV2Local.export(local,app,exported);val ls=ArchiveV2Stage(root,"local")
            assertEquals(lm,ArchiveV2ZipReader.stage(exported,ls))
            val destination=MemoryLocalPersistence();ArchiveV2Local.restore(lm,ls,modules,app,destination,true)
            assertEquals(cache.dailyMoments(),RemoteCacheStore(destination).dailyMoments())
            assertEquals(cache.dailyDiaries(),RemoteCacheStore(destination).dailyDiaries())
            assertEquals(cache.dailyProfile(),RemoteCacheStore(destination).dailyProfile())
            assertEquals(0,ArchiveV2Local.restore(lm,ls,modules,app,destination,true).counts.getValue("moments").conflicts)
        }finally{root.deleteRecursively()}
    }
}
