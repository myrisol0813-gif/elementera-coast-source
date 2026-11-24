package com.elementeracoast.app.core.local

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.util.zip.ZipInputStream

class ArchiveV2ZipWriterTest {
    @Test fun writesVerifiedObjectsAndManifest() {
        val bytes=byteArrayOf(1,2,3)
        val hashes=listOf(ArchiveV2Chunks.digest(bytes))
        val d=ArchiveV2Object(3,hashes,ArchiveV2Chunks.fingerprint(3,hashes))
        val r=ArchiveV2Record("chat","c",d.objectSha256,emptyList(),emptyList())
        val coverage=ArchiveV2Manifests.modules.map { ArchiveV2Coverage(it,if(it=="chat")"partial" else "unavailable",if(it=="chat")1 else 0) }
        val m=ArchiveV2Manifest("elementera-coast-archive",2,"local","com.elementeracoast.app","2026-01-01T00:00:00Z",coverage,listOf(r),listOf(d))
        val output=ByteArrayOutputStream()
        ArchiveV2ZipWriter(output).use { writer ->
            writer.objectEntry(d,ByteArrayInputStream(bytes))
            writer.objectEntry(d,ByteArrayInputStream(bytes))
            writer.finish(m)
        }
        val files=mutableMapOf<String,ByteArray>()
        ZipInputStream(ByteArrayInputStream(output.toByteArray())).use { zip ->
            while(true){val entry=zip.nextEntry?:break;files[entry.name]=zip.readBytes();zip.closeEntry()}
        }
        assertEquals(2,files.size)
        assertArrayEquals(bytes,files.getValue(ArchiveV2Chunks.path(d)))
        assertTrue(files.getValue("manifest.json").decodeToString().contains("record_object"))
    }
}
