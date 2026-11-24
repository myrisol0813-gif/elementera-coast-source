package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.remote.*
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*
import java.time.Instant

/** Portable records, not a dump of arbitrary persistence keys or account storage. */
@Serializable
internal data class LocalBackupConversation(val conversation: RemoteConversation, val history: RemoteHistory)

@Serializable
internal data class LocalBackupPayload(
    val applicationId: String,
    val exportedAt: String,
    val conversations: List<LocalBackupConversation>,
    val profile: RemoteProfile?,
    val dailyProfile: RemoteDailyProfile?,
    val moments: List<RemoteDailyMoment>,
    val diaries: List<RemoteDailyDiary>,
    val calendar: JsonArray
)

internal data class LocalBackupPreview(
    val conversations: Int,
    val turns: Int,
    val variants: Int,
    val moments: Int,
    val diaries: Int,
    val calendar: Int,
    val existingConversationIds: Set<String>,
    val conflictingConversationIds: Set<String>
)

/**
 * First recoverable-format boundary. Reads are strict so corrupt local records cannot
 * silently become empty histories in an apparently successful backup.
 * Decode/preview deliberately perform no writes; the restore transaction is separate.
 */
internal object LocalBackupArchive {
    const val FORMAT = CoastTransferCodec.FORMAT
    const val VERSION = CoastTransferCodec.VERSION
    const val MAX_BYTES = CoastTransferCodec.MAX_BYTES
    val included = listOf("chat_histories_and_variants", "model_profile", "daily_profile", "moments", "diaries", "calendar")
    val excluded = listOf("provider_credentials", "oauth_credentials", "server_credentials", "provider_configuration",
        "device_appearance_and_settings", "local_background_font_files", "model_echo", "attachments_and_voice",
        "memory_and_worldbook", "vault_and_library", "tool_logs", "other_unimplemented_modules")
    private val json = Json { encodeDefaults = true; ignoreUnknownKeys = false }
    private val safeId = Regex("[A-Za-z0-9_.:-]{1,160}")

    fun capture(store: LocalPersistence, applicationId: String, now: Instant = Instant.now()): LocalBackupPayload = store.readConsistent { stable ->
        val cache = RemoteCacheStore(stable, strictReads = true)
        val data = LocalBackupPayload(applicationId, now.toString(),
            cache.conversations().map { c ->
                LocalBackupConversation(c, cache.history(c.id) ?: error("聊天历史缺失，未生成不完整的备份。"))
            }, cache.profile(), cache.dailyProfile(), cache.dailyMoments(), cache.dailyDiaries(),
            LocalCalendarStore(stable).snapshot())
        validate(data)
        data
    }

    fun encode(payload: LocalBackupPayload): ByteArray {
        validate(payload)
        val value = json.encodeToJsonElement(LocalBackupPayload.serializer(), payload).jsonObject
        return CoastTransferCodec.encode(JsonObject(value + mapOf(
            "workspace" to JsonPrimitive("local"),
            "includedModules" to JsonArray(listOf("chat", "calendar", "daily", "model_profile").map(::JsonPrimitive))
        )))
    }

    // Full local modules are typed by edition. The generic wire reader is unrestricted.
    fun decode(bytes: ByteArray, applicationId: String): LocalBackupPayload {
        val payload = CoastTransferCodec.decode(bytes)
        require(payload.getValue("applicationId").jsonPrimitive.content == applicationId &&
            payload.getValue("workspace").jsonPrimitive.content == "local") {
            "完整本机模块恢复暂需同应用；通用聊天与日历迁移另走模块选择。"
        }
        require(payload.getValue("includedModules").jsonArray.map { it.jsonPrimitive.content }.toSet() == CoastTransferCodec.supportedModules)
        val value = JsonObject(payload.filterKeys { it !in setOf("workspace", "includedModules") })
        return json.decodeFromJsonElement(LocalBackupPayload.serializer(), value).also(::validate)
    }

    fun preview(incoming: LocalBackupPayload, existing: LocalBackupPayload): LocalBackupPreview {
        validate(incoming); validate(existing)
        require(incoming.applicationId == existing.applicationId)
        val old = existing.conversations.associateBy { it.conversation.id }
        val duplicates = incoming.conversations.filter { it.conversation.id in old }
        val conflicts = duplicates.filter { old[it.conversation.id] != it }
        val turns = incoming.conversations.flatMap { it.history.turns }
        return LocalBackupPreview(incoming.conversations.size, turns.size,
            turns.sumOf { it.user.variants.size + it.assistant.variantsByUserVariant.values.sumOf { v -> v.size } },
            incoming.moments.size, incoming.diaries.size, incoming.calendar.size,
            duplicates.map { it.conversation.id }.toSet(), conflicts.map { it.conversation.id }.toSet())
    }

    private fun unique(ids: List<String>) {
        require(ids.all { safeId.matches(it) } && ids.distinct().size == ids.size) { "存在无效或重复的记录 ID。" }
    }

    internal fun validate(data: LocalBackupPayload) {
        require(data.applicationId in setOf("com.elementeracoast.app", "com.elementeracoast.source"))
        Instant.parse(data.exportedAt)
        data.profile?.updatedAt?.let { require(it>=0) { "模型资料更新时间无效。" } }
        unique(data.conversations.map { it.conversation.id })
        data.conversations.forEach { row ->
            require(row.conversation.roomType in setOf("main", "radio", "lighthouse"))
            val h = row.history
            require(h.version == 4 && h.conversationId == row.conversation.id) { "聊天历史版本或所属窗口不一致。" }
            unique(h.turns.map { it.id })
            h.turns.forEach { t ->
                val user = t.user
                require(if (user.variants.isEmpty()) user.active == 0 else user.active in user.variants.indices)
                unique(user.variants.map { it.id } + t.assistant.variantsByUserVariant.values.flatten().map { it.id })
                fun validKey(key: String): Boolean = key.toIntOrNull()?.let { it >= 0 && it.toString() == key && it < user.variants.size.coerceAtLeast(1) } == true
                require(t.assistant.variantsByUserVariant.keys.all(::validKey))
                require(t.assistant.activeByUserVariant.all { (key, index) ->
                    val variants = t.assistant.variantsByUserVariant[key].orEmpty()
                    validKey(key) && if (variants.isEmpty()) index == 0 else index in variants.indices
                }) { "聊天变体索引无效。" }
            }
        }
        unique(data.moments.map { it.id }); unique(data.diaries.map { it.id })
        unique(data.moments.flatMap { it.comments }.map { it.id })
        val owner = if (data.applicationId == "com.elementeracoast.source") "owner" else "xiaohan"
        data.moments.forEach { moment ->
            require(moment.likeCount >= 0)
            moment.likes?.let { likes ->
                unique(likes.map { it.actor })
                require(likes.size == moment.likeCount && moment.liked == likes.any { it.actor == owner }) { "点赞明细与数量不一致。" }
                likes.forEach { Instant.parse(it.createdAt) }
            }
        }
        LocalCalendarStore.validateBackup(data.calendar)
    }

}
