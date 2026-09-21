package com.elementeracoast.app.feature.dogtalk

import com.elementeracoast.app.core.model.CrossWindowLimits
import com.elementeracoast.app.core.model.CrossWindowMessage
import com.elementeracoast.app.core.model.CrossWindowMode
import com.elementeracoast.app.core.model.CrossWindowSource
import com.elementeracoast.app.core.model.CrossWindowTurn
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CrossWindowContractTest {
    @Test
    fun fourModesKeepStableWireValues() {
        assertEquals(
            listOf("off", "manual", "model_decides", "keyword"),
            CrossWindowMode.entries.map { it.wireValue }
        )
        assertEquals(
            listOf("关闭", "手动选择", "让模型决定", "跨窗关键词漫游"),
            CrossWindowMode.entries.map { it.label }
        )
    }

    @Test
    fun manualRequestContainsOnlyIndividuallyCheckedMessages() {
        val source = source("coast-1", readable = true)
        val disabled = source("disabled-1", readable = false)
        val state = CrossWindowUiState(
            mode = CrossWindowMode.Manual,
            sources = listOf(source, disabled),
            limits = CrossWindowLimits(defaultTurns = 4, technicalMaxTurnsPerSource = 9999)
        )
            .toggleMessage("coast-1", "c-u1")
            .toggleMessage("coast-1", "c-a1")
            .toggleMessage("disabled-1", "d-u1")

        val request = state.request()

        assertEquals(CrossWindowMode.Manual, request.mode)
        assertEquals(
            listOf("c-u1", "c-a1"),
            request.messages.map { it.messageId }
        )
        assertTrue(request.messages.all { it.conversationId == "coast-1" })
    }

    @Test
    fun windowAndTurnStartCollapsedAndExpandIndependently() {
        val state = CrossWindowUiState(sources = listOf(source("coast-1", readable = true)))
        assertFalse(state.isSourceExpanded("coast-1"))
        assertFalse(state.isTurnExpanded("coast-1", "turn-1"))

        val sourceOpen = state.toggleSource("coast-1")
        val turnOpen = sourceOpen.toggleTurn("coast-1", "turn-1")

        assertTrue(sourceOpen.isSourceExpanded("coast-1"))
        assertTrue(turnOpen.isTurnExpanded("coast-1", "turn-1"))
    }

    @Test
    fun modelAndKeywordModesDoNotPreloadMessageBodies() {
        val deciding = CrossWindowUiState(mode = CrossWindowMode.ModelDecides).request()
        assertEquals(CrossWindowMode.ModelDecides, deciding.mode)
        assertTrue(deciding.messages.isEmpty())

        val keyword = CrossWindowUiState(mode = CrossWindowMode.Keyword).request()
        assertEquals(CrossWindowMode.Keyword, keyword.mode)
        assertTrue(keyword.messages.isEmpty())
    }

    private fun source(id: String, readable: Boolean) = CrossWindowSource(
        conversationId = id,
        title = if (readable) "普通窗口" else "当前窗口",
        roomType = "main",
        source = "coast",
        sourceWindowId = null,
        updatedAt = "2026-09-19T18:00:00Z",
        messageCount = 2,
        turnCount = 1,
        readable = readable,
        disabledReason = if (readable) "" else "当前窗口已由最近上下文提供",
        turns = listOf(
            CrossWindowTurn(
                turnId = "turn-1",
                turnNumber = 1,
                messages = listOf(
                    CrossWindowMessage(
                        messageId = if (id == "coast-1") "c-u1" else "d-u1",
                        role = "user",
                        displayAuthor = "屋主",
                        createdAt = "2026-09-19T18:00:00Z",
                        length = 4,
                        preview = "旧信用户"
                    ),
                    CrossWindowMessage(
                        messageId = if (id == "coast-1") "c-a1" else "d-a1",
                        role = "assistant",
                        displayAuthor = "模型伙伴",
                        createdAt = "2026-09-19T18:01:00Z",
                        length = 4,
                        preview = "旧信回复"
                    )
                )
            )
        )
    )
}
