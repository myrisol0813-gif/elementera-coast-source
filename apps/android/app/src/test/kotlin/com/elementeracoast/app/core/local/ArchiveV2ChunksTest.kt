package com.elementeracoast.app.core.local

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream

class ArchiveV2ChunksTest {
    @Test fun verifiesAndStagesBytes() {
        val first=ByteArray(ArchiveV2Chunks.CHUNK_BYTES){7}
        val last=byteArrayOf(1,2,3)
        val bytes=first+last
        val hashes=listOf(ArchiveV2Chunks.digest(first),ArchiveV2Chunks.digest(last))
        val size=bytes.size.toLong()
        val objectInfo=ArchiveV2Object(size,hashes,ArchiveV2Chunks.fingerprint(size,hashes))
        val output=ByteArrayOutputStream()
        ArchiveV2Chunks.stage(objectInfo,ByteArrayInputStream(bytes),output)
        assertArrayEquals(bytes,output.toByteArray())
        assertEquals("objects/"+objectInfo.objectSha256,ArchiveV2Chunks.path(objectInfo))
        for(bad in listOf(first,first+byteArrayOf(1,2,4),bytes+last,last+first)) {
            assertTrue(runCatching { ArchiveV2Chunks.stage(objectInfo,ByteArrayInputStream(bad),ByteArrayOutputStream()) }.isFailure)
        }
    }
    @Test fun largeDescriptorUsesLongSize() {
        val hash=ArchiveV2Chunks.digest(ByteArray(ArchiveV2Chunks.CHUNK_BYTES))
        val hashes=List(3072){hash}
        val size=3072L*ArchiveV2Chunks.CHUNK_BYTES
        val descriptor=ArchiveV2Object(size,hashes,ArchiveV2Chunks.fingerprint(size,hashes))
        assertEquals(3221225472L,ArchiveV2Chunks.validate(descriptor).size)
        assertTrue(runCatching { ArchiveV2Chunks.validate(descriptor,maxBytes=1024) }.isFailure)
    }
}
