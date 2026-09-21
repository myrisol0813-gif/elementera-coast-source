package com.elementeracoast.app.core.contract

import com.elementeracoast.app.core.model.RoomType

/**
 * Transport-neutral Kotlin skeletons aligned to Elementera Coast Web/PWA app-57.
 *
 * They are deliberately not annotated for any serializer yet: this pass does not wire a real
 * backend and does not pretend an HTTP mapping has already been chosen.
 */
data class CoastConversation(
    val id: String,
    val title: String,
    val roomType: RoomType
)

data class CoastMessage(
    val role: String,
    val content: String
)

data class UserVariant(
    val id: String,
    val content: String,
    val createdAt: String
)

data class AssistantVariant(
    val id: String,
    val content: String,
    val createdAt: String,
    val modelId: String? = null,
    val finishReason: String? = null
)

data class ModelProfile(
    val currentChatModel: String,
    val modelBox: List<String>
)

data class DailyMoment(
    val id: String,
    val date: String,
    val author: String,
    val text: String
)

data class DailyDiary(
    val id: String,
    val date: String,
    val author: String,
    val weather: String,
    val mood: String,
    val text: String
)

data class MemoryEntry(
    val id: String,
    val entryType: String,
    val title: String,
    val lifeCore: String,
    val content: String,
    val memoryLevel: String,
    val status: String
)

/** Dogtalk keeps its existing four-field contract verbatim. */
data class DogtalkSubmission(
    val body: String,
    val true_core: String,
    val weather: String,
    val read_mode: String
)
