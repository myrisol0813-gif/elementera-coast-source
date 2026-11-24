package com.elementeracoast.app.core.local

import java.io.File
import java.io.ByteArrayInputStream
import java.nio.file.Files
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class ArchiveV2CloudToLocalTest {
    @Test fun cloudCalendarUsesLocalAtomicRestoreAndRejectsUnsupportedProvenance(){
        val root=Files.createTempDirectory("coast-cloud-local").toFile()
        try{
            fun fixture(provenance:Boolean):Pair<ArchiveV2Manifest,ArchiveV2Stage>{
                val dir=File(root,if(provenance)"bad" else "good").apply { mkdir() }
                val raw=buildJsonObject{
                    put("kind","calendar");putJsonObject("data"){
                        put("id","calendar-fixture");put("day","2026-11-24");put("kind","event");put("title","纪念");put("body","原文");put("recurrence","none");put("author","owner");put("source","manual")
                        for(k in listOf("conversation_id","source_turn_id","tool_call_id","anniversary_start_day","anniversary_mode","anniversary_target_days"))put(k,JsonNull)
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
            assertTrue(runCatching{ArchiveV2Local.restore(bad,badStage,modules,app,target,true)}.isFailure)
            assertEquals(1,LocalCalendarStore(target).snapshot().size)
        }finally{root.deleteRecursively()}
    }
}
