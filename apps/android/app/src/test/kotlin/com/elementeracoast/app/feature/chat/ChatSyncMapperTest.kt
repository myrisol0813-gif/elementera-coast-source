package com.elementeracoast.app.feature.chat

import com.elementeracoast.app.core.model.ChatAttachment
import com.elementeracoast.app.core.model.MessageRole
import com.elementeracoast.app.core.remote.RemoteAssistantBranches
import com.elementeracoast.app.core.remote.RemoteHistory
import com.elementeracoast.app.core.remote.RemoteTurn
import com.elementeracoast.app.core.remote.RemoteUserBranch
import com.elementeracoast.app.core.remote.RemoteVariant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatSyncMapperTest {
    @Test
    fun mapperPreservesRemoteBranchCountsAndTurnIdentity() {
        val history = RemoteHistory(
            turns = listOf(
                RemoteTurn(
                    id = "turn-1",
                    user = RemoteUserBranch(
                        active = 1,
                        variants = listOf(
                            RemoteVariant("u1", "旧问题", "2026-09-02T00:00:00Z"),
                            RemoteVariant("u2", "新问题", "2026-09-02T00:01:00Z")
                        )
                    ),
                    assistant = RemoteAssistantBranches(
                        activeByUserVariant = mapOf("1" to 1),
                        variantsByUserVariant = mapOf(
                            "0" to listOf(RemoteVariant("a0", "旧分支回复", "2026-09-02T00:00:10Z")),
                            "1" to listOf(
                                RemoteVariant("a1", "第一版", "2026-09-02T00:01:10Z"),
                                RemoteVariant("a2", "第二版", "2026-09-02T00:01:20Z")
                            )
                        )
                    )
                )
            )
        )

        val messages = ChatSyncMapper.toUi(history)
        val user = messages.first { it.role == MessageRole.User }
        val assistant = messages.first { it.role == MessageRole.Assistant }

        assertEquals("turn-1", user.turnId)
        assertEquals("新问题", user.text)
        assertEquals(2, user.variantCount)
        assertEquals(1, user.variantIndex)
        assertEquals("第二版", assistant.text)
        assertEquals(2, assistant.variantCount)
        assertEquals(1, assistant.variantIndex)
    }

    @Test
    fun attachmentOnlyTurnStaysVisibleAndProvidesIdsForGeneration() {
        val attachment = ChatAttachment(
            id = "att-1",
            type = "image",
            name = "coast.png",
            mime = "image/png",
            size = 1234,
            storageKey = "chat-attachment:att-1",
            createdAt = "2026-09-15T12:00:00Z"
        )
        val appended = ChatSyncMapper.appendUser(RemoteHistory(), "", listOf(attachment))

        val context = ChatSyncMapper.contextMessages(appended.history, appended.turnId, recentTurns = 8)
        val ui = ChatSyncMapper.toUi(appended.history).single()

        assertEquals("请查看本轮附件。", context.single().content)
        assertEquals(listOf("att-1"), ChatSyncMapper.activeAttachmentIds(appended.history, appended.turnId))
        assertEquals("", ui.text)
        assertEquals("coast.png", ui.attachments.single().name)
    }

    @Test
    fun retryContextEndsAtTargetUserAndDoesNotIncludeFailedAssistant() {
        var history = RemoteHistory()
        val first = ChatSyncMapper.appendUser(history, "第一问")
        history = ChatSyncMapper.appendAssistant(first.history, first.turnId, "第一答", "model-a", "stop")
        val second = ChatSyncMapper.appendUser(history, "第二问")
        history = ChatSyncMapper.appendAssistant(
            second.history,
            second.turnId,
            "失败时收到的一点残片",
            "model-a",
            "error",
            errorDetail = "stream_error: broken"
        )

        val context = ChatSyncMapper.contextMessages(history, second.turnId, recentTurns = 8)

        assertEquals(listOf("user", "assistant", "user"), context.map { it.role })
        assertEquals("第二问", context.last().content)
        assertFalse(context.any { it.content.contains("残片") })
    }

    @Test
    fun importedRikkaHistoryStaysVisibleAndParticipatesInItsOwnRecentContext() {
        val archived = RemoteTurn(
            id = "rikka-turn",
            user = RemoteUserBranch(
                variants = listOf(
                    RemoteVariant(
                        id = "rikka-user",
                        content = "RikkaHub 旧问题",
                        createdAt = "2026-08-01T00:00:00Z",
                        messageSource = "rikkahub"
                    )
                )
            ),
            assistant = RemoteAssistantBranches(
                activeByUserVariant = mapOf("0" to 0),
                variantsByUserVariant = mapOf(
                    "0" to listOf(
                        RemoteVariant(
                            id = "rikka-assistant",
                            content = "RikkaHub 旧回复",
                            createdAt = "2026-08-01T00:00:10Z",
                            modelId = "old-model",
                            messageSource = "rikkahub"
                        )
                    )
                )
            )
        )
        val appended = ChatSyncMapper.appendUser(RemoteHistory(turns = listOf(archived)), "回到海岸后的新问题")

        val ui = ChatSyncMapper.toUi(appended.history)
        val context = ChatSyncMapper.contextMessages(appended.history, appended.turnId, recentTurns = 8)

        assertTrue(ui.any { it.text == "RikkaHub 旧问题" })
        assertTrue(ui.any { it.text == "RikkaHub 旧回复" })
        assertEquals(
            listOf("RikkaHub 旧问题", "RikkaHub 旧回复", "回到海岸后的新问题"),
            context.map { it.content }
        )
    }

    @Test
    fun clientPreflightUsesRequestedRecentTurnsWithoutHiddenMaximum() {
        val importedTurns = (0 until 10).map { index ->
            RemoteTurn(
                id = "rikka-$index",
                user = RemoteUserBranch(
                    variants = listOf(
                        RemoteVariant(
                            id = "u-$index",
                            content = "旧问题 $index",
                            createdAt = "2026-08-01T00:00:00Z",
                            messageSource = "rikkahub"
                        )
                    )
                ),
                assistant = RemoteAssistantBranches(
                    activeByUserVariant = mapOf("0" to 0),
                    variantsByUserVariant = mapOf(
                        "0" to listOf(
                            RemoteVariant(
                                id = "a-$index",
                                content = "旧回复 $index",
                                createdAt = "2026-08-01T00:00:10Z",
                                messageSource = "rikkahub"
                            )
                        )
                    )
                )
            )
        }
        val appended = ChatSyncMapper.appendUser(RemoteHistory(turns = importedTurns), "新的海岸消息")

        val openContext = ChatSyncMapper.contextMessages(appended.history, appended.turnId, recentTurns = 200)
        assertEquals(21, openContext.size)
        assertEquals("旧问题 0", openContext.first().content)
        assertEquals("新的海岸消息", openContext.last().content)

        val threeTurnContext = ChatSyncMapper.contextMessages(appended.history, appended.turnId, recentTurns = 3)
        assertEquals(5, threeTurnContext.size)
        assertEquals("旧问题 8", threeTurnContext.first().content)
        assertEquals("新的海岸消息", threeTurnContext.last().content)
    }

    @Test
    fun appendUserDoesNotTruncateA192TurnImportedArchive() {
        val importedTurns = (0 until 192).map { index ->
            RemoteTurn(
                id = "rikka-$index",
                user = RemoteUserBranch(
                    variants = listOf(
                        RemoteVariant(
                            id = "u-$index",
                            content = "旧问题 $index",
                            createdAt = "2026-08-01T00:00:00Z",
                            messageSource = "rikkahub"
                        )
                    )
                ),
                assistant = RemoteAssistantBranches(
                    activeByUserVariant = mapOf("0" to 0),
                    variantsByUserVariant = mapOf(
                        "0" to listOf(
                            RemoteVariant(
                                id = "a-$index",
                                content = "旧回复 $index",
                                createdAt = "2026-08-01T00:00:10Z",
                                messageSource = "rikkahub"
                            )
                        )
                    )
                )
            )
        }

        val appended = ChatSyncMapper.appendUser(RemoteHistory(turns = importedTurns), "新的海岸消息")

        assertEquals(193, appended.history.turns.size)
        assertEquals("rikka-0", appended.history.turns.first().id)
        assertEquals(appended.turnId, appended.history.turns.last().id)
    }

    @Test
    fun appendUserDoesNotImposeALocal400TurnHistoryCeiling() {
        val importedTurns = (0 until 450).map { index ->
            RemoteTurn(
                id = "long-$index",
                user = RemoteUserBranch(
                    variants = listOf(RemoteVariant("u-$index", "问题 $index", "2026-08-01T00:00:00Z"))
                )
            )
        }

        val appended = ChatSyncMapper.appendUser(RemoteHistory(turns = importedTurns), "第451轮")

        assertEquals(451, appended.history.turns.size)
        assertEquals("long-0", appended.history.turns.first().id)
        assertEquals(appended.turnId, appended.history.turns.last().id)
    }

    @Test
    fun userFailureIsVisibleAndCanBeClearedWithoutCreatingAnotherTurn() {
        val appended = ChatSyncMapper.appendUser(RemoteHistory(), "不要重复我")
        val failed = ChatSyncMapper.markUserFailure(appended.history, appended.turnId, "network: offline")

        assertEquals(1, failed.turns.size)
        val failedUi = ChatSyncMapper.toUi(failed).single()
        assertTrue(failedUi.errorDetail!!.contains("offline"))

        val cleared = ChatSyncMapper.clearUserFailure(failed, appended.turnId)
        assertEquals(1, cleared.turns.size)
        assertEquals(null, ChatSyncMapper.toUi(cleared).single().errorDetail)
    }
}
