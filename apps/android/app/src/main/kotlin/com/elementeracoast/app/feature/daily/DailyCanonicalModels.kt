package com.elementeracoast.app.feature.daily

data class DailyUsage(
    val promptTokens: Long? = null,
    val completionTokens: Long? = null,
    val reasoningTokens: Long? = null,
    val cachedTokens: Long? = null,
    val totalTokens: Long? = null
)

data class DailyComment(
    val id: String,
    val author: String,
    val text: String,
    val modelId: String? = null,
    val usage: DailyUsage? = null,
    val createdAt: String = ""
)

data class DailyMoment(
    val id: String,
    val date: String,
    val author: String,
    val source: String,
    val text: String,
    val displayAuthor: String,
    val modelLabel: String? = null,
    val symbol: String = "",
    val createdAt: String = "",
    val updatedAt: String = "",
    val liked: Boolean = false,
    val likeCount: Int = 0,
    val comments: List<DailyComment> = emptyList()
) {
    val isHumanOwner: Boolean get() = author == "owner"
}

data class DailyDiary(
    val id: String,
    val date: String,
    val author: String,
    val source: String,
    val weather: String,
    val mood: String,
    val tags: List<String>,
    val text: String,
    val displayAuthor: String,
    val modelLabel: String? = null,
    val symbol: String = "",
    val createdAt: String = "",
    val updatedAt: String = ""
)

data class DailyProfile(
    val ownerAvatarDataUrl: String = "",
    val modelPartnerAvatarDataUrl: String = "",
    val momentCoverDataUrl: String = "",
    val modelPartnerDisplayName: String = "另一位屋主",
    val updatedAt: String? = null
)

data class DailySnapshot(
    val moments: List<DailyMoment> = emptyList(),
    val diaries: List<DailyDiary> = emptyList(),
    val profile: DailyProfile = DailyProfile()
)

enum class DailyProfileImageField { HumanOwnerAvatar, ModelPartnerAvatar, MomentCover }
