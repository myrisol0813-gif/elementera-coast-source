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
        val knownOrigin = origin in knownEditions && applicationId in knownEditions
        // Known editions share a reversible daily identity adapter for both workspaces.
        val supported = when {
            sameEdition -> CoastTransferCodec.supportedModules
            knownOrigin -> CoastTransferCodec.supportedModules
            !localSource -> setOf("chat", "calendar", "model_profile")
            else -> setOf("chat", "calendar")
        }
        return declared.intersect(supported)
    }

    private fun verifyMeaningful(raw: JsonElement, encoded: JsonElement?, path: String) {
        val mismatches = linkedSetOf<String>()
        val limit = 8
        fun visit(value: JsonElement, restored: JsonElement?, location: String) {
            if (mismatches.size >= limit) return
            if (restored == null && (value == JsonNull || value == JsonPrimitive("") || value == JsonPrimitive(false) ||
                (value is JsonArray && value.isEmpty()) || (value is JsonObject && value.isEmpty()))) return
            when (value) {
                is JsonObject -> if (restored is JsonObject) {
                    value.forEach { (key, item) -> visit(item, restored[key], "$location.$key") }
                } else { mismatches.add(location) }
                is JsonArray -> if (restored is JsonArray && restored.size == value.size) {
                    value.forEachIndexed { i, item -> visit(item, restored[i], "$location[]") }
                } else { mismatches.add(location) }
                else -> if (value != restored) { mismatches.add(location) }
            }
        }
        visit(raw, encoded, path)
        require(mismatches.isEmpty()) {
            "目标不能完整保留以下字段（最多显示 8 处）：\n" + mismatches.joinToString("\n")
        }
    }

    private fun decodeSelected(payload: JsonObject, applicationId: String, modules: Set<String>): LocalBackupPayload {
        require(modules.isNotEmpty() && availableModules(payload, applicationId).containsAll(modules)) {
            "请选择目标已支持且数据包中包含的模块。"
        }
        val daily = payload
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
        // A fresh linked calendar may use a matching existing window or one staged
        // in this transaction. Never attach it to a conflicting imported window.
        val targetChats = conversations.associateBy { it.conversation.id }
        val sourceChats = incoming.conversations.associateBy { it.conversation.id }
        val oldCalendarIds = current.calendar.map { it.jsonObject.getValue("id").jsonPrimitive.content }.toSet()
        if ("calendar" in modules) incoming.calendar.forEach { item ->
            val row = item.jsonObject
            if (row.getValue("id").jsonPrimitive.content !in oldCalendarIds) {
                row["conversation_id"]?.jsonPrimitive?.contentOrNull?.let { id ->
                    val target = requireNotNull(targetChats[id]) { "请先恢复日历关联的原窗口。" }
                    require(sourceChats[id]?.let { it == target } != false) { "日历关联窗口存在内容冲突，未恢复。" }
                    val turn = row["source_turn_id"]?.jsonPrimitive?.contentOrNull
                    require(turn == null || target.history.turns.any { it.id == turn }) { "日历关联的原轮次不存在，未恢复。" }
                }
            }
        }
        val moments = if ("daily" in modules) combine("moments", current.moments, incoming.moments) { it.id } else current.moments
        val diaries = if ("daily" in modules) combine("diaries", current.diaries, incoming.diaries) { it.id } else current.diaries
        if("daily" in modules){
            fun checkLink(parent:String?,turn:String?){
                require(parent!=null||turn==null){"日常来源轮次缺少窗口。"}
                if(parent!=null){
                    val target=requireNotNull(targetChats[parent]){"请先恢复日常关联的原窗口。"}
                    require(sourceChats[parent]?.let { it==target }!=false){"日常关联窗口存在内容冲突。"}
                    require(turn==null||target.history.turns.any { it.id==turn }){"日常关联原轮次不存在。"}
                }
            }
            val oldMoments=current.moments.map{it.id}.toSet();val oldDiaries=current.diaries.map{it.id}.toSet()
            incoming.moments.filter{it.id !in oldMoments}.forEach{checkLink(it.conversationId,it.sourceTurnId)}
            incoming.diaries.filter{it.id !in oldDiaries}.forEach{checkLink(it.conversationId,it.sourceTurnId)}
        }
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
        return store.atomic { staged -> restoreStaged(bytes,applicationId,modules,staged) }
    }

    internal fun restoreStaged(bytes:ByteArray,applicationId:String,modules:Set<String>,staged:LocalPersistence):LocalRestorePreview {
            val payload=CoastTransferCodec.decode(bytes)
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
            return p.preview
    }
}
