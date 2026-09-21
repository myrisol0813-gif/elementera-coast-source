package com.elementeracoast.app.core.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ConversationContractTest {
    @Test
    fun shellBootsWithoutHardCodedBusinessConversations() {
        val conversations = CoastShellState().conversations
        assertTrue(conversations.isEmpty())
        assertEquals(conversations, filterConversations(conversations, ""))
    }

    @Test
    fun filteringSupportsConcreteHistoryAcrossAllRoomTypes() {
        val conversations = listOf(
            ConversationSummary("main-test", "主聊天测试", RoomType.Main),
            ConversationSummary("radio-test", "【共通聊天室】夜航测试", RoomType.Radio),
            ConversationSummary("lighthouse-test", "【MCP 对话区】来信测试", RoomType.Lighthouse)
        )

        assertEquals(conversations, filterConversations(conversations, ""))
        assertEquals(listOf("radio-test"), filterConversations(conversations, "夜航").map { it.id })
        assertEquals(listOf("lighthouse-test"), filterConversations(conversations, "来信").map { it.id })
        assertEquals(listOf("main-test", "radio-test", "lighthouse-test"), conversations.map { it.id })
    }

    @Test
    fun roomTitlesKeepExactlyOneRequiredPrefix() {
        assertEquals("【共通聊天室】新的窗口", roomConversationTitle(RoomType.Radio, "新的窗口"))
        assertEquals("【共通聊天室】新的窗口", roomConversationTitle(RoomType.Radio, "【共通聊天室】新的窗口"))
        assertEquals("【MCP 对话区】新的窗口", roomConversationTitle(RoomType.Lighthouse, "【共通聊天室】新的窗口"))
        assertEquals("新的窗口", roomConversationTitle(RoomType.Main, "【MCP 对话区】新的窗口"))
    }
}
