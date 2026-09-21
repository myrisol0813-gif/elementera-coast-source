package com.elementeracoast.app.feature.daily

import com.elementeracoast.app.core.network.CoastApiClient
import com.elementeracoast.app.core.remote.RemoteCacheStore
import com.elementeracoast.app.core.remote.RemoteDailyComment
import com.elementeracoast.app.core.remote.RemoteDailyDiary
import com.elementeracoast.app.core.remote.RemoteDailyDiaryCreateRequest
import com.elementeracoast.app.core.remote.RemoteDailyDiaryPatchRequest
import com.elementeracoast.app.core.remote.RemoteDailyMoment
import com.elementeracoast.app.core.remote.RemoteDailyMomentCreateRequest
import com.elementeracoast.app.core.remote.RemoteDailyMomentPatchRequest
import com.elementeracoast.app.core.remote.RemoteDailyProfile
import com.elementeracoast.app.core.remote.RemoteDailyProfilePatch
import com.elementeracoast.app.core.remote.RemoteModelUsage
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

interface DailyRepository {
    val snapshot: StateFlow<DailySnapshot>
    fun cachedProfile(): DailyProfile
    suspend fun refresh(): DailySnapshot
    suspend fun refreshProfile(): DailyProfile
    suspend fun createMoment(date: String, text: String): DailyMoment
    suspend fun patchMoment(id: String, date: String? = null, text: String? = null): DailyMoment
    suspend fun deleteMoment(id: String)
    suspend fun setMomentLike(id: String, liked: Boolean): DailyMoment
    suspend fun addMomentComment(id: String, text: String): DailyMoment
    suspend fun deleteMomentComment(id: String, commentId: String): DailyMoment
    suspend fun requestModelPartnerComment(id: String): DailyMoment
    suspend fun createDiary(date: String, weather: String, mood: String, tags: List<String>, text: String): DailyDiary
    suspend fun patchDiary(id: String, date: String, weather: String, mood: String, tags: List<String>, text: String): DailyDiary
    suspend fun deleteDiary(id: String)
    suspend fun updateProfile(field: DailyProfileImageField, dataUrl: String): DailyProfile
    suspend fun updateModelPartnerDisplayName(value: String): DailyProfile
}

