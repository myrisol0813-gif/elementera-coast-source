package com.elementeracoast.app.feature.serpentdesk

import org.junit.Assert.assertEquals
import org.junit.Test

class SerpentDeskSurfaceTest {
    @Test
    fun deskExposesDevHandsObserverBesideTheExistingActionLog() {
        val items = serpentDeskItems()
        assertEquals(2, items.size)
        assertEquals(
            listOf(SerpentDeskTool.DevHands, SerpentDeskTool.ActionLog),
            items.map { it.tool }
        )
        assertEquals(
            listOf("前端开发手", "工具调用记录"),
            items.map { it.title }
        )
        assertEquals("模型随身工具 · 自检 · 脚印 · 版本 / APK", items.first().subtitle)
        assertEquals("普通前端工具调用 · 房间 · 脱敏摘要", items.last().subtitle)
    }
}
