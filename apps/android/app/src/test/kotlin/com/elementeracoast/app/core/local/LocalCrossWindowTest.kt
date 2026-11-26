package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.remote.*
import org.junit.Assert.*
import org.junit.Test

class LocalCrossWindowTest {
    @Test fun selectedVisibleTextIsDeliveredOnlyForOneRequest() {
        val store = MemoryLocalPersistence()
        val cache = RemoteCacheStore(store)
        cache.putConversations(listOf(RemoteConversation("current", "Current"), RemoteConversation("old", "Old")))
        val old = RemoteHistory(conversationId = "old", turns = listOf(RemoteTurn("turn-1",
            user = RemoteUserBranch(0, listOf(RemoteVariant("u", "selected original"), RemoteVariant("hidden", "hidden secret", hidden = true))),
            assistant = RemoteAssistantBranches(mapOf("0" to 0), mapOf("0" to listOf(RemoteVariant("a", "unselected original")))))))
        cache.putHistory("old", old)
        val sources = LocalCrossWindow(store).sources("current")
        assertEquals(listOf("u","a"), sources.sources.single().turns.single().messages.map { it.messageId })
        val request = RemoteCrossWindowRequest("manual", listOf(RemoteCrossWindowMessageSelection("old", "u")))
        val knowledge = LocalKnowledgeStore(store)
        val input = listOf(RemoteChatMessage("user", "new question"))
        val selected = knowledge.context(input, 1800, "main_chat", "current", crossWindow = request)
        assertTrue(selected.messages.any { it.content.contains("selected original") })
        assertFalse(selected.messages.any { it.content.contains("unselected original") || it.content.contains("hidden secret") })
        assertEquals(1, selected.receipt.crossWindow.deliveredToModelMessages)
        assertEquals("u", selected.receipt.crossWindow.messages.single().messages.single().messageId)
        assertFalse(knowledge.context(input,1800,"main_chat","current").receipt.crossWindow.delivered)
        assertTrue(runCatching { knowledge.context(input,1800,"main_chat","current", crossWindow =
            RemoteCrossWindowRequest("manual", listOf(RemoteCrossWindowMessageSelection("old","hidden")))) }.isFailure)
        assertTrue(runCatching { knowledge.context(input,1800,"main_chat","current", crossWindow =
            RemoteCrossWindowRequest("keyword")) }.isFailure)
    }
    @Test fun selectedGroupRetainsAllActualMessageIds(){
        val store=MemoryLocalPersistence();val cache=RemoteCacheStore(store)
        cache.putConversations(listOf(RemoteConversation("current","Current"),RemoteConversation("old","Old")))
        val list=listOf(RemoteVariant("old-alt","old version"),RemoteVariant("a0","first original",replySequence=RemoteReplySequence("seq",0)),
            RemoteVariant("a1","second original",replySequence=RemoteReplySequence("seq",1)))
        cache.putHistory("old",RemoteHistory(conversationId="old",turns=listOf(RemoteTurn("t",user=RemoteUserBranch(variants=listOf(RemoteVariant("u","question"))),
            assistant=RemoteAssistantBranches(mapOf("0" to 2),mapOf("0" to list))))))
        val cross=LocalCrossWindow(store)
        assertEquals(listOf("u","a0","a1"),cross.recent("current","old",1).map{it.messageId})
        val read=cross.select("current",RemoteCrossWindowRequest("manual",listOf(RemoteCrossWindowMessageSelection("old","a0"))))
        assertTrue(read.text.contains("first original"));assertFalse(read.text.contains("second original"));assertFalse(read.text.contains("old version"))
    }

}
