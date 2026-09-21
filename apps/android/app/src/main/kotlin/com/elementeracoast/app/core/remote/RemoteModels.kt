package com.elementeracoast.app.core.remote

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class RemoteSessionInfo(
    val kind: String = "",
    @SerialName("issued_at") val issuedAt: String? = null,
    val persistence: String = "",
    @SerialName("expires_at") val expiresAtIso: String? = null
)

@Serializable
data class RemoteAccountInfo(
    val type: String = "",
    @SerialName("display_name") val displayName: String = ""
)

@Serializable
data class RemoteSessionResponse(
    val ok: Boolean = false,
    val authenticated: Boolean = false,
    @SerialName("expires_at") val legacyExpiresAt: Long = 0L,
    val session: RemoteSessionInfo = RemoteSessionInfo(),
    val account: RemoteAccountInfo = RemoteAccountInfo()
) {
    val expiresAt: Long
        get() = session.expiresAtIso
            ?.let { value -> runCatching { java.time.Instant.parse(value).epochSecond }.getOrNull() }
            ?.takeIf { it > 0L }
            ?: legacyExpiresAt
    val persistsUntilLogout: Boolean get() = session.persistence == "until_logout"
}

@Serializable
data class RemoteProfileResponse(val ok: Boolean = false, val profile: RemoteProfile = RemoteProfile())

@Serializable
data class RemoteProfile(
    @SerialName("assistant_avatar_dataurl") val assistantAvatarDataUrl: String = "",
    @SerialName("current_chat_model") val currentChatModel: String = "",
    @SerialName("current_image_model") val currentImageModel: String = "",
    @SerialName("model_box") val modelBox: RemoteModelBox = RemoteModelBox()
)

@Serializable
data class RemoteModelBox(
    val chat: List<String> = emptyList(),
    val free: List<String> = emptyList(),
    val image: List<String> = emptyList()
)

@Serializable
data class RemoteDailyProfileResponse(
    val ok: Boolean = false,
    val profile: RemoteDailyProfile = RemoteDailyProfile()
)

@Serializable
data class RemoteDailyProfile(
    @SerialName("xiaohan_avatar_dataurl") val xiaohanAvatarDataUrl: String = "",
    @SerialName("myri_avatar_dataurl") val myriAvatarDataUrl: String = "",
    @SerialName("moment_cover_dataurl") val momentCoverDataUrl: String = "",
    @SerialName("myri_display_name") val myriDisplayName: String = "另一位屋主",
    @SerialName("updated_at") val updatedAt: String? = null
)

@Serializable
data class RemoteConversation(
    val id: String,
    val title: String = "新聊天",
    @SerialName("room_type") val roomType: String = "main",
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null,
    val source: String = "coast",
    @SerialName("source_window_id") val sourceWindowId: String? = null
)

@Serializable
data class RemoteConversationListResponse(
    val ok: Boolean = false,
    val conversations: List<RemoteConversation> = emptyList()
)

@Serializable
data class RemoteConversationResponse(
    val ok: Boolean = false,
    val conversation: RemoteConversation
)

@Serializable
data class RemoteHistoryResponse(
    val ok: Boolean = false,
    val source: String = "",
    val history: RemoteHistory = RemoteHistory()
)

@Serializable
data class RemoteHistory(
    val version: Int = 4,
    @SerialName("updated_at") val updatedAt: String = "",
    val turns: List<RemoteTurn> = emptyList(),
    @SerialName("conversation_id") val conversationId: String? = null
)

@Serializable
data class RemoteTurn(
    val id: String,
    @SerialName("turn_type") val turnType: String? = null,
    @SerialName("model_id") val modelId: String? = null,
    val user: RemoteUserBranch = RemoteUserBranch(),
    val assistant: RemoteAssistantBranches = RemoteAssistantBranches()
)

@Serializable
data class RemoteUserBranch(
    val active: Int = 0,
    val variants: List<RemoteVariant> = emptyList()
)

@Serializable
data class RemoteAssistantBranches(
    @SerialName("activeByUserVariant") val activeByUserVariant: Map<String, Int> = emptyMap(),
    @SerialName("variantsByUserVariant") val variantsByUserVariant: Map<String, List<RemoteVariant>> = emptyMap()
)

