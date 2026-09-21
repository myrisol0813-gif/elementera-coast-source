package com.elementeracoast.app.core.remote

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class RemoteDailyComment(
    val id: String,
    val author: String = "owner",
    val text: String = "",
    @SerialName("model_id") val modelId: String? = null,
    val usage: RemoteModelUsage? = null,
    @SerialName("created_at") val createdAt: String = ""
)

@Serializable
data class RemoteDailyMoment(
    val id: String,
    val date: String = "",
    val author: String = "owner",
    val source: String = "manual",
    val status: String = "published",
    val text: String = "",
    @SerialName("conversation_id") val conversationId: String? = null,
    @SerialName("source_turn_id") val sourceTurnId: String? = null,
    val surface: String = "",
    @SerialName("model_label") val modelLabel: String? = null,
    @SerialName("model_nickname") val modelNickname: String? = null,
    val symbol: String = "",
    @SerialName("display_author") val displayAuthor: String = "",
    @SerialName("created_at") val createdAt: String = "",
    @SerialName("updated_at") val updatedAt: String = "",
    val liked: Boolean = false,
    @SerialName("like_count") val likeCount: Int = 0,
    val comments: List<RemoteDailyComment> = emptyList()
)

@Serializable
data class RemoteDailyMomentListResponse(
    val ok: Boolean = false,
    val moments: List<RemoteDailyMoment> = emptyList()
)

@Serializable
data class RemoteDailyMomentResponse(
    val ok: Boolean = false,
    val moment: RemoteDailyMoment
)

@Serializable
data class RemoteDailyMomentCreateRequest(
    val date: String,
    val text: String,
    val status: String = "published"
)

@Serializable
data class RemoteDailyMomentPatchRequest(
    val date: String? = null,
    val text: String? = null,
    val reason: String? = null
)

@Serializable
data class RemoteDailyCommentRequest(
    val text: String,
    val id: String? = null
)

@Serializable
data class RemoteDailyDiary(
    val id: String,
    val date: String = "",
    val author: String = "owner",
    val source: String = "manual",
    val weather: String = "未标注",
    val mood: String = "未标注",
    val tags: List<String> = emptyList(),
    val text: String = "",
    @SerialName("conversation_id") val conversationId: String? = null,
    @SerialName("source_turn_id") val sourceTurnId: String? = null,
    val surface: String = "",
    @SerialName("model_label") val modelLabel: String? = null,
    @SerialName("model_nickname") val modelNickname: String? = null,
    val symbol: String = "",
    @SerialName("display_author") val displayAuthor: String = "",
    @SerialName("created_at") val createdAt: String = "",
    @SerialName("updated_at") val updatedAt: String = ""
)

@Serializable
data class RemoteDailyDiaryListResponse(
    val ok: Boolean = false,
    val diaries: List<RemoteDailyDiary> = emptyList()
)

@Serializable
data class RemoteDailyDiaryResponse(
    val ok: Boolean = false,
    val diary: RemoteDailyDiary
)

@OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)
@Serializable
data class RemoteDailyDiaryCreateRequest(
    val date: String,
    val weather: String = "未标注",
    val mood: String = "未标注",
    val tags: List<String> = emptyList(),
    val text: String,
    @SerialName("conflict_mode")
    @kotlinx.serialization.EncodeDefault(kotlinx.serialization.EncodeDefault.Mode.ALWAYS)
    val conflictMode: String = "append"
)

@Serializable
data class RemoteDailyDiaryPatchRequest(
    val date: String? = null,
    val weather: String? = null,
    val mood: String? = null,
    val tags: List<String>? = null,
    val text: String? = null
)

@Serializable
data class RemoteDailyProfilePatch(
    @SerialName("owner_avatar_dataurl") val ownerAvatarDataUrl: String? = null,
    @SerialName("model_partner_avatar_dataurl") val modelPartnerAvatarDataUrl: String? = null,
    @SerialName("moment_cover_dataurl") val momentCoverDataUrl: String? = null,
    @SerialName("model_partner_display_name") val modelPartnerDisplayName: String? = null
)

@Serializable
data class RemoteDailyProfileUpdateRequest(val profile: RemoteDailyProfilePatch)

@OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)
@Serializable
data class RemoteDailyModelPartnerCommentRequest(
    @kotlinx.serialization.EncodeDefault(kotlinx.serialization.EncodeDefault.Mode.ALWAYS)
    val mode: String = "instant"
)

@Serializable
data class RemoteDailyModelPartnerCommentResult(
    val ok: Boolean = false,
    val moment: RemoteDailyMoment,
    val comment: RemoteDailyComment? = null,
    val model: String = ""
)
