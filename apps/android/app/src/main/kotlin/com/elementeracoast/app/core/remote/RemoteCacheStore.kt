package com.elementeracoast.app.core.remote

import com.elementeracoast.app.core.local.LocalPersistence
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

class RemoteCacheStore(
    private val persistence: LocalPersistence,
    private val json: Json = Json { ignoreUnknownKeys = true; explicitNulls = false; encodeDefaults = false }
) {
    fun conversations(): List<RemoteConversation> = decode(KEY_CONVERSATIONS, ListSerializer(RemoteConversation.serializer())) ?: emptyList()
    fun putConversations(value: List<RemoteConversation>) = put(KEY_CONVERSATIONS, ListSerializer(RemoteConversation.serializer()), value)

    fun history(id: String): RemoteHistory? = decode(historyKey(id), RemoteHistory.serializer())
    fun putHistory(id: String, value: RemoteHistory) = put(historyKey(id), RemoteHistory.serializer(), value)
    fun removeHistory(id: String) = persistence.remove(historyKey(id))

    fun profile(): RemoteProfile? = decode(KEY_PROFILE, RemoteProfile.serializer())
    fun putProfile(value: RemoteProfile) = put(KEY_PROFILE, RemoteProfile.serializer(), value)

    fun dailyProfile(): RemoteDailyProfile? = decode(KEY_DAILY_PROFILE, RemoteDailyProfile.serializer())
    fun putDailyProfile(value: RemoteDailyProfile) = put(KEY_DAILY_PROFILE, RemoteDailyProfile.serializer(), value)

    fun dailyMoments(): List<RemoteDailyMoment> = decode(KEY_DAILY_MOMENTS, ListSerializer(RemoteDailyMoment.serializer())) ?: emptyList()
    fun putDailyMoments(value: List<RemoteDailyMoment>) = put(KEY_DAILY_MOMENTS, ListSerializer(RemoteDailyMoment.serializer()), value)

    fun dailyDiaries(): List<RemoteDailyDiary> = decode(KEY_DAILY_DIARIES, ListSerializer(RemoteDailyDiary.serializer())) ?: emptyList()
    fun putDailyDiaries(value: List<RemoteDailyDiary>) = put(KEY_DAILY_DIARIES, ListSerializer(RemoteDailyDiary.serializer()), value)

    fun memoryEntries(type: String): List<RemoteMemoryEntry> = decode(memoryEntriesKey(type), ListSerializer(RemoteMemoryEntry.serializer())) ?: emptyList()
    fun putMemoryEntries(type: String, value: List<RemoteMemoryEntry>) = put(memoryEntriesKey(type), ListSerializer(RemoteMemoryEntry.serializer()), value)

    fun memoryPockets(conversationId: String): List<RemoteMemoryPocket> = decode(memoryPocketsKey(conversationId), ListSerializer(RemoteMemoryPocket.serializer())) ?: emptyList()
    fun putMemoryPockets(conversationId: String, value: List<RemoteMemoryPocket>) = put(memoryPocketsKey(conversationId), ListSerializer(RemoteMemoryPocket.serializer()), value)

    fun worldbookEntries(): List<RemoteWorldbookEntry> = decode(KEY_WORLDBOOK, ListSerializer(RemoteWorldbookEntry.serializer())) ?: emptyList()
    fun putWorldbookEntries(value: List<RemoteWorldbookEntry>) = put(KEY_WORLDBOOK, ListSerializer(RemoteWorldbookEntry.serializer()), value)

    fun customInstructions(): RemoteCustomInstructions? = decode(KEY_CUSTOM_INSTRUCTIONS, RemoteCustomInstructions.serializer())
    fun putCustomInstructions(value: RemoteCustomInstructions?) {
        if (value == null) persistence.remove(KEY_CUSTOM_INSTRUCTIONS)
        else put(KEY_CUSTOM_INSTRUCTIONS, RemoteCustomInstructions.serializer(), value)
    }

    fun modelCatalog(): RemoteModelCatalogResponse? = decode(KEY_MODELS, RemoteModelCatalogResponse.serializer())
    fun putModelCatalog(value: RemoteModelCatalogResponse) = put(KEY_MODELS, RemoteModelCatalogResponse.serializer(), value)

    private fun historyKey(id: String): String = "remote.history.${safe(id)}"
    private fun memoryEntriesKey(type: String): String = "remote.cache.memory-entries.${safe(type)}.v1"
    private fun memoryPocketsKey(id: String): String = "remote.cache.memory-pockets.${safe(id)}.v1"
    private fun safe(value: String): String = value.replace(Regex("[^A-Za-z0-9_.:-]"), "_")

    private fun <T> decode(key: String, serializer: kotlinx.serialization.KSerializer<T>): T? {
        val raw = persistence.get(key)
        if (raw.isBlank()) return null
        return runCatching { json.decodeFromString(serializer, raw) }.getOrNull()
    }

    private fun <T> put(key: String, serializer: kotlinx.serialization.KSerializer<T>, value: T) {
        persistence.put(key, json.encodeToString(serializer, value))
    }

    companion object {
        private const val KEY_CONVERSATIONS = "remote.cache.conversations.v1"
        private const val KEY_PROFILE = "remote.cache.profile.v1"
        private const val KEY_DAILY_PROFILE = "remote.cache.daily-profile.v1"
        private const val KEY_DAILY_MOMENTS = "remote.cache.daily-moments.v1"
        private const val KEY_DAILY_DIARIES = "remote.cache.daily-diaries.v1"
        private const val KEY_WORLDBOOK = "remote.cache.worldbook.v1"
        private const val KEY_CUSTOM_INSTRUCTIONS = "remote.cache.custom-instructions.v1"
        private const val KEY_MODELS = "remote.cache.models.v1"
    }
}
