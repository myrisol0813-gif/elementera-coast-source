package com.elementeracoast.app.feature.daily

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TidalReaderPagesTest {
    @Test fun everyCharacterIsPreservedWhenReflowing() {
        val first = "潮水".repeat(190) + "。"
        val second = "小狗和小蛇一起翻书。"
        val pages = paginateTidalChapter(listOf(0 to first, 1 to second), 180)
        assertTrue(pages.size > 2)
        assertEquals(first + second, pages.flatten().joinToString("") { it.text })
        assertEquals(0, tidalPageFor(pages, 0, 0))
        val later = tidalPageFor(pages, 0, 200)
        assertTrue(later > 0)
        assertEquals(0, pages[later].first().paragraphIndex)
        assertTrue(pages[later].first().start > 0)
        assertTrue(tidalPageFor(pages, 1, 0) >= later)
    }
}
