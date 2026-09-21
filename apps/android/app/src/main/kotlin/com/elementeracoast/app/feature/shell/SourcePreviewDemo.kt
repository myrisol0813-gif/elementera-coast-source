package com.elementeracoast.app.feature.shell

import com.elementeracoast.app.core.model.ChatAttachment
import com.elementeracoast.app.core.model.ChatMessage
import com.elementeracoast.app.core.model.ConversationSummary
import com.elementeracoast.app.core.model.FurnitureItem
import com.elementeracoast.app.core.model.FurnitureRun
import com.elementeracoast.app.core.model.MessageRole
import com.elementeracoast.app.core.model.RoomType
import com.elementeracoast.app.core.model.ThoughtPocketSnapshot
import com.elementeracoast.app.core.model.ThoughtSeedSnapshot
import com.elementeracoast.app.core.model.ThoughtSoilSnapshot
import com.elementeracoast.app.core.model.TurnDeskDetail
import com.elementeracoast.app.core.model.TurnDeskReceipt
import com.elementeracoast.app.core.model.TurnDeskSection

/**
 * One deterministic local sample turn for the public source preview.
 *
 * It is intentionally small: enough to render the real chat, attachment,
 * tool, model-echo and thought-soil surfaces without pretending that a
 * model or backend actually ran.
 */
internal object SourcePreviewDemo {
    const val conversationId = "source-preview-demo"
    const val assistantMessageId = "source-preview-demo-assistant"

    val conversation = ConversationSummary(
        id = conversationId,
        title = "Source Demo · 一轮完整示例",
        roomType = RoomType.Main,
        source = "source_preview"
    )

    private val imageAttachment = ChatAttachment(
        id = "source-preview-image",
        type = "image",
        name = "source-preview-image.png",
        mime = "image/png",
        size = 18_432,
        storageKey = "source-preview://image"
    )

    private val fileAttachment = ChatAttachment(
        id = "source-preview-notes",
        type = "file",
        name = "source-preview-notes.txt",
        mime = "text/plain",
        size = 812,
        storageKey = "source-preview://notes"
    )

    private val deskReceipt = TurnDeskReceipt(
        summary = "本轮递给模型 · source preview",
        comfort = "这是一轮本地展示数据，没有调用真实模型或后端。",
        sections = listOf(
            TurnDeskSection(
                title = "当前消息",
                status = "已递给 · 示例",
                details = listOf(
                    TurnDeskDetail("正文", "请看看这张示例图片和附件，并展示这一轮的工具与上下文痕迹。")
                )
            ),
            TurnDeskSection(
                title = "本轮附件",
                status = "上传 2 · 递给 2",
                details = listOf(
                    TurnDeskDetail("source-preview-image.png", "图片 · 已递给模型 · 识图示例"),
                    TurnDeskDetail("source-preview-notes.txt", "文件 · 已递给模型 · 文本读取示例")
                )
            ),
            TurnDeskSection(
                title = "整理当前对话的纸条",
                status = "已递给 · 1 条活跃线索",
                details = listOf(
                    TurnDeskDetail("当前整理", "用户正在查看 source 版一轮完整交互的展示效果。"),
                    TurnDeskDetail("当前活跃线索", "source demo：附件、工具、回波与思维壤")
                )
            ),
            TurnDeskSection(
                title = "工作台 / 工具回执",
                status = "已调用 2 项 · 本地示例",
                details = listOf(
                    TurnDeskDetail("读取附件", "source-preview-notes.txt · success"),
                    TurnDeskDetail("搜索记忆", "命中 1 条示例记忆 · success"),
                    TurnDeskDetail("说明", "这些结果只用于展示 UI，不代表真实工具已经执行。")
                )
            ),
            TurnDeskSection(
                title = "上下文预算",
                status = "约 640 / 8,000 tokens · 未裁剪",
                details = listOf(
                    TurnDeskDetail("保留来源", "当前消息、附件、整理当前对话的纸条、工具回执")
                )
            )
        )
    )

    val thoughtSoil = ThoughtSoilSnapshot(
        conversationId = conversationId,
        currentText = "这一轮只展示 source 版最核心的交互结构：图片、文件、工具、模型回波与思维壤。",
        handSeeds = listOf(
            ThoughtSeedSnapshot(
                name = "source demo",
                lifeCore = "让第一次打开的人一眼看见项目内部长什么样。",
                usageHint = "仅用于 source preview 的本地展示。",
                avoidHint = "不要把示例数据当成真实聊天、记忆或模型结果。"
            )
        ),
        doNotRepeat = "不要把 demo 内容写入真实数据。",
        pocketCandidates = listOf(
            ThoughtPocketSnapshot(
                title = "样板窗口说明",
                lifeCore = "有假数据，没有假智能。",
                content = "示例只负责把真实 UI 组件摆出来，不模拟完整后端。",
                usageHint = "查看 source 版结构时使用。",
                avoidHint = "连接真实后端后不再显示。",
                sourceExcerpt = "source preview"
            )
        ),
        manualLocked = false,
        revision = 1,
        organizer = "source preview",
        updatedAt = "demo"
    )

    val messages = listOf(
        ChatMessage(
            id = 9_001L,
            role = MessageRole.User,
            text = "请看看这张示例图片和附件，并展示这一轮的工具与上下文痕迹。",
            turnId = "source-preview-turn",
            remoteVariantId = "source-preview-demo-user",
            displayAuthor = "屋主",
            attachments = listOf(imageAttachment, fileAttachment)
        ),
        ChatMessage(
            id = 9_002L,
            role = MessageRole.Assistant,
            text = "这是 source preview 的展示回复。图片、文件、工具回执、模型回波和思维壤都来自本地示例数据，只用来展示界面；这一轮没有调用真实模型或后端。",
            turnId = "source-preview-turn",
            remoteVariantId = assistantMessageId,
            modelId = "source/demo-model",
            generationSource = "chat",
            displayAuthor = "另一位屋主",
            furnitureRuns = listOf(
                FurnitureRun(
                    actionId = "source-preview-tool-file",
                    actionKey = "read_file",
                    label = "读取附件",
                    items = listOf(FurnitureItem("source-preview-notes.txt", "file"))
                ),
                FurnitureRun(
                    actionId = "source-preview-tool-memory",
                    actionKey = "memory_search",
                    label = "搜索记忆",
                    items = listOf(FurnitureItem("示例记忆命中", "memory"))
                )
            ),
            deskReceipt = deskReceipt
        )
    )

    val models = listOf("source/demo-model")

    const val toolPopupText = "使用工具 · 读取附件（source preview）"
}
