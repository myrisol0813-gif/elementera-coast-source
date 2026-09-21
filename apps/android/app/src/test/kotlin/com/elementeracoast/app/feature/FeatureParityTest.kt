package com.elementeracoast.app.feature

import com.elementeracoast.app.core.model.FeatureDestination
import com.elementeracoast.app.feature.daily.dailyLandingItems
import com.elementeracoast.app.feature.memory.memoryLandingItems
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class FeatureParityTest {
    @Test
    fun featureDestinationsMatchCurrentSurfaceWithoutRetiredRoutes() {
        assertEquals(
            listOf(
                FeatureDestination.Memory,
                FeatureDestination.Daily,
                FeatureDestination.Wolf,
                FeatureDestination.ActionLog,
                FeatureDestination.IslandLetter
            ),
            FeatureDestination.entries
        )
        assertEquals("模型工作台 / 模型工作台", FeatureDestination.ActionLog.title)
        assertEquals("登岛信", FeatureDestination.IslandLetter.title)
        val labels = FeatureDestination.entries.joinToString(" ") { "${it.name} ${it.title} ${it.subtitle}" }
        listOf("Calendar", "今日一瞥", "一日总结", "相册", "Serpent Action Log").forEach { retired ->
            assertFalse(labels.contains(retired, ignoreCase = true))
        }
    }

    @Test fun dailyLandingKeepsThreeEntrances() = assertEquals(
        listOf("碳硅圈", "日记", "宠物系统"), dailyLandingItems().map { it.title }
    )

    @Test fun memoryLandingKeepsMemoryV2AndGlobalExcerptEntrances() = assertEquals(
        listOf("记忆库", "种子库", "世界书", "全局摘录", "自定义指令"), memoryLandingItems().map { it.title }
    )
}
