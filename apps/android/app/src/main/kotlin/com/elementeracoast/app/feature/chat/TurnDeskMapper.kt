package com.elementeracoast.app.feature.chat

import com.elementeracoast.app.core.model.TurnDeskDetail
import com.elementeracoast.app.core.model.TurnDeskReceipt
import com.elementeracoast.app.core.model.TurnDeskSection
import com.elementeracoast.app.core.remote.RemoteDeskCrossWindow
import com.elementeracoast.app.core.remote.RemoteDeskAttachments
import com.elementeracoast.app.core.remote.RemoteDeskCrossWindowSource
import com.elementeracoast.app.core.remote.RemoteDeskSlip
import com.elementeracoast.app.core.remote.RemoteDeskWebSearch
import com.elementeracoast.app.core.remote.RemoteDeskTool

internal object TurnDeskMapper {
    fun toUi(value: RemoteDeskSlip): TurnDeskReceipt = TurnDeskReceipt(
        summary = value.summary.ifBlank { "本轮递给模型" },
        comfort = value.comfort,
        sections = listOf(
            section(
                title = value.currentMessage.label.ifBlank { "当前消息" },
                status = value.currentMessage.status,
                description = value.currentMessage.description,
                details = detail("正文", value.currentMessage.content)
            ),
            section(
                title = value.recentContext.label.ifBlank { "最近上下文" },
                status = withDetail(value.recentContext.status, value.recentContext.statusDetail),
                description = value.recentContext.description,
                details = value.recentContext.messages.map { message ->
                    TurnDeskDetail(if (message.role == "assistant") "模型伙伴回复" else "用户消息", message.content)
                }
            ),
            section(
                title = value.customInstructions.label.ifBlank { "核心自定义" },
                status = if (value.customInstructions.delivered && value.customInstructions.length > 0) {
                    "${value.customInstructions.status} · 全文 ${value.customInstructions.length} 字"
                } else value.customInstructions.status,
                description = value.customInstructions.description,
                details = detail("全文", value.customInstructions.content)
            ),
            section(
                title = value.globalExcerpt.label.ifBlank { "全局摘录" },
                status = withDetail(
                    value.globalExcerpt.status,
                    if (value.globalExcerpt.estimatedTokens > 0) "约 ${value.globalExcerpt.estimatedTokens} tokens" else ""
                ),
                description = value.globalExcerpt.description,
                details = buildList {
                    if (value.globalExcerpt.injection.isNotBlank()) add(TurnDeskDetail("注入状态", value.globalExcerpt.injection))
                    if (value.globalExcerpt.length > 0) add(TurnDeskDetail("正文长度", "${value.globalExcerpt.length} 字"))
                    if (value.globalExcerpt.content.isNotBlank()) add(TurnDeskDetail("实际递给模型", value.globalExcerpt.content))
                }
            ),
            section(
                title = value.thinkingSoil.label.ifBlank { "整理当前对话的纸条" },
                status = value.thinkingSoil.status,
                description = value.thinkingSoil.description,
                details = buildList {
                    if (value.thinkingSoil.currentText.isNotBlank()) add(TurnDeskDetail("当前整理", value.thinkingSoil.currentText))
                    value.thinkingSoil.handSeeds.forEach { seed -> add(TurnDeskDetail("当前活跃线索", seed)) }
                    add(TurnDeskDetail(
                        "待确认候选",
                        "${value.thinkingSoil.pocketCandidatesStatus.ifBlank { if (value.thinkingSoil.pocketCandidatesCount > 0) "待确认" else "未递入" }} · ${value.thinkingSoil.pocketCandidatesCount} 条 · 未递给正文"
                    ))
                    if (value.thinkingSoil.context.isNotBlank()) add(TurnDeskDetail("实际递给模型", value.thinkingSoil.context))
                }
            ),
            section(
                title = value.relatedMemory.label.ifBlank { "相关记忆" },
                status = withDetail(
                    value.relatedMemory.status,
                    if (value.relatedMemory.confirmationStatus.isBlank()) "" else "${value.relatedMemory.confirmationStatus} ${value.relatedMemory.count} 条"
                ),
                description = value.relatedMemory.description,
                details = value.relatedMemory.items.flatMap { item ->
                    buildList {
                        val title = item.title.ifBlank { "未命名" }
                        add(TurnDeskDetail(title, listOf(item.entryType, item.tag, item.sourceWindow).filter(String::isNotBlank).joinToString(" · ")))
                        if (item.sourceModel.isNotBlank()) add(TurnDeskDetail("来源模型", item.sourceModel))
                        if (item.sourceTime.isNotBlank() || item.sourceDate.isNotBlank()) add(TurnDeskDetail("来源时间", item.sourceTime.ifBlank { item.sourceDate }))
                        if (item.reason.isNotBlank()) add(TurnDeskDetail("命中原因", item.reason))
                        if (item.lifeCore.isNotBlank()) add(TurnDeskDetail("核心", item.lifeCore))
                        if (item.usageHint.isNotBlank()) add(TurnDeskDetail("使用时机", item.usageHint))
                        if (item.avoidHint.isNotBlank()) add(TurnDeskDetail("勿误用", item.avoidHint))
                        if (item.content.isNotBlank()) add(TurnDeskDetail("正文", item.content))
                        if (item.deliveredText.isNotBlank()) add(TurnDeskDetail("实际递给模型", item.deliveredText))
                    }
                }
            ),
            section(
                title = value.worldbook.label.ifBlank { "世界书" },
                status = withDetail(value.worldbook.status, if (value.worldbook.matchedCount > 0) "命中 ${value.worldbook.matchedCount} 条" else ""),
                description = value.worldbook.description,
                details = value.worldbook.entries.flatMap { item ->
                    buildList {
                        add(TurnDeskDetail(item.title.ifBlank { "未命名" }, item.content))
                        if (item.scope.isNotBlank()) add(TurnDeskDetail("范围", item.scope))
                        if (item.matchedBy.isNotBlank()) add(TurnDeskDetail("命中方式", item.matchedBy))
                        if (item.deliveredText.isNotBlank()) add(TurnDeskDetail("实际递给模型", item.deliveredText))
                    }
                }
            ),
            section(
                title = value.dogtalk.label.ifBlank { "私人草稿" },
                status = value.dogtalk.status,
                description = value.dogtalk.description,
                details = if (value.dogtalk.delivered) detail("实际递给模型", value.dogtalk.context) else emptyList()
            ),
            section(
                title = value.crossWindow.label.ifBlank { "跨窗口读取" },
                status = crossWindowStatus(value.crossWindow),
                description = value.crossWindow.description,
                details = buildList {
                    val requestedTurns = value.crossWindow.requestedTurns.takeIf { it > 0 } ?: value.crossWindow.totalRequestedTurns
                    val loadedTurns = value.crossWindow.loadedTurns.takeIf { it > 0 } ?: value.crossWindow.totalLoadedTurns
                    val deliveredTurns = value.crossWindow.deliveredToModelTurns.takeIf { it > 0 } ?: value.crossWindow.totalDeliveredTurns
                    value.crossWindow.sources.forEach { source ->
                        val sourceLoaded = source.loadedTurns.takeIf { it > 0 } ?: source.deliveredTurns
                        val sourceDelivered = source.deliveredToModelTurns.takeIf { it > 0 } ?: source.deliveredTurns
                        add(TurnDeskDetail(
                            crossWindowSourceLabel(source),
                            "请求 ${source.requestedTurns}轮 · 读取 ${sourceLoaded}轮 · 递给 ${sourceDelivered}轮"
                        ))
                    }
                    if (requestedTurns > 0 || loadedTurns > 0 || deliveredTurns > 0) {
                        add(TurnDeskDetail("本轮统计", "请求 ${requestedTurns}轮 · 读取 ${loadedTurns}轮 · 递给 ${deliveredTurns}轮"))
                    }
                    if (value.crossWindow.requestedMessages > 0 || value.crossWindow.loadedMessages > 0 || value.crossWindow.deliveredToModelMessages > 0) {
                        add(TurnDeskDetail(
                            "消息级统计",
                            "请求 ${value.crossWindow.requestedMessages}条 · 读取 ${value.crossWindow.loadedMessages}条 · 递给 ${value.crossWindow.deliveredToModelMessages}条"
                        ))
                    }
                    if (value.crossWindow.attemptedDeliveredTurns > 0) add(TurnDeskDetail("尝试递送", "${value.crossWindow.attemptedDeliveredTurns}轮"))
                    if (value.crossWindow.attemptedChars > 0) add(TurnDeskDetail("尝试字符", value.crossWindow.attemptedChars.toString()))
                    if (value.crossWindow.attemptedEstimatedTokens > 0) add(TurnDeskDetail("估算输入 token", value.crossWindow.attemptedEstimatedTokens.toString()))
                    value.crossWindow.failureReason?.takeIf(String::isNotBlank)?.let { add(TurnDeskDetail("失败原因", it)) }
                    if (value.crossWindow.providerErrorType.isNotBlank()) add(TurnDeskDetail("Provider 错误类型", value.crossWindow.providerErrorType))
                    if (value.crossWindow.providerErrorMessage.isNotBlank()) add(TurnDeskDetail("Provider 错误摘要", value.crossWindow.providerErrorMessage))
                    if (value.crossWindow.trimReason.isNotBlank()) add(TurnDeskDetail("裁剪原因", value.crossWindow.trimReason))
                    if (value.crossWindow.error.isNotBlank()) add(TurnDeskDetail("错误", value.crossWindow.error))
                    val sourceById = value.crossWindow.sources.associateBy { it.conversationId }
                    value.crossWindow.messages.forEach { group ->
                        val source = sourceById[group.conversationId]
                        val label = source?.let(::crossWindowSourceLabel).orEmpty().ifBlank { "来源窗口" }
                        group.messages.forEach { message ->
                            add(TurnDeskDetail("$label · ${if (message.role == "assistant") "模型伙伴" else "用户"}", message.content))
                        }
                    }
                }
            ),
            section(
                title = value.workbench.label.ifBlank { "工作台 / 工具回执" },
                status = value.workbench.status,
                description = value.workbench.description,
                details = buildList {
                    if (value.workbench.coreTools.isNotEmpty()) add(TurnDeskDetail("常用工具", value.workbench.coreTools.joinToString("、", transform = ::toolLabel)))
                    if (value.workbench.sideTools.isNotEmpty()) add(TurnDeskDetail("小组件小工具", value.workbench.sideTools.joinToString("、", transform = ::toolLabel)))
                    if (value.workbench.modelVisibleTools.isNotEmpty()) add(TurnDeskDetail("模型可见工具", value.workbench.modelVisibleTools.joinToString("、", transform = ::toolLabel)))
                    if (value.workbench.backendTools.isNotEmpty()) add(TurnDeskDetail("后端可用工具", value.workbench.backendTools.joinToString("、", transform = ::toolLabel)))
                    val hasWorkbenchMaterial = value.workbench.promptDelivered ||
                        value.workbench.prompt.isNotBlank() ||
                        value.workbench.coreTools.isNotEmpty() ||
                        value.workbench.sideTools.isNotEmpty() ||
                        value.workbench.modelVisibleTools.isNotEmpty() ||
                        value.workbench.backendTools.isNotEmpty() ||
                        value.workbench.furniture.isNotEmpty() ||
                        value.workbench.toolResults.any { it.delivered && it.content.isNotBlank() }
                    if (hasWorkbenchMaterial) add(TurnDeskDetail("工作台提示", if (value.workbench.promptDelivered) "已递给" else "未递给"))
                    if (value.workbench.prompt.isNotBlank()) add(TurnDeskDetail("工作台提示全文", value.workbench.prompt))
                    if (value.workbench.furniture.isNotEmpty()) add(TurnDeskDetail("本轮动用", value.workbench.furniture.joinToString("、")))
                    value.workbench.toolResults.filter { it.delivered && it.content.isNotBlank() }.forEach { result ->
                        add(TurnDeskDetail("${result.name} · 工具结果 JSON", result.content))
                    }
                }
            ),
            section(
                title = value.contextBudget.label.ifBlank { "上下文预算" },
                status = buildString {
                    append("${value.contextBudget.estimatedTokens} / ${value.contextBudget.comfortCeiling} tokens")
                    if (value.contextBudget.exceedsComfortCeiling) append(" · 超出舒服区间")
                    else if (value.contextBudget.trimmed) append(" · 已裁剪")
                    else append(" · 未裁剪")
                },
                description = "",
                details = buildList {
                    add(TurnDeskDetail("裁剪", if (value.contextBudget.trimmed) "是 · ${value.contextBudget.trimmedCount} 项" else "否"))
                    if (value.contextBudget.sourcesPreserved.isNotEmpty()) add(TurnDeskDetail("保留来源", value.contextBudget.sourcesPreserved.joinToString("、")))
                    if (value.contextBudget.globalExcerpt.isNotBlank()) add(TurnDeskDetail("全局摘录", value.contextBudget.globalExcerpt))
                }
            ),
            section(
                title = value.externalTide.label.ifBlank { "外部入口消息" },
                status = value.externalTide.status,
                description = value.externalTide.description,
                details = detail("", value.externalTide.content.ifBlank { "本轮没有递入外部材料。" })
            )
        ) + listOfNotNull(
            attachmentSection(value.attachments),
            webSearchSection(value.webSearch)
        )
    )

