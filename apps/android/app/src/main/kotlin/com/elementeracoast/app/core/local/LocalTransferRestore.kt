package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.remote.*
import kotlinx.serialization.json.*

internal data class LocalRestoreCount(val ready: Int, val existing: Int, val conflicts: Int)
internal data class LocalRestorePreview(
    val source: String, val counts: Map<String, LocalRestoreCount>, val unsupportedModules: Set<String>
)

/** The target is local storage only. Preview is read-only; commit recomputes against the live generation. */
internal object LocalTransferRestore {
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    fun availableModules(payload: JsonObject, applicationId: String): Set<String> {
        val declared = payload.getValue("includedModules").jsonArray.map { it.jsonPrimitive.content }.toSet()
        val origin = payload.getValue("applicationId").jsonPrimitive.content
        val localSource = payload.getValue("workspace").jsonPrimitive.content == "local"
        val sameEdition = origin == applicationId && localSource
        val knownEditions = setOf("com.elementeracoast.app", "com.elementeracoast.source")
        val crossEdition = localSource && origin in knownEditions && applicationId in knownEditions
        // Known local editions have a reversible daily identity adapter below.
        // Cloud daily data still requires a lossless server adapter.
        val supported = when {
            sameEdition -> CoastTransferCodec.supportedModules
            crossEdition -> CoastTransferCodec.supportedModules
            !localSource -> setOf("chat", "calendar", "model_profile")
            else -> setOf("chat", "calendar")
        }
        return declared.intersect(supported)
    }

    private fun verifyMeaningful(raw: JsonElement, encoded: JsonElement?, path: String) {
        if (encoded == null && (raw == JsonNull || raw == JsonPrimitive("") || raw == JsonPrimitive(false) ||
            (raw is JsonArray && raw.isEmpty()) || (raw is JsonObject && raw.isEmpty()))) return
        when (raw) {
            is JsonObject -> {
                require(encoded is JsonObject) { "目标不能完整保留字段：$path" }
                raw.forEach { (key, value) -> verifyMeaningful(value, encoded[key], "$path.$key") }
            }
            is JsonArray -> {
                require(encoded is JsonArray && encoded.size == raw.size) { "目标不能完整保留列表：$path" }
                raw.forEachIndexed { i, value -> verifyMeaningful(value, encoded[i], "$path[]") }
            }
            else -> require(raw == encoded) { "目标不能完整保留字段：$path" }
        }
    }

    private fun adaptLocalDaily(payload: JsonObject, applicationId: String): JsonObject {
        val origin = payload.getValue("applicationId").jsonPrimitive.content
        if (origin == applicationId || payload.getValue("workspace").jsonPrimitive.content != "local") return payload
        val toPublic = applicationId == "com.elementeracoast.source"
        val privateFields = listOf("xiaohan_avatar_dataurl", "myri_avatar_dataurl", "myri_display_name")
        val publicFields = listOf("owner_avatar_dataurl", "model_partner_avatar_dataurl", "model_partner_display_name")
        val fields = if (toPublic) privateFields.zip(publicFields).toMap() else publicFields.zip(privateFields).toMap()
        val authors = if (toPublic) mapOf("xiaohan" to "owner", "myri" to "model_partner")
            else mapOf("owner" to "xiaohan", "model_partner" to "myri")
        fun author(value: JsonElement): JsonElement {
            val item = value.jsonObject
            val old = item["author"] ?: return item
            val next = authors[old.jsonPrimitive.content] ?: return item
            return JsonObject(item + ("author" to JsonPrimitive(next)))
        }
        val profile = payload.getValue("dailyProfile")
        val nextProfile = if (profile == JsonNull) JsonNull else {
            val entries = profile.jsonObject.entries.map { (key, value) -> (fields[key] ?: key) to value }
            require(entries.map { it.first }.distinct().size == entries.size) { "日常资料身份字段冲突。" }
            JsonObject(entries.toMap())
        }
        val moments = JsonArray(payload.getValue("moments").jsonArray.map { raw ->
            val item = author(raw).jsonObject
            val comments = item["comments"] ?: return@map item
            JsonObject(item + ("comments" to JsonArray(comments.jsonArray.map(::author))))
        })
        return JsonObject(payload + mapOf("dailyProfile" to nextProfile, "moments" to moments,
            "diaries" to JsonArray(payload.getValue("diaries").jsonArray.map(::author))))
    }

