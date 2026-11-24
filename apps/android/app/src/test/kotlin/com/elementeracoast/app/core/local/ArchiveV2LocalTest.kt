package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.remote.RemoteProfile
import com.elementeracoast.app.core.remote.RemoteCacheStore
import java.io.File
import java.nio.file.Files
import org.junit.Assert.*
import org.junit.Test

class ArchiveV2LocalTest {
    @Test fun localZipRoundtripUsesRealAtomicRestore() {
        val root=Files.createTempDirectory("coast-local-v2").toFile()
        try {
            val source=MemoryLocalPersistence();val target=MemoryLocalPersistence()
            val profile=RemoteProfile(currentChatModel="model-fixture")
            RemoteCacheStore(source).putProfile(profile)
            val file=File(root,"local.zip")
            val app="com.elementeracoast.source"
            val manifest=ArchiveV2Local.export(source,app,file)
            val stage=ArchiveV2Stage(File(root,"stage"),"local")
            assertEquals(manifest,ArchiveV2ZipReader.stage(file,stage))
            val selection=setOf("model_profile")
            assertEquals(1,ArchiveV2Local.restore(manifest,stage,selection,app,target,false).counts.getValue("model_profile").ready)
            assertNull(RemoteCacheStore(target).profile())
            ArchiveV2Local.restore(manifest,stage,selection,app,target,true)
            assertEquals(profile,RemoteCacheStore(target).profile())
            assertTrue(manifest.modules.any { it.module=="attachments"&&it.coverage=="unavailable" })
        }finally{root.deleteRecursively()}
    }
}