    private fun attachmentSection(value: RemoteDeskAttachments?): TurnDeskSection? {
        if (value == null) return null
        return section(
            title = "本轮附件",
            status = "上传 ${value.uploaded} · 递给 ${value.deliveredToModel}",
            description = "",
            details = buildList {
                add(TurnDeskDetail(
                    "识图",
                    if (value.vision.supported) "当前模型支持 · 已递 ${value.vision.imagesDelivered} 张"
                    else "当前模型未确认支持 · 已递 ${value.vision.imagesDelivered} 张"
                ))
                value.delivered.forEach { item ->
                    add(TurnDeskDetail(
                        item.name.ifBlank { item.id.ifBlank { "附件" } },
                        when (item.mode) {
                            "vision" -> "图片 · 已递给模型 · 识图"
                            "text" -> "文件 · 已递给模型 · 文本读取"
                            else -> "已递给模型"
                        }
                    ))
                }
                value.notDelivered.forEach { item ->
                    add(TurnDeskDetail(
                        item.name.ifBlank { item.id.ifBlank { "附件" } },
                        "未递给模型 · ${item.reason.ifBlank { "unknown" }}"
                    ))
                }
            }
        )
    }

    private fun webSearchSection(value: RemoteDeskWebSearch?): TurnDeskSection? {
        if (value == null) return null
        val status = when {
            !value.available -> "不可用"
            value.used -> "已搜索 · ${value.requests} 次 · ${value.resultsCount} 来源"
            else -> "可用 · 本轮未调用"
        }
        return section(
            title = "本轮搜索",
            status = status,
            description = "",
            details = buildList {
                if (value.requestedQuery.isNotBlank()) add(TurnDeskDetail("本轮触发语句", value.requestedQuery))
                if (!value.providerQueryReturned) add(TurnDeskDetail("搜索 query", "provider 未回传内部原始 query；前端不伪造。"))
                value.reason?.takeIf(String::isNotBlank)?.let { add(TurnDeskDetail("不可用原因", it)) }
                value.results.forEach { item ->
                    val body = listOf(item.url, item.content).filter(String::isNotBlank).joinToString("\n")
                    add(TurnDeskDetail(item.title.ifBlank { item.url.ifBlank { "搜索结果" } }, body))
                }
            }
        )
    }

