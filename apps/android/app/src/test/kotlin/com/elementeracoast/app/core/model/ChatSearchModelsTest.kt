package com.elementeracoast.app.core.model

import com.elementeracoast.app.core.remote.RemoteAssistantBranches
import com.elementeracoast.app.core.remote.RemoteHistory
import com.elementeracoast.app.core.remote.RemoteTurn
import com.elementeracoast.app.core.remote.RemoteUserBranch
import com.elementeracoast.app.core.remote.RemoteVariant
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertNotNull
import org.junit.Test

class ChatSearchModelsTest {
    private val history = RemoteHistory(turns = listOf(RemoteTurn(
        id = "turn-a",
        user = RemoteUserBranch(active = 1, variants = listOf(
            RemoteVariant(id = "user-old", content = "极光旧诗"),
            RemoteVariant(id = "user-new", content = "现在的话")
        )),
        assistant = RemoteAssistantBranches(
            activeByUserVariant = mapOf("1" to 0),
            variantsByUserVariant = mapOf(
                "0" to listOf(RemoteVariant(id = "assistant-old", content = "旧版回答")),
                "1" to listOf(RemoteVariant(id = "assistant-new", content = "新版回答"))
            )
        )
    )))

    @Test fun oldAssistantResultSelectsCorrectUserAndAssistantVariantsLocally() {
        val hit = ChatSearchHit("message", "chat-a", "测试窗口", "turn-a", "assistant-old",
            MessageRole.Assistant, "旧版回答")
        val selected = previewSearchVariant(history, hit)
        assertNotNull(selected)
        assertEquals(0, selected!!.turns.first().user.active)
        assertEquals(0, selected.turns.first().assistant.activeByUserVariant["0"])
        assertEquals(1, history.turns.first().user.active)
    }

    @Test fun missingOrHiddenMessageNeverFallsBackToWrongVersion() {
        val missing = ChatSearchHit("message", "chat-a", "", "turn-a", "not-found",
            MessageRole.Assistant, "")
        assertNull(previewSearchVariant(history, missing))
        val hidden = history.copy(turns = history.turns.map { turn ->
            turn.copy(user = turn.user.copy(variants = turn.user.variants.map { variant ->
                if (variant.id == "user-old") variant.copy(hidden = true) else variant
            }))
        })
        assertNull(previewSearchVariant(hidden, ChatSearchHit("message", "chat-a", "",
            "turn-a", "user-old", MessageRole.User, "")))
    }

    @Test fun jsonResultRetainsStableServerIdentifiers() {
        val item = Json.parseToJsonElement(
            """{"kind":"message","conversation_id":"chat-a","conversation_title":"雪野","turn_id":"turn-a","message_id":"assistant-old","role":"assistant","snippet":"旧版回答"}"""
        ).jsonObject
        val hit = ChatSearchHit.fromJson(item)
        assertNotNull(hit)
        assertEquals("assistant-old", hit!!.messageId)
        assertEquals(MessageRole.Assistant, hit.role)
        assertNull(ChatSearchHit.fromJson(Json.parseToJsonElement(
            """{"kind":"message","conversation_id":"chat-a","message_id":"bad"}"""
        ).jsonObject))
    }
}
