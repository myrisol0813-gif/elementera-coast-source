package com.elementeracoast.app.core.model

enum class CrossWindowMode(val wireValue: String, val label: String) {
    Off("off", "关闭"),
    Manual("manual", "手动选择"),
    ModelDecides("model_decides", "让模型决定"),
    Keyword("keyword", "跨窗关键词漫游");

    companion object {
        fun fromWire(value: String): CrossWindowMode = entries.firstOrNull { it.wireValue == value } ?: Off
    }
}

data class CrossWindowLimits(
    val defaultTurns: Int,
    val technicalMaxTurnsPerSource: Int
)

data class CrossWindowMessage(
    val messageId: String,
    val role: String,
    val displayAuthor: String,
    val createdAt: String?,
    val length: Int,
    val preview: String
)

data class CrossWindowTurn(
    val turnId: String,
    val turnNumber: Int,
    val messages: List<CrossWindowMessage>
)

data class CrossWindowSource(
    val conversationId: String,
    val title: String,
    val roomType: String,
    val source: String,
    val sourceWindowId: String?,
    val updatedAt: String?,
    val messageCount: Int,
    val turnCount: Int,
    val readable: Boolean,
    val disabledReason: String,
    val turns: List<CrossWindowTurn> = emptyList()
)

data class CrossWindowMessageSelection(
    val conversationId: String,
    val messageId: String
)

data class CrossWindowRequest(
    val mode: CrossWindowMode = CrossWindowMode.Off,
    val messages: List<CrossWindowMessageSelection> = emptyList()
)

data class CrossWindowSourceSnapshot(
    val description: String,
    val limits: CrossWindowLimits,
    val sources: List<CrossWindowSource>
)
