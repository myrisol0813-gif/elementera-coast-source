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

}