    private fun decodeSelected(payload: JsonObject, applicationId: String, modules: Set<String>): LocalBackupPayload {
        require(modules.isNotEmpty() && availableModules(payload, applicationId).containsAll(modules)) {
            "请选择目标已支持且数据包中包含的模块。"
        }
        val daily = if ("daily" in modules) adaptLocalDaily(payload, applicationId) else payload
        val raw = buildJsonObject {
            put("applicationId", applicationId); put("exportedAt", payload.getValue("exportedAt"))
            put("conversations", if ("chat" in modules) payload.getValue("conversations") else JsonArray(emptyList()))
            put("calendar", if ("calendar" in modules) payload.getValue("calendar") else JsonArray(emptyList()))
            put("profile", if ("model_profile" in modules) payload.getValue("profile") else JsonNull)
            put("dailyProfile", if ("daily" in modules) daily.getValue("dailyProfile") else JsonNull)
            put("moments", if ("daily" in modules) daily.getValue("moments") else JsonArray(emptyList()))
            put("diaries", if ("daily" in modules) daily.getValue("diaries") else JsonArray(emptyList()))
        }
        val data = json.decodeFromJsonElement(LocalBackupPayload.serializer(), raw)
        verifyMeaningful(raw, json.encodeToJsonElement(LocalBackupPayload.serializer(), data), "payload")
        data.conversations.forEach { row ->
            require(row.conversation.deletedAt == null) { "已删除窗口不能直接恢复为活动窗口。" }
            row.history.turns.forEach { t ->
                (t.user.variants + t.assistant.variantsByUserVariant.values.flatten()).forEach { v ->
                    require(v.attachments.isEmpty() && v.dogtalkSnapshotId.isNullOrBlank()) { "含附件或跨窗快照的窗口暂不支持迁移；原件未被修改。" }
                }
            }
        }
        LocalBackupArchive.validate(data)
        return data
    }

    private data class Plan(val preview: LocalRestorePreview, val merged: LocalBackupPayload)

    private fun plan(payload: JsonObject, applicationId: String, modules: Set<String>, store: LocalPersistence): Plan {
        val incoming = decodeSelected(payload, applicationId, modules)
        val current = LocalBackupArchive.capture(store, applicationId)
        val counts = linkedMapOf<String, LocalRestoreCount>()
        fun <T> combine(key: String, old: List<T>, added: List<T>, id: (T) -> String): List<T> {
            if (key !in modules && key !in setOf("moments", "diaries")) return old
            val byId = old.associateBy(id)
            val existing = added.filter { id(it) in byId }
            val fresh = added.filter { id(it) !in byId }
            counts[key] = LocalRestoreCount(fresh.size, existing.size, existing.count { byId[id(it)] != it })
            return old + fresh
        }
        fun <T> profile(key: String, old: T?, added: T?): T? {
            if (added != null) counts[key] = LocalRestoreCount(if (old == null) 1 else 0,
                if (old == null) 0 else 1, if (old != null && old != added) 1 else 0)
            return old ?: added
        }
        val conversations = combine("chat", current.conversations, incoming.conversations) { it.conversation.id }
        val calendar = combine("calendar", current.calendar.toList(), incoming.calendar.toList()) { it.jsonObject.getValue("id").jsonPrimitive.content }
        val moments = if ("daily" in modules) combine("moments", current.moments, incoming.moments) { it.id } else current.moments
        val diaries = if ("daily" in modules) combine("diaries", current.diaries, incoming.diaries) { it.id } else current.diaries
        val merged = current.copy(conversations = conversations, calendar = JsonArray(calendar), moments = moments, diaries = diaries,
            profile = profile("model_profile",current.profile,incoming.profile), dailyProfile = profile("daily_profile",current.dailyProfile,incoming.dailyProfile))
        LocalBackupArchive.validate(merged)
        val declared = payload.getValue("includedModules").jsonArray.map { it.jsonPrimitive.content }.toSet()
        return Plan(LocalRestorePreview(payload.getValue("workspace").jsonPrimitive.content, counts,
            declared - availableModules(payload, applicationId)), merged)
    }

    fun preview(bytes: ByteArray, applicationId: String, modules: Set<String>, store: LocalPersistence): LocalRestorePreview {
        val payload = CoastTransferCodec.decode(bytes)
        return store.readConsistent { plan(payload, applicationId, modules, it).preview }
    }

    fun restore(bytes: ByteArray, applicationId: String, modules: Set<String>, store: LocalPersistence): LocalRestorePreview {
        val payload = CoastTransferCodec.decode(bytes)
        return store.atomic { staged ->
            val p = plan(payload, applicationId, modules, staged)
            val data = p.merged
            val cache = RemoteCacheStore(staged, strictReads = true)
            val known = cache.conversations().map { it.id }.toSet()
            if ("chat" in modules) {
                data.conversations.filter { it.conversation.id !in known }.forEach { cache.putHistory(it.conversation.id, it.history) }
                cache.putConversations(data.conversations.map { it.conversation })
            }
            if ("calendar" in modules) LocalCalendarStore(staged).restoreSnapshot(data.calendar)
            if ("daily" in modules) {
                data.dailyProfile?.let(cache::putDailyProfile)
                cache.putDailyMoments(data.moments); cache.putDailyDiaries(data.diaries)
            }
            if ("model_profile" in modules) data.profile?.let(cache::putProfile)
            // Re-open the staged typed data before publishing the generation.
            val check = LocalBackupArchive.capture(staged, applicationId)
            require(check.copy(exportedAt = data.exportedAt) == data) { "恢复结果与预览不一致；原资料未切换。" }
            p.preview
        }
    }
}
