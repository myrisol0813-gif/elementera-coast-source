package com.elementeracoast.app.feature.actionlog

import com.elementeracoast.app.core.model.RoomType

enum class LocalActionStatus { Success, Error }

data class LocalActionRecord(
    val actionId: String,
    val actionKey: String,
    val label: String,
    val status: LocalActionStatus,
    val roomType: RoomType,
    val conversationId: String,
    val createdAt: String,
    val finishedAt: String,
    val inputSummary: String = "",
    val outputSummary: String = "",
    val errorMessage: String = "",
    val assistantMessageId: Long? = null
)

data class ActionLogFilter(
    val status: LocalActionStatus? = null,
    val actionKey: String = "",
    val conversationId: String = "",
    val actionIds: Set<String> = emptySet()
)
