package com.elementeracoast.app.feature.chat

import com.elementeracoast.app.core.remote.RemoteDeskAttachmentItem
import com.elementeracoast.app.core.remote.RemoteDeskAttachments
import com.elementeracoast.app.core.remote.RemoteDeskSlip
import com.elementeracoast.app.core.remote.RemoteDeskWebSearch
import com.elementeracoast.app.core.remote.RemoteDeskWebSearchResult
import com.elementeracoast.app.core.remote.RemoteFurnitureRun
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RuntimeFurnitureTest {
    @Test
    fun attachmentAndSearchReceiptsBecomeReadableFurniture() {
        val slip = RemoteDeskSlip(
            attachments = RemoteDeskAttachments(
                uploaded = 3,
                deliveredToModel = 2,
                delivered = listOf(
                    RemoteDeskAttachmentItem(id = "img", name = "海边.jpg", type = "image", mode = "vision"),
                    RemoteDeskAttachmentItem(id = "file", name = "notes.md", type = "file", mode = "text")
                ),
                notDelivered = listOf(
                    RemoteDeskAttachmentItem(id = "pdf", name = "book.pdf", type = "file", reason = "file_type_unsupported")
                )
            ),
            webSearch = RemoteDeskWebSearch(
                available = true,
                used = true,
                requests = 2,
                resultsCount = 2,
                results = listOf(
                    RemoteDeskWebSearchResult(title = "OpenRouter docs", url = "https://openrouter.ai/docs/features/web-search"),
                    RemoteDeskWebSearchResult(title = "Example", url = "https://www.example.com/a")
                )
            )
        )

        val runs = runtimeFurnitureRuns(slip)
        assertEquals(listOf("attachment.vision", "attachment.read", "attachment.delivery", "web.search"), runs.map { it.toolKey })
        assertEquals("看了一张图片", runs.first().label)
        assertEquals("file_type_unsupported", runs.first { it.toolKey == "attachment.delivery" }.errorType)
        val search = runs.first { it.toolKey == "web.search" }
        assertEquals(2, search.count)
        assertTrue(search.items.any { it.kind == "openrouter.ai" })
        assertTrue(search.items.any { it.kind == "example.com" })
    }

    @Test
    fun searchFurnitureAppearsOnlyWhenSearchWasActuallyUsed() {
        val unused = runtimeFurnitureRuns(
            RemoteDeskSlip(webSearch = RemoteDeskWebSearch(available = true, used = false, requestedQuery = "latest"))
        )
        assertFalse(unused.any { it.toolKey == "web.search" })
    }

    @Test
    fun mergeKeepsExistingLocalFurnitureAndAddsRuntimeReceipts() {
        val existing = listOf(
            RemoteFurnitureRun(id = "local-1", toolKey = "memory.search", label = "搜索了记忆")
        )
        val slip = RemoteDeskSlip(
            webSearch = RemoteDeskWebSearch(available = true, used = true, requests = 1)
        )
        val merged = mergeFurnitureRuns(existing, slip)
        assertEquals(listOf("memory.search", "web.search"), merged.map { it.toolKey })
    }
}
