package com.elementeracoast.app.feature.chat

import com.elementeracoast.app.core.remote.RemoteChatMessage
import com.elementeracoast.app.core.remote.RemoteDeskAttachmentItem
import com.elementeracoast.app.core.remote.RemoteDeskAttachments
import com.elementeracoast.app.core.remote.RemoteDeskAttachmentVision
import com.elementeracoast.app.core.remote.RemoteDeskCurrentMessage
import com.elementeracoast.app.core.remote.RemoteDeskContextBudget
import com.elementeracoast.app.core.remote.RemoteDeskGlobalExcerpt
import com.elementeracoast.app.core.remote.RemoteDeskExternalTide
import com.elementeracoast.app.core.remote.RemoteDeskMemory
import com.elementeracoast.app.core.remote.RemoteDeskRecentContext
import com.elementeracoast.app.core.remote.RemoteDeskSlip
import com.elementeracoast.app.core.remote.RemoteDeskThinkingSoil
import com.elementeracoast.app.core.remote.RemoteDeskWebSearch
import com.elementeracoast.app.core.remote.RemoteDeskWebSearchResult
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TurnDeskMapperTest {
    @Test fun mapperIncludesGlobalExcerptAndContextBudgetTransparency() {
        val receipt = TurnDeskMapper.toUi(
            RemoteDeskSlip(
                currentMessage = RemoteDeskCurrentMessage(
                    description = "当前来源说明",
                    status = "已递给",
                    delivered = true,
                    content = "这一句话"
                ),
                recentContext = RemoteDeskRecentContext(
                    description = "最近来源说明",
                    status = "已递给",
                    statusDetail = "1 轮",
                    turns = 1,
                    messages = listOf(RemoteChatMessage(role = "user", content = "上一轮"))
                ),
                globalExcerpt = RemoteDeskGlobalExcerpt(
                    description = "全局摘录说明",
                    status = "完整注入",
                    delivered = true,
                    injection = "complete",
                    estimatedTokens = 188,
                    length = 720,
                    content = "我在文字里认出自己。"
                ),
                contextBudget = RemoteDeskContextBudget(
                    estimatedTokens = 4321,
                    comfortCeiling = 6000,
                    trimmed = false,
                    trimmedCount = 0,
                    exceedsComfortCeiling = false,
                    sourcesPreserved = listOf("当前消息", "自定义指令", "全局摘录"),
                    globalExcerpt = "complete"
                ),
                thinkingSoil = RemoteDeskThinkingSoil(
                    description = "整理当前对话的纸条说明",
                    status = "已递给",
                    pocketCandidatesCount = 2,
                    pocketCandidatesStatus = "待确认"
                ),
                relatedMemory = RemoteDeskMemory(
                    description = "记忆说明",
                    status = "未命中"
                ),
                externalTide = RemoteDeskExternalTide(
                    description = "外来说明",
                    status = "未递给",
                    content = "本轮没有递入外部材料。"
                )
            )
        )

        assertEquals(
            listOf("当前消息", "最近上下文", "核心自定义", "全局摘录", "整理当前对话的纸条", "相关记忆", "世界书", "人类思考链", "跨窗口取信", "工作台 / 工具回执", "上下文预算", "外部入口消息"),
            receipt.sections.map { it.title }
        )
        assertEquals("已递给 · 1 轮", receipt.sections[1].status)
        assertTrue(receipt.sections[3].status.contains("完整注入"))
        assertTrue(receipt.sections[3].details.any { it.label == "实际递给模型" && it.text.contains("我在文字里认出自己") })
        assertTrue(receipt.sections[4].details.any { it.label == "待确认候选" && it.text.contains("待确认 · 2 条 · 未递给正文") })
        assertEquals("未命中", receipt.sections[5].status)
        assertTrue(receipt.sections[8].details.any { it.text == "本轮未递入" })
        val budget = receipt.sections.first { it.title == "上下文预算" }
        assertTrue(budget.status.contains("4321 / 6000"))
        assertTrue(budget.details.any { it.label == "保留来源" && it.text.contains("全局摘录") })
        assertTrue(receipt.sections.last().details.any { it.text == "本轮没有递入外部材料。" })
        val sourceSections = setOf(
            "当前消息", "最近上下文", "核心自定义", "全局摘录", "整理当前对话的纸条",
            "相关记忆", "世界书", "人类思考链", "跨窗口取信", "工作台 / 工具回执", "外部入口消息"
        )
        assertTrue(
            receipt.sections
                .filter { it.title in sourceSections }
                .all { section ->
                    section.details.any { it.label == "来源说明" } ||
                        section.details.any { it.text == "本轮未递入" } ||
                        section.details.any { it.text == "本轮没有递入外部材料。" }
                }
        )
    }

    @Test fun mapperAddsAttachmentAndSearchReceiptsWhenPresent() {
        val receipt = TurnDeskMapper.toUi(
            RemoteDeskSlip(
                attachments = RemoteDeskAttachments(
                    uploaded = 2,
                    deliveredToModel = 1,
                    delivered = listOf(
                        RemoteDeskAttachmentItem(
                            id = "a1",
                            name = "图.png",
                            type = "image",
                            mode = "vision"
                        )
                    ),
                    notDelivered = listOf(
                        RemoteDeskAttachmentItem(
                            id = "a2",
                            name = "书.pdf",
                            reason = "file_type_unsupported"
                        )
                    ),
                    vision = RemoteDeskAttachmentVision(
                        supported = true,
                        imagesDelivered = 1
                    )
                ),
                webSearch = RemoteDeskWebSearch(
                    available = true,
                    used = true,
                    requestedQuery = "搜一下最新资料",
                    requests = 1,
                    resultsCount = 1,
                    results = listOf(
                        RemoteDeskWebSearchResult(
                            title = "来源",
                            url = "https://example.com",
                            content = "摘要"
                        )
                    )
                )
            )
        )

        val attachment = receipt.sections.first { it.title == "本轮附件" }
        val search = receipt.sections.first { it.title == "本轮搜索" }
        assertTrue(attachment.status.contains("上传 2"))
        assertTrue(attachment.details.any { it.text.contains("识图") })
        assertTrue(attachment.details.any { it.text.contains("file_type_unsupported") })
        assertTrue(search.status.contains("已搜索"))
        assertTrue(search.details.any { it.text.contains("https://example.com") })
    }
}
