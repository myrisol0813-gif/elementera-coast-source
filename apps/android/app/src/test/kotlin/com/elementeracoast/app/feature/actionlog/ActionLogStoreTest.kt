package com.elementeracoast.app.feature.actionlog

import com.elementeracoast.app.core.local.MemoryLocalPersistence
import com.elementeracoast.app.core.model.RoomType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ActionLogStoreTest {
    @Test
    fun filtersByStatusTypeConversationAndExplicitActionIds() {
        val persistence = MemoryLocalPersistence()
        val store = ActionLogStore(persistence)
        val first = store.record(
            actionKey = "daily.diary.write",
            label = "写了一篇日记",
            roomType = RoomType.Main,
            conversationId = "main-1",
            inputSummary = "line one\nline two",
            outputSummary = "新增 1 篇本地日记"
        )
        val second = store.record(
            actionKey = "memory.search",
            label = "搜索了记忆",
            roomType = RoomType.Radio,
            conversationId = "radio-1",
            outputSummary = "命中 3 条"
        )
        val failed = store.record(
            actionKey = "memory.search",
            label = "搜索了记忆",
            roomType = RoomType.Main,
            conversationId = "main-1",
            errorMessage = "local failure"
        )

        assertEquals(listOf(failed.actionId), store.filtered(ActionLogFilter(status = LocalActionStatus.Error)).map { it.actionId })
        assertEquals(setOf(second.actionId, failed.actionId), store.filtered(ActionLogFilter(actionKey = "memory.search")).map { it.actionId }.toSet())
        assertEquals(setOf(first.actionId, failed.actionId), store.filtered(ActionLogFilter(conversationId = "main-1")).map { it.actionId }.toSet())
        assertEquals(listOf(second.actionId), store.filtered(ActionLogFilter(actionIds = setOf(second.actionId))).map { it.actionId })
        assertFalse(first.inputSummary.contains('\n'))
        assertTrue(first.inputSummary.length <= 360)

        val reloaded = ActionLogStore(persistence)
        assertEquals(store.records.value.map { it.actionId }, reloaded.records.value.map { it.actionId })
    }
}
