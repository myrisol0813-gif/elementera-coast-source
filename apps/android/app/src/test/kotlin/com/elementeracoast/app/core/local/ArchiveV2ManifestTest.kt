package com.elementeracoast.app.core.local

import org.junit.Assert.*
import org.junit.Test

class ArchiveV2ManifestTest {
    @Test fun checksCoverageAndReferences() {
        val data=byteArrayOf(1,2,3)
        val chunks=listOf(ArchiveV2Chunks.digest(data))
        val o=ArchiveV2Object(3,chunks,ArchiveV2Chunks.fingerprint(3,chunks))
        val record=ArchiveV2Record("chat","c",o.objectSha256,emptyList(),emptyList())
        val coverage=ArchiveV2Manifests.modules.map { ArchiveV2Coverage(it,if(it=="chat")"complete" else "unavailable",if(it=="chat")1 else 0) }
        val m=ArchiveV2Manifest("elementera-coast-archive",2,"local","com.elementeracoast.app","2026-01-01T00:00:00Z",coverage,listOf(record),listOf(o))
        assertFalse(ArchiveV2Manifests.validate(m).declaredComplete)
        assertEquals(3L,ArchiveV2Manifests.validate(m).bytes)
        assertTrue(runCatching { ArchiveV2Manifests.validate(m.copy(records=listOf(record.copy(dependencies=listOf("chat/missing"))))) }.isFailure)
        assertTrue(runCatching { ArchiveV2Manifests.validate(m.copy(objects=listOf(o,o))) }.isFailure)
        assertTrue(runCatching { ArchiveV2Manifests.validate(m.copy(modules=coverage.dropLast(1))) }.isFailure)
    }
    @Test fun selectedChatExcludesUnrelatedBookAndIncludesOnlyLinkedMedia(){
        fun obj(n:Int):ArchiveV2Object {
            val bytes=byteArrayOf(n.toByte())
            val chunks=listOf(ArchiveV2Chunks.digest(bytes))
            return ArchiveV2Object(1,chunks,ArchiveV2Chunks.fingerprint(1,chunks))
        }
        val objects=(1..5).map(::obj)
        val rows=listOf(
            ArchiveV2Record("chat","c",objects[0].objectSha256,emptyList(),emptyList()),
            ArchiveV2Record("attachments","a",objects[1].objectSha256,listOf(objects[2].objectSha256),listOf("chat/c")),
            ArchiveV2Record("library","other-book",objects[3].objectSha256,emptyList(),emptyList()),
            ArchiveV2Record("chat","other",objects[4].objectSha256,emptyList(),emptyList())
        )
        val counts=rows.groupingBy { it.module }.eachCount()
        val m=ArchiveV2Manifest("elementera-coast-archive",2,"local","com.elementeracoast.app","2026-01-01T00:00:00Z",ArchiveV2Manifests.modules.map { ArchiveV2Coverage(it,if(it in counts)"partial" else "unavailable",counts[it]?:0) },rows,objects)
        val selected=ArchiveV2Manifests.forRestore(m,"chat","c")
        assertEquals(listOf("c","a"),selected.records.map { it.id })
        assertEquals(objects.take(3),selected.objects)
        assertEquals(3L,ArchiveV2Manifests.validate(selected).bytes)
        assertEquals("unavailable",selected.modules.first { it.module=="library" }.coverage)
    }
}
