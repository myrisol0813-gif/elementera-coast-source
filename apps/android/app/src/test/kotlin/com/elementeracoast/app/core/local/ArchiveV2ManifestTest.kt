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
}
