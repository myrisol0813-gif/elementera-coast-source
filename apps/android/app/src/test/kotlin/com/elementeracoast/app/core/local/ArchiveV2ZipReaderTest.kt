package com.elementeracoast.app.core.local

import java.io.ByteArrayInputStream
import java.io.File
import java.nio.file.Files
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import org.junit.Assert.*
import org.junit.Test

class ArchiveV2ZipReaderTest {
    @Test fun readsArchiveWithoutPublishingAndRejectsUnsafePaths() {
        val root=Files.createTempDirectory("archive-reader").toFile()
        try {
            val data=byteArrayOf(1,2,3)
            val chunks=listOf(ArchiveV2Chunks.digest(data))
            val d=ArchiveV2Object(3,chunks,ArchiveV2Chunks.fingerprint(3,chunks))
            val record=ArchiveV2Record("chat","c",d.objectSha256,emptyList(),emptyList())
            val coverage=ArchiveV2Manifests.modules.map { ArchiveV2Coverage(it,if(it=="chat")"partial" else "unavailable",if(it=="chat")1 else 0) }
            val m=ArchiveV2Manifest("elementera-coast-archive",2,"backend","com.elementeracoast.app","2026-01-01T00:00:00Z",coverage,listOf(record),listOf(d))
            val file=File(root,"archive.zip")
            ArchiveV2ZipWriter(file.outputStream()).use { it.objectEntry(d,ByteArrayInputStream(data));it.finish(m) }
            val stage=ArchiveV2Stage(File(root,"staging"),"safe")
            assertEquals(m,ArchiveV2ZipReader.stage(file,stage))
            assertArrayEquals(data,stage.verify(d,1024).readBytes())
            val bad=File(root,"bad.zip")
            ZipOutputStream(bad.outputStream()).use { it.putNextEntry(ZipEntry("../outside"));it.write(data);it.closeEntry() }
            assertTrue(runCatching { ArchiveV2ZipReader.stage(bad,stage) }.isFailure)
            assertFalse(File(root,"outside").exists())
        }finally{root.deleteRecursively()}
    }
}