class DefaultDailyRepository(
    private val api: CoastApiClient,
    private val cache: RemoteCacheStore
) : DailyRepository {
    private val _snapshot = MutableStateFlow(
        DailySnapshot(
            moments = cache.dailyMoments().map(DailyMapper::moment),
            diaries = cache.dailyDiaries().map(DailyMapper::diary),
            profile = DailyMapper.profile(cache.dailyProfile() ?: RemoteDailyProfile())
        )
    )
    override val snapshot: StateFlow<DailySnapshot> = _snapshot.asStateFlow()

    override fun cachedProfile(): DailyProfile = _snapshot.value.profile

    override suspend fun refresh(): DailySnapshot {
        val moments = api.listDailyMoments()
        val diaries = api.listDailyDiaries()
        val profile = api.getDailyProfile()
        cache.putDailyMoments(moments)
        cache.putDailyDiaries(diaries)
        cache.putDailyProfile(profile)
        return DailySnapshot(
            moments = moments.map(DailyMapper::moment),
            diaries = diaries.map(DailyMapper::diary),
            profile = DailyMapper.profile(profile)
        ).also { _snapshot.value = it }
    }

    override suspend fun refreshProfile(): DailyProfile {
        val profile = api.getDailyProfile()
        cache.putDailyProfile(profile)
        val mapped = DailyMapper.profile(profile)
        _snapshot.update { it.copy(profile = mapped) }
        return mapped
    }

    override suspend fun createMoment(date: String, text: String): DailyMoment =
        replaceMoment(api.createDailyMoment(RemoteDailyMomentCreateRequest(date = normalizeDate(date), text = text.trim())))

    override suspend fun patchMoment(id: String, date: String?, text: String?): DailyMoment =
        replaceMoment(api.patchDailyMoment(id, RemoteDailyMomentPatchRequest(date = date?.let(::normalizeDate), text = text?.trim())))

    override suspend fun deleteMoment(id: String) {
        api.deleteDailyMoment(id)
        val next = cache.dailyMoments().filterNot { it.id == id }
        cache.putDailyMoments(next)
        _snapshot.update { state -> state.copy(moments = state.moments.filterNot { it.id == id }) }
    }

    override suspend fun setMomentLike(id: String, liked: Boolean): DailyMoment = replaceMoment(api.setDailyMomentLike(id, liked))

    override suspend fun addMomentComment(id: String, text: String): DailyMoment = replaceMoment(api.addDailyMomentComment(id, text.trim()))

    override suspend fun deleteMomentComment(id: String, commentId: String): DailyMoment = replaceMoment(api.deleteDailyMomentComment(id, commentId))

    override suspend fun requestModelPartnerComment(id: String): DailyMoment = replaceMoment(api.requestDailyModelPartnerComment(id).moment)

    override suspend fun createDiary(date: String, weather: String, mood: String, tags: List<String>, text: String): DailyDiary =
        replaceDiary(
            api.createDailyDiary(
                RemoteDailyDiaryCreateRequest(
                    date = normalizeDate(date),
                    weather = weather.trim().ifBlank { "未标注" },
                    mood = mood.trim().ifBlank { "未标注" },
                    tags = normalizeTags(tags),
                    text = text.trim(),
                    conflictMode = "append"
                )
            )
        )

    override suspend fun patchDiary(id: String, date: String, weather: String, mood: String, tags: List<String>, text: String): DailyDiary =
        replaceDiary(
            api.patchDailyDiary(
                id,
                RemoteDailyDiaryPatchRequest(
                    date = normalizeDate(date),
                    weather = weather.trim().ifBlank { "未标注" },
                    mood = mood.trim().ifBlank { "未标注" },
                    tags = normalizeTags(tags),
                    text = text.trim()
                )
            )
        )

    override suspend fun deleteDiary(id: String) {
        api.deleteDailyDiary(id)
        val next = cache.dailyDiaries().filterNot { it.id == id }
        cache.putDailyDiaries(next)
        _snapshot.update { state -> state.copy(diaries = state.diaries.filterNot { it.id == id }) }
    }

    override suspend fun updateProfile(field: DailyProfileImageField, dataUrl: String): DailyProfile {
        val patch = when (field) {
            DailyProfileImageField.HumanOwnerAvatar -> RemoteDailyProfilePatch(xiaohanAvatarDataUrl = dataUrl)
            DailyProfileImageField.ModelPartnerAvatar -> RemoteDailyProfilePatch(myriAvatarDataUrl = dataUrl)
            DailyProfileImageField.MomentCover -> RemoteDailyProfilePatch(momentCoverDataUrl = dataUrl)
        }
        return persistProfilePatch(patch)
    }

    override suspend fun updateModelPartnerDisplayName(value: String): DailyProfile =
        persistProfilePatch(RemoteDailyProfilePatch(myriDisplayName = value.trim().ifBlank { "另一位屋主" }.take(80)))

    private suspend fun persistProfilePatch(patch: RemoteDailyProfilePatch): DailyProfile {
        val profile = api.putDailyProfile(patch)
        cache.putDailyProfile(profile)
        val mapped = DailyMapper.profile(profile)
        _snapshot.update { it.copy(profile = mapped) }
        return mapped
    }

    private fun replaceMoment(remote: RemoteDailyMoment): DailyMoment {
        val cached = cache.dailyMoments()
        val next = if (cached.any { it.id == remote.id }) cached.map { if (it.id == remote.id) remote else it } else listOf(remote) + cached
        cache.putDailyMoments(next)
        return DailyMapper.moment(remote).also { mapped ->
            _snapshot.update { state ->
                val moments = if (state.moments.any { it.id == mapped.id }) state.moments.map { if (it.id == mapped.id) mapped else it } else listOf(mapped) + state.moments
                state.copy(moments = moments)
            }
        }
    }

    private fun replaceDiary(remote: RemoteDailyDiary): DailyDiary {
        val cached = cache.dailyDiaries()
        val next = if (cached.any { it.id == remote.id }) cached.map { if (it.id == remote.id) remote else it } else listOf(remote) + cached
        cache.putDailyDiaries(next)
        return DailyMapper.diary(remote).also { mapped ->
            _snapshot.update { state ->
                val diaries = if (state.diaries.any { it.id == mapped.id }) state.diaries.map { if (it.id == mapped.id) mapped else it } else listOf(mapped) + state.diaries
                state.copy(diaries = diaries)
            }
        }
    }

    private fun normalizeDate(value: String): String = value.trim().replace('/', '-')
    private fun normalizeTags(value: List<String>): List<String> = value.map(String::trim).filter(String::isNotBlank).distinct().take(20)
}

internal object DailyMapper {
    fun usage(value: RemoteModelUsage?) = value?.let {
        DailyUsage(
            promptTokens = it.promptTokens,
            completionTokens = it.completionTokens,
            reasoningTokens = it.reasoningTokens,
            cachedTokens = it.cachedTokens,
            totalTokens = it.totalTokens
        )
    }

    fun comment(value: RemoteDailyComment) = DailyComment(
        id = value.id,
        author = value.author,
        text = value.text,
        modelId = value.modelId,
        usage = usage(value.usage),
        createdAt = value.createdAt
    )

    fun moment(value: RemoteDailyMoment) = DailyMoment(
        id = value.id,
        date = value.date,
        author = value.author,
        source = value.source,
        text = value.text,
        displayAuthor = value.displayAuthor.ifBlank { if (value.author == "xiaohan") "屋主" else "另一位屋主" },
        modelLabel = value.modelLabel,
        symbol = value.symbol,
        createdAt = value.createdAt,
        updatedAt = value.updatedAt,
        liked = value.liked,
        likeCount = value.likeCount,
        comments = value.comments.map(::comment)
    )

    fun diary(value: RemoteDailyDiary) = DailyDiary(
        id = value.id,
        date = value.date,
        author = value.author,
        source = value.source,
        weather = value.weather,
        mood = value.mood,
        tags = value.tags,
        text = value.text,
        displayAuthor = value.displayAuthor.ifBlank { if (value.author == "xiaohan") "屋主" else "另一位屋主" },
        modelLabel = value.modelLabel,
        symbol = value.symbol,
        createdAt = value.createdAt,
        updatedAt = value.updatedAt
    )

    fun profile(value: RemoteDailyProfile) = DailyProfile(
        xiaohanAvatarDataUrl = value.xiaohanAvatarDataUrl,
        myriAvatarDataUrl = value.myriAvatarDataUrl,
        momentCoverDataUrl = value.momentCoverDataUrl,
        myriDisplayName = value.myriDisplayName.trim().ifBlank { "另一位屋主" },
        updatedAt = value.updatedAt
    )
}