    private fun crossWindowStatus(value: RemoteDeskCrossWindow): String {
        val windows = value.requestedWindows.takeIf { it > 0 } ?: value.windowCount
        val requested = value.requestedTurns.takeIf { it > 0 } ?: value.totalRequestedTurns
        val loaded = value.loadedTurns.takeIf { it > 0 } ?: value.totalLoadedTurns
        val delivered = value.deliveredToModelTurns.takeIf { it > 0 } ?: value.totalDeliveredTurns
        val attempted = value.attemptedDeliveredTurns
        val detail = when {
            value.status == "递送失败" -> "${windows}窗 · 请求 ${requested} · 读取 ${loaded} · 尝试 ${attempted}轮"
            windows > 0 || requested > 0 || loaded > 0 || delivered > 0 -> "${windows}窗 · 请求 ${requested} · 读取 ${loaded} · 递给 ${delivered}轮"
            else -> ""
        }
        return withDetail(value.status, detail)
    }

    private fun crossWindowSourceLabel(source: RemoteDeskCrossWindowSource): String = when {
        source.source == "rikkahub" -> "【Rikka】${source.title}"
        source.roomType == "radio" -> source.title
        source.roomType == "lighthouse" -> source.title
        else -> "主聊天｜${source.title}"
    }

    private fun section(
        title: String,
        status: String,
        description: String,
        details: List<TurnDeskDetail>
    ): TurnDeskSection = TurnDeskSection(
        title = title,
        status = status,
        details = buildList {
            if (description.isNotBlank()) add(TurnDeskDetail("来源说明", description))
            addAll(details)
            if (details.isEmpty()) add(TurnDeskDetail("", "本轮未递入"))
        }
    )

    private fun withDetail(status: String, detail: String): String =
        listOf(status, detail).filter(String::isNotBlank).joinToString(" · ")

    private fun detail(label: String, text: String): List<TurnDeskDetail> =
        text.takeIf(String::isNotBlank)?.let { listOf(TurnDeskDetail(label, it)) }.orEmpty()

    private fun toolLabel(tool: RemoteDeskTool): String {
        val display = tool.displayName.ifBlank { tool.name.ifBlank { tool.toolKey } }
        val technical = tool.name.ifBlank { tool.toolKey }
        return if (display.isNotBlank() && technical.isNotBlank() && display != technical) "$display｜$technical" else display
    }
}
