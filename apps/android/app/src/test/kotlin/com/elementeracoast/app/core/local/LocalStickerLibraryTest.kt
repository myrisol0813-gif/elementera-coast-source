package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.remote.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class LocalStickerLibraryTest {
    @Test fun originalDeliveryIsAtomicAndPermissionScoped(){
        val store=MemoryLocalPersistence();val cache=RemoteCacheStore(store)
        val src="source";val dst="target"
        cache.putConversations(listOf(RemoteConversation(src,"素材"),RemoteConversation(dst,"聊天")))
        cache.putHistory(src,RemoteHistory(conversationId=src))
        val png=byteArrayOf(137.toByte(),80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,6,0,0,0)
        val image=store.atomic{LocalAttachmentStore(it).upload(src,"wolf.png","image/png",png)}
        val lib=LocalStickerLibrary(store)
        val entry=lib.register(src,image.id,"摇尾巴","owner")
        assertEquals(entry,lib.register(src,image.id,"不同说明","owner"))
        val t=RemoteTurn("turn",user=RemoteUserBranch(0,listOf(RemoteVariant("user","hello"))),assistant=RemoteAssistantBranches(mapOf("0" to 0),mapOf("0" to listOf(RemoteVariant("assistant",finishReason="sticker_tool_ready",createdAt=java.time.Instant.now().toString())))))
        val h=RemoteHistory(conversationId=dst,turns=listOf(t))
        cache.putHistory(dst,h)
        assertTrue(runCatching{lib.deliver(dst,"turn","user","assistant",entry.id,true)}.isFailure)
        val enabled=h.copy(contextSettings=h.contextSettings.copy(localModelToolsEnabled=true,localModelWriteEnabled=true,stickerSendEnabled=true))
        cache.putHistory(dst,enabled)
        assertEquals(1,lib.search(dst,"摇尾巴",allowSend=true)["items"]!!.jsonArray.size)
        val sent=lib.deliver(dst,"turn","user","assistant",entry.id,true)
        assertFalse(sent.reused);assertNotEquals(image.id,sent.attachment.id)
        assertEquals(sent.attachment,lib.deliver(dst,"turn","user","assistant",entry.id,true).attachment)
        val original=LocalAttachmentStore(store).entries().single{it.metadata["id"]!!.jsonPrimitive.content==sent.attachment.id}
        assertArrayEquals(png,LocalAttachmentStore(store).bytes(original))
        val saved=cache.history(dst)!!
        assertEquals(sent.attachment,saved.turns.single().assistant.variantsByUserVariant.getValue("0").single().attachments.single())
        assertEquals(sent.attachment,LocalImageRecovery.protect(saved,enabled,null).turns.single().assistant.variantsByUserVariant.getValue("0").single().attachments.single())
        lib.update(entry.id,"owner",enabled=false)
        assertEquals(0,lib.search(dst,allowSend=true)["items"]!!.jsonArray.size)
        assertTrue(runCatching{lib.deliver(dst,"turn","user","assistant",entry.id,true)}.isFailure)
        lib.remove(entry.id,"owner")
        assertArrayEquals(png,LocalAttachmentStore(store).bytes(original))
        assertEquals(2,LocalAttachmentStore(store).entries().size)
    }
    @Test fun stickerToolSessionUsesRealOriginalAndRechecksRevocation(){
        val store=MemoryLocalPersistence();val cache=RemoteCacheStore(store)
        val src="source";val dst="target"
        cache.putConversations(listOf(RemoteConversation(src,"素材"),RemoteConversation(dst,"聊天")))
        cache.putHistory(src,RemoteHistory(conversationId=src))
        val png=byteArrayOf(137.toByte(),80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,6,0,0,0)
        val image=store.atomic{LocalAttachmentStore(it).upload(src,"wolf.png","image/png",png)}
        val entry=LocalStickerLibrary(store).register(src,image.id,"小狼摇尾巴","owner")
        val t=RemoteTurn("turn",user=RemoteUserBranch(0,listOf(RemoteVariant("user","hello"))),assistant=RemoteAssistantBranches(mapOf("0" to 0),mapOf("0" to listOf(RemoteVariant("assistant",finishReason="sticker_tool_ready",createdAt=java.time.Instant.now().toString())))))
        val settings=com.elementeracoast.app.core.model.ConversationContextSettings(localModelToolsEnabled=true,localModelWriteEnabled=true,stickerSendEnabled=true)
        val h=RemoteHistory(conversationId=dst,turns=listOf(t),contextSettings=settings)
        cache.putHistory(dst,h)
        val k=LocalKnowledgeStore(store)
        val ctx=k.context(listOf(RemoteChatMessage("user","hello")),12000,"main_chat",dst)
        val tool=k.toolSession(dst,"turn",null,ctx.receipt,"fixture/model",messageId="assistant")!!
        assertTrue(tool.tools.toString().contains("sticker_send"))
        assertFalse(tool.tools.toString().contains("sticker_add"))
        val search=tool.execute("search","sticker_search","{\"q\":\"摇尾巴\"}")
        assertTrue(search.output,search.ok)
        assertTrue(search.output.contains(entry.id))
        val args=buildJsonObject{put("sticker_id",entry.id)}.toString()
        val result=tool.execute("send","sticker_send",args)
        assertTrue(result.output,result.ok)
        assertTrue(tool.stickerSaved)
        assertFalse(result.output.contains("base64"))
        val saved=cache.history(dst)!!
        val attachment=saved.turns.single().assistant.variantsByUserVariant.getValue("0").single().attachments.single()
        assertEquals(entry.id,attachment.stickerDelivery?.stickerId)
        assertTrue(tool.execute("repeat","sticker_send",args).ok)
        assertEquals(2,LocalAttachmentStore(store).entries().size)
        cache.putHistory(dst,saved.copy(contextSettings=settings.copy(stickerSendEnabled=false)))
        assertFalse(tool.execute("revoked","sticker_send",args).ok)
        assertEquals(2,LocalAttachmentStore(store).entries().size)
        assertTrue(LocalToolAudit(store).read().any{it["tool_key"]?.jsonPrimitive?.content=="sticker.send"})
    }

    @Test fun archiveRoundTripRetainsDisabledStickerAndOriginal(){
        val dir=java.nio.file.Files.createTempDirectory("sticker-v2").toFile()
        try{
            val app="com.elementeracoast.source";val from=MemoryLocalPersistence();val cid="sticker-chat"
            val cache=RemoteCacheStore(from)
            cache.putConversations(listOf(RemoteConversation(cid,"素材","main","2026-11-26T00:00:00Z","2026-11-26T00:00:00Z")))
            val png=byteArrayOf(137.toByte(),80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,6,0,0,0)
            val image=storeImage(from,cid,png)
            cache.putHistory(cid,RemoteHistory(conversationId=cid,updatedAt="2026-11-26T00:00:00Z",turns=listOf(RemoteTurn("turn",user=RemoteUserBranch(0,listOf(RemoteVariant("user","素材",attachments=listOf(image))))))))
            val lib=LocalStickerLibrary(from);val entry=lib.register(cid,image.id,"小狼","owner")
            lib.update(entry.id,"owner",desc="小狼的新说明",enabled=false)
            val zip=java.io.File(dir,"complete.zip");val m=ArchiveV2Local.export(from,app,zip)
            val r=m.records.single{it.id.startsWith("vault_stickers:")}
            assertEquals(setOf("chat/"+cid,"attachments/"+image.id),r.dependencies.toSet())
            val stage=ArchiveV2Stage(dir,"verified");ArchiveV2ZipReader.stage(zip,stage)
            val target=MemoryLocalPersistence()
            assertTrue(runCatching{ArchiveV2Local.restore(m,stage,setOf("vault"),app,target,true)}.isFailure)
            val modules=setOf("chat","attachments","vault")
            assertEquals(1,ArchiveV2Local.restore(m,stage,modules,app,target,false).counts.getValue("vault").ready)
            assertTrue(LocalStickerLibrary(target).listOwner().isEmpty())
            ArchiveV2Local.restore(m,stage,modules,app,target,true)
            assertEquals(lib.listOwner(),LocalStickerLibrary(target).listOwner())
            val original=LocalAttachmentStore(target).entries().single()
            assertArrayEquals(png,LocalAttachmentStore(target).bytes(original))
            assertEquals(1,ArchiveV2Local.restore(m,stage,modules,app,target,true).counts.getValue("vault").existing)
        }finally{dir.deleteRecursively()}
    }
    private fun storeImage(store:MemoryLocalPersistence,cid:String,png:ByteArray):RemoteAttachment{
        val row=buildJsonObject{put("id","image-original");put("conversation_id",cid);put("turn_id","turn");put("kind","image");put("name","wolf.png");put("mime","image/png");put("size",png.size);put("created_at",10L);put("updated_at",20L)}
        store.atomic{LocalAttachmentStore(it).publish(LocalAttachmentStore.Original(row,ArchiveV2Chunks.digest(png)),png)}
        return RemoteAttachment(id="image-original",type="image",name="wolf.png",mime="image/png",size=png.size.toLong())
    }

}
