package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.remote.*
import java.io.File
import java.nio.file.Files
import org.junit.Assert.*
import org.junit.Test

class ArchiveV2KnowledgeTest {
    @Test fun editableKnowledgeRoundtripAndConflictProtection(){
        val root=Files.createTempDirectory("knowledge-v2").toFile()
        try{
            val app="com.elementeracoast.source";val modules=ArchiveV2Knowledge.modules
            val from=MemoryLocalPersistence();val knowledge=LocalKnowledgeStore(from)
            val instructions=knowledge.saveInstructions(RemoteCustomInstructionsPutRequest("Exact instructions\nsecond line"))
            val word=knowledge.saveWorldbook(null,RemoteWorldbookEntryWriteRequest("Wave","Text",listOf("wave"),constantActive=true))
            val zip=File(root,"local.zip");val manifest=ArchiveV2Local.export(from,app,zip)
            assertEquals(2,manifest.records.count{it.module in modules})
            val stage=ArchiveV2Stage(root,"verified");assertEquals(manifest,ArchiveV2ZipReader.stage(zip,stage))
            val target=MemoryLocalPersistence()
            val preview=ArchiveV2Local.restore(manifest,stage,modules,app,target,false)
            assertEquals(1,preview.counts.getValue("worldbook").ready)
            assertNull(LocalKnowledgeStore(target).instructions())
            ArchiveV2Local.restore(manifest,stage,modules,app,target,true)
            val local=LocalKnowledgeStore(target)
            assertEquals(instructions,local.instructions());assertEquals(word,local.entries().single())
            val context=local.context(listOf(RemoteChatMessage("user","wave")),1800,"main_chat")
            assertEquals("Exact instructions\nsecond line",context.messages.first().content)
            assertEquals(1,context.receipt.worldbook.deliveredCount)
            assertEquals(0,ArchiveV2Local.restore(manifest,stage,modules,app,target,true).counts.getValue("worldbook").conflicts)
            val changed=local.saveInstructions(RemoteCustomInstructionsPutRequest("Changed"))
            assertEquals(1,ArchiveV2Local.restore(manifest,stage,modules,app,target,true).counts.getValue("custom_instructions").conflicts)
            assertEquals(changed,local.instructions())
            val cloud=manifest.copy(workspace="backend")
            val newTarget=MemoryLocalPersistence()
            ArchiveV2Local.restore(cloud,stage,modules,app,newTarget,true)
            assertEquals(word,LocalKnowledgeStore(newTarget).entries().single())
            assertEquals(instructions,LocalKnowledgeStore(newTarget).instructions())
        }finally{root.deleteRecursively()}
    }
}