@Serializable
data class RemoteAttachment(
    val id: String,
    val type: String = "file",
    val name: String = "附件",
    val mime: String = "application/octet-stream",
    val size: Long = 0L,
    @SerialName("storage_key") val storageKey: String = "",
    @SerialName("created_at") val createdAt: String = ""
)

@Serializable
data class RemoteAttachmentResponse(
    val ok: Boolean = false,
    val attachment: RemoteAttachment
)

@Serializable
data class RemoteVariant(
    val id: String,
    val content: String = "",
    @SerialName("created_at") val createdAt: String = "",
    val liked: Boolean = false,
    val favorite: Boolean = false,
    val hidden: Boolean = false,
    @SerialName("model_id") val modelId: String? = null,
    @SerialName("finish_reason") val finishReason: String? = null,
    @SerialName("generation_source") val generationSource: String? = null,
    @SerialName("message_source") val messageSource: String? = null,
    @SerialName("display_author") val displayAuthor: String? = null,
    @SerialName("errorDetail") val errorDetail: String? = null,
    val attachments: List<RemoteAttachment> = emptyList(),
    @SerialName("furniture_runs") val furnitureRuns: List<RemoteFurnitureRun> = emptyList(),
    @SerialName("desk_slip") val deskSlip: RemoteDeskSlip? = null
)

@Serializable
data class RemoteFurnitureRun(
    val id: String,
    @SerialName("tool_key") val toolKey: String = "",
    val label: String = "",
    val status: String = "success",
    val count: Int = 1,
    val items: List<RemoteFurnitureItem> = emptyList(),
    @SerialName("extra_count") val extraCount: Int = 0,
    @SerialName("error_type") val errorType: String? = null
)

@Serializable
data class RemoteFurnitureItem(val title: String = "", val kind: String = "")

@Serializable
data class RemoteChatMessage(val role: String, val content: String)

@OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)
@Serializable
data class RemoteChatRequest(
    @SerialName("conversation_id") val conversationId: String,
    @SerialName("source_turn_id") val sourceTurnId: String,
    @SerialName("message_id") val messageId: String = "",
    val model: String,
    val messages: List<RemoteChatMessage>,
    @SerialName("attachment_ids") val attachmentIds: List<String> = emptyList(),
    @SerialName("local_date") val localDate: String,
    @SerialName("local_datetime") val localDateTime: String,
    val settings: Map<String, String> = emptyMap(),
    @SerialName("cross_window") val crossWindow: RemoteCrossWindowRequest? = null,
    @kotlinx.serialization.EncodeDefault(kotlinx.serialization.EncodeDefault.Mode.ALWAYS)
    val stream: Boolean = true,
    @SerialName("client_info") val clientInfo: String = "native_android"
)

@Serializable
data class RemoteLandingLetterRequest(
    @SerialName("conversation_id") val conversationId: String,
    val model: String,
    @SerialName("letter_text") val letterText: String,
    @SerialName("local_date") val localDate: String,
    @SerialName("local_datetime") val localDateTime: String,
    val settings: Map<String, String> = emptyMap(),
    @SerialName("client_info") val clientInfo: String = "native_android"
)

@Serializable
data class RemoteLandingLetterResponse(
    val ok: Boolean = false,
    val assistant: RemoteVariant? = null,
    val conversation: RemoteConversation? = null,
    val history: RemoteHistory? = null,
    val model: String = "",
    val usage: RemoteModelUsage? = null,
    @SerialName("finish_reason") val finishReason: String? = null
)

@Serializable
data class RemoteModelCatalogItem(val id: String, val name: String = "")

@Serializable
data class RemoteModelGroups(
    @SerialName("openai_chat") val openAiChat: List<RemoteModelCatalogItem> = emptyList(),
    @SerialName("openai_image") val openAiImage: List<RemoteModelCatalogItem> = emptyList(),
    @SerialName("free_test") val freeTest: List<RemoteModelCatalogItem> = emptyList()
)

@Serializable
data class RemoteModelCatalogResponse(
    val ok: Boolean = false,
    val groups: RemoteModelGroups = RemoteModelGroups(),
    @SerialName("updated_at") val updatedAt: String = ""
)
