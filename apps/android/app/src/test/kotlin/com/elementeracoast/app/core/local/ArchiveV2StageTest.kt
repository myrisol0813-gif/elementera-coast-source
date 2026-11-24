package com.elementeracoast.app.core.local

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.nio.file.Files

class ArchiveV2StageTest {
    @Test fun stagedObjectsSurviveReopenAndRejectCorruption() {
        val dir=Files.createTempDirectory("coast-stage").toFile()
        try {
            val data=byteArrayOf(1,2,3,4)
            val hashes=listOf(ArchiveV2Chunks.digest(data))
            val info=ArchiveV2Object(data.size.toLong(),hashes,ArchiveV2Chunks.fingerprint(data.size.toLong(),hashes))
            val stage=ArchiveV2Stage(dir,"session-a")
            assertTrue(runCatching { stage.stage(info,ByteArrayInputStream(byteArrayOf(1,2,3,5)),1024) }.isFailure)
            assertTrue(runCatching { stage.verify(info,1024) }.isFailure)
            val saved=stage.stage(info,ByteArrayInputStream(data),1024)
            assertArrayEquals(data,saved.readBytes())
            val reopened=ArchiveV2Stage(dir,"session-a")
            assertArrayEquals(data,reopened.verify(info,1024).readBytes())
            assertTrue(runCatching { ArchiveV2Stage(dir,"../outside") }.isFailure)
            saved.writeBytes(byteArrayOf(0,2,3,4))
            assertTrue(runCatching { reopened.verify(info,1024) }.isFailure)
        } finally { dir.deleteRecursively() }
    }
}
