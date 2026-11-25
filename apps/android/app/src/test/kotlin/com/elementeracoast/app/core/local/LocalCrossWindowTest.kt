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
}
