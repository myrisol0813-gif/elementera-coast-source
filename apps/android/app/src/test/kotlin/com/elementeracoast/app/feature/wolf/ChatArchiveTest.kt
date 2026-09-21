package com.elementeracoast.app.feature.wolf

import com.elementeracoast.app.core.model.ChatMessage
import com.elementeracoast.app.core.model.MessageRole
import org.junit.Assert.assertEquals
import org.junit.Test

class ChatArchiveTest {
    @Test fun jsonExportAndImportRoundTripCurrentFlatMessages() {
        val source = listOf(
            ChatMessage(1, MessageRole.User, "你好\n海岸"),
            ChatMessage(2, MessageRole.Assistant, "我在。")
        )
        val json = ChatArchive.exportJson(WolfProfile("Human Owner", "屋主"), source)
        var id = 100L
        val imported = ChatArchive.importJson(json) { id++ }.getOrThrow()
        assertEquals("Human Owner", imported.nickname)
        assertEquals("屋主", imported.signature)
        assertEquals(source.map { it.text }, imported.messages.map { it.text })
    }

}
