package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.remote.*
import com.elementeracoast.app.BuildConfig
import java.time.Instant
import java.util.UUID
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.*
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer

/**
 * In-process implementation of the shared Native data contract.
 * No server, socket, cookie, or cloud fallback. Unsupported operations fail explicitly.
 * The existing repositories, chat branching and UI remain the same.
 */
class LocalCoastTransport(private val store: LocalPersistence,
    private val providerCatalog: () -> RemoteModelCatalogResponse = { RemoteModelCatalogResponse(ok = true) }
) : Interceptor {
    private val cache = RemoteCacheStore(store)
    private val calendar = LocalCalendarStore(store)
    private val knowledge = LocalKnowledgeStore(store)
    private val memory = LocalMemoryStore(store)
    private val portraits = LocalPortraitStore(store)
    private val soil = LocalSoilStore(store)
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true; explicitNulls = false }
    private val media = "application/json; charset=utf-8".toMediaType()

    override fun intercept(chain: Interceptor.Chain): Response = synchronized(this) {
        val request = chain.request()
        // Never proceed to a real network, even for an unexpected host.
        try {
            if (request.url.host != HOST) failure(request, 403, "local_boundary", "本机模式禁止连接海岸服务器。")
            else route(request)
        } catch (error: LocalCalendarError) {
            failure(request, error.status, error.type, error.message.orEmpty())
        } catch (error: IllegalArgumentException) {
            failure(request, 400, "local_validation", error.message?.take(240) ?: "本机资料未通过校验。")
        } catch (_: Exception) {
            failure(request, 500, "local_storage_error", "本机读写失败，原始资料未自动转发到服务器。")
        }
    }

    private fun now() = Instant.now().toString()
    private fun id() = UUID.randomUUID().toString()
    private fun body(request: Request): JsonObject {
        val buffer = Buffer()
        request.body?.writeTo(buffer)
        val raw = buffer.readUtf8()
        return if (raw.isBlank()) JsonObject(emptyMap()) else json.parseToJsonElement(raw).jsonObject
    }
    private fun JsonObject.str(key: String): String? = (get(key) as? JsonPrimitive)?.contentOrNull
    private fun <T> element(serializer: KSerializer<T>, value: T) = json.encodeToJsonElement(serializer, value)
    private fun response(request: Request, code: Int, payload: JsonObject): Response = Response.Builder()
        .request(request).protocol(Protocol.HTTP_1_1).code(code)
        .message(if (code in 200..299) "OK" else "Local workspace")
        .body(payload.toString().toResponseBody(media)).build()
    private fun ok(request: Request, vararg entries: Pair<String, JsonElement>): Response =
        response(request, 200, JsonObject(mapOf("ok" to JsonPrimitive(true)) + entries.toMap()))
    private fun failure(request: Request, code: Int, type: String, message: String) =
        response(request, code, buildJsonObject {
            put("ok", false)
            putJsonObject("error") { put("type", type); put("message", message) }
        })
    private fun unsupported(request: Request) =
        failure(request, 501, "local_not_implemented", "该功能尚未接入本机执行层；不会回退到在线海岸。")
    private fun missing(request: Request) = failure(request, 404, "local_not_found", "本机记录不存在。")
    private fun <T> array(serializer: KSerializer<T>, values: List<T>) =
        JsonArray(values.map { element(serializer, it) })
    private fun conversationExists(id: String) = cache.conversations().any { it.id == id }

    private fun route(r: Request): Response {
        val path = r.url.encodedPath
        val method = r.method
        if (path == "/api/chat/conversations") {
            if (method == "GET") return ok(r, "conversations" to array(RemoteConversation.serializer(), cache.conversations()))
            if (method == "POST") {
                val b = body(r)
                val room = b.str("room_type").orEmpty().takeIf { it in setOf("main", "radio", "lighthouse") } ?: "main"
                val c = RemoteConversation(id(), b.str("title").orEmpty().trim().ifBlank { "新聊天" }, room, now(), now())
                cache.putHistory(c.id, RemoteHistory(conversationId = c.id, updatedAt = c.updatedAt ?: now()))
                cache.putConversations(listOf(c) + cache.conversations())
                return ok(r, "conversation" to element(RemoteConversation.serializer(), c))
            }
        }
        if (path.startsWith("/api/chat/conversations/")) {
            val cid = r.url.pathSegments.last()
            val all = cache.conversations()
            val current = all.firstOrNull { it.id == cid } ?: return missing(r)
            if (method == "PATCH") {
                val next = current.copy(title = body(r).str("title").orEmpty().trim().ifBlank { "新聊天" }, updatedAt = now())
                cache.putConversations(all.map { if (it.id == cid) next else it })
                return ok(r, "conversation" to element(RemoteConversation.serializer(), next))
            }
            if (method == "DELETE") {
                cache.putConversations(all.filterNot { it.id == cid })
                cache.removeHistory(cid)
                val oldSoil=soil.read()
                soil.write(LocalSoilStore.Rows(oldSoil.current.filterNot{it["conversation_id"]?.jsonPrimitive?.content==cid},oldSoil.history.filterNot{it["conversation_id"]?.jsonPrimitive?.content==cid}))
                return ok(r)
            }
        }
        if (path == "/api/chat/history") {
            val cid = r.url.queryParameter("conversation_id").orEmpty()
            if (!conversationExists(cid)) return missing(r)
            if (method == "GET") return ok(r, "source" to JsonPrimitive("local"),
                "history" to element(RemoteHistory.serializer(), cache.history(cid) ?: RemoteHistory(conversationId = cid)))
            if (method == "PUT") {
                val h = json.decodeFromJsonElement(RemoteHistory.serializer(), body(r))
                    .copy(conversationId = cid, updatedAt = now())
                cache.putHistory(cid, h)
                return ok(r, "source" to JsonPrimitive("local"), "history" to element(RemoteHistory.serializer(), h))
            }
        }
        if (path == "/api/chat/profile") {
            val profile = when (method) {
                "GET" -> cache.profile() ?: RemoteProfile()
                "PUT" -> json.decodeFromJsonElement(RemoteProfile.serializer(), body(r)).copy(updatedAt = System.currentTimeMillis()).also(cache::putProfile)
                else -> return unsupported(r)
            }
            return ok(r, "profile" to element(RemoteProfile.serializer(), profile))
        }
        if (path == "/api/models" && method == "GET")
            return response(r, 200, element(RemoteModelCatalogResponse.serializer(), providerCatalog()).jsonObject)
        if (path == "/api/chat/native-context" && method == "POST") {
            val request = json.decodeFromJsonElement(RemoteChatRequest.serializer(), body(r))
            if (!conversationExists(request.conversationId)) return missing(r)
            if (request.attachmentIds.isNotEmpty()) return unsupported(r)
            val budget = request.settings["contextBudget"]?.toLongOrNull()?.coerceAtLeast(1800) ?: 18000
            val room=cache.conversations().first { it.id==request.conversationId }.roomType
            val prepared=knowledge.context(request.messages,budget.coerceAtMost(Int.MAX_VALUE.toLong()).toInt(),if(room=="main")"main_chat" else room,request.conversationId)
            return response(r, 200, element(RemoteNativeChatContext.serializer(), RemoteNativeChatContext(
                ok = true,
                modelMessages = array(RemoteChatMessage.serializer(), prepared.messages),
                deskSlip = prepared.receipt
            )).jsonObject)
        }
        if (path == "/api/chat/native-echo" && method == "POST") {
            val b = body(r)
            val cid = b.str("conversation_id").orEmpty()
            val mid = b.str("message_id").orEmpty()
            if (!conversationExists(cid) || mid.isBlank()) return missing(r)
            val snapshot = b["snapshot"] ?: return unsupported(r)
            store.put("local.echo." + cid + "." + mid, snapshot.toString())
            return ok(r)
        }
        if(path=="/api/memory/entries"){
            if(method=="GET"){
                val type=r.url.queryParameter("entry_type")?:"memory"
                return ok(r,"entries" to array(RemoteMemoryEntry.serializer(),memory.entries(type)))
            }
            if(method=="POST")return ok(r,"entry" to element(RemoteMemoryEntry.serializer(),memory.save(null,json.decodeFromJsonElement(RemoteMemoryEntryWriteRequest.serializer(),body(r)))))
        }
        if(path.startsWith("/api/memory/entries/")&&r.url.pathSegments.size==4){
            val id=r.url.pathSegments.last()
            if(method=="PATCH")return ok(r,"entry" to element(RemoteMemoryEntry.serializer(),memory.save(id,json.decodeFromJsonElement(RemoteMemoryEntryWriteRequest.serializer(),body(r)))))
            if(method=="DELETE"){memory.delete(id);return ok(r)}
        }
        if(path=="/api/memory/pockets"&&method=="GET"){
            val cid=r.url.queryParameter("conversation_id").orEmpty()
            if(!conversationExists(cid))return missing(r)
            return ok(r,"pockets" to array(RemoteMemoryPocket.serializer(),memory.pockets(cid)))
        }
        if(path.startsWith("/api/memory/pockets/")&&r.url.pathSegments.size==5&&r.url.pathSegments.last()=="resolve"&&method=="POST"){
            return response(r,200,element(RemoteMemoryPocketResolveResponse.serializer(),memory.resolve(r.url.pathSegments[3],json.decodeFromJsonElement(RemoteMemoryPocketResolveRequest.serializer(),body(r)))).jsonObject)
        }
        val portraitModule=when(r.url.pathSegments.getOrNull(2)){
            "user-portrait"->"user_portrait"
            "global-excerpt"->"self_portrait"
            else->null
        }
        if(path.startsWith("/api/memory/")&&portraitModule!=null){
            val parts=r.url.pathSegments
            if(parts.size==3){
                if(method=="GET")return response(r,200,portraits.response(portraitModule))
                if(method=="PATCH")return response(r,200,portraits.patch(portraitModule,body(r)))
            }
            if(parts.size==5&&parts[3]=="candidates"){
                if(method=="PATCH")return response(r,200,portraits.confirm(portraitModule,parts[4],json.decodeFromJsonElement(RemoteGlobalExcerptConfirmRequest.serializer(),body(r))))
                if(method=="DELETE")return ok(r,"deleted" to JsonPrimitive(portraits.discard(portraitModule,parts[4])))
            }
            return unsupported(r)
        }
        if(path=="/api/memory/soil"){
            val cid=r.url.queryParameter("conversation_id").orEmpty()
            if(!conversationExists(cid))return missing(r)
            if(method=="GET")return response(r,200,soil.response(cid))
            if(method=="PUT")return response(r,200,soil.patch(cid,body(r)))
        }
        if(path=="/api/memory/custom-instructions"){
            val value=when(method){
                "GET"->knowledge.instructions()
                "PUT"->knowledge.saveInstructions(json.decodeFromJsonElement(RemoteCustomInstructionsPutRequest.serializer(),body(r)))
                else->return unsupported(r)
            }
            return ok(r,"instructions" to (value?.let{element(RemoteCustomInstructions.serializer(),it)}?:JsonNull))
        }
        if(path=="/api/worldbook"){
            if(method=="GET")return ok(r,"entries" to array(RemoteWorldbookEntry.serializer(),knowledge.entries()))
            if(method=="POST")return ok(r,"entry" to element(RemoteWorldbookEntry.serializer(),knowledge.saveWorldbook(null,json.decodeFromJsonElement(RemoteWorldbookEntryWriteRequest.serializer(),body(r)))))
        }
        if(path=="/api/worldbook/test-match"&&method=="POST"){
            val req=json.decodeFromJsonElement(RemoteWorldbookMatchRequest.serializer(),body(r))
            return ok(r,"matches" to array(RemoteWorldbookEntry.serializer(),knowledge.match(req.input,emptyList(),req.surface,req.limit,req.allowedScopes).map{it.entry}))
        }
        if(path.startsWith("/api/worldbook/")&&r.url.pathSegments.size==3){
            val id=r.url.pathSegments.last()
            if(method=="PATCH")return ok(r,"entry" to element(RemoteWorldbookEntry.serializer(),knowledge.saveWorldbook(id,json.decodeFromJsonElement(RemoteWorldbookEntryWriteRequest.serializer(),body(r)))))
            if(method=="DELETE"){knowledge.disableWorldbook(id);return ok(r)}
        }
        if (path == "/api/daily/profile") {
            val old = cache.dailyProfile() ?: RemoteDailyProfile()
            val profile = when (method) {
                "GET" -> old
                "PUT" -> {
                    val patch = body(r)["profile"] as? JsonObject ?: return unsupported(r)
                    old.copy(
                        ownerAvatarDataUrl = patch.str("owner_avatar_dataurl") ?: old.ownerAvatarDataUrl,
                        modelPartnerAvatarDataUrl = patch.str("model_partner_avatar_dataurl") ?: old.modelPartnerAvatarDataUrl,
                        momentCoverDataUrl = patch.str("moment_cover_dataurl") ?: old.momentCoverDataUrl,
                        modelPartnerDisplayName = patch.str("model_partner_display_name") ?: old.modelPartnerDisplayName,
                        updatedAt = now()
                    ).also(cache::putDailyProfile)
                }
                else -> return unsupported(r)
            }
            return ok(r, "profile" to element(RemoteDailyProfile.serializer(), profile))
        }
        if (path == "/api/chat/search" && method == "GET") return search(r)
        if (path == "/api/chat/title" && method == "POST") {
            val b = body(r)
            val cid = b.str("conversation_id").orEmpty()
            val all = cache.conversations()
            val old = all.firstOrNull { it.id == cid } ?: return missing(r)
            if (old.title != "新聊天") return ok(r, "skipped" to JsonPrimitive(true))
            val title = b.str("user").orEmpty().trim().take(32).ifBlank { "新聊天" }
            val next = old.copy(title = title, updatedAt = now())
            cache.putConversations(all.map { if (it.id == cid) next else it })
            return ok(r, "conversation" to element(RemoteConversation.serializer(), next))
        }
        if (path == "/api/daily/moments" || path == "/api/daily/diaries" ||
            path.startsWith("/api/daily/moments/") || path.startsWith("/api/daily/diaries/"))
            return daily(r, path, method)
        if (path == "/api/calendar/entries") {
            if (method == "GET") return ok(r, "entries" to JsonArray(calendar.list(r.url.queryParameter("month"),
                r.url.queryParameter("pinned") == "1", r.url.queryParameter("today"))))
            if (method == "POST") return ok(r, "entry" to calendar.save(null, body(r)))
        }
        if (path.startsWith("/api/calendar/entries/") && r.url.pathSegments.size == 4) {
            val cid = r.url.pathSegments.last()
            if (method == "PATCH") return ok(r, "entry" to calendar.save(cid, body(r)))
            if (method == "DELETE") { calendar.delete(cid); return ok(r, "deleted" to JsonPrimitive(true), "id" to JsonPrimitive(cid)) }
        }
        if (path == "/api/transfer/v1" && method == "GET") {
            val data = LocalBackupArchive.capture(store, BuildConfig.APPLICATION_ID)
            return ok(r, "bundle" to json.parseToJsonElement(LocalBackupArchive.encode(data).decodeToString()))
        }
        if (path in setOf("/api/transfer/v1/preview", "/api/transfer/v1/import") && method == "POST") {
            try {
                val b = body(r)
                val bundle = b.getValue("bundle").toString().encodeToByteArray()
                val modules = b.getValue("modules").jsonArray.map { it.jsonPrimitive.content }.toSet()
                val committing = path.endsWith("/import")
                if (committing && b["confirm"]?.jsonPrimitive?.booleanOrNull != true)
                    return failure(r, 400, "confirmation_required", "请确认将资料写入本机。")
                val report = if (committing) LocalTransferRestore.restore(bundle, BuildConfig.APPLICATION_ID, modules, store)
                    else LocalTransferRestore.preview(bundle, BuildConfig.APPLICATION_ID, modules, store)
                return ok(r, (if (committing) "result" else "preview") to buildJsonObject {
                    put("source", report.source); put("target", "local"); put("can_commit", true)
                    put("unsupported_modules", JsonArray(report.unsupportedModules.map(::JsonPrimitive)))
                    report.counts.forEach { (key, value) ->
                        putJsonObject(key) { put("ready", value.ready); put("existing", value.existing); put("conflicts", value.conflicts); put("blocked", JsonArray(emptyList())) }
                    }
                })
            } catch (error: IllegalArgumentException) {
                return failure(r, 400, "invalid_transfer", error.message?.take(240) ?: "数据包未通过校验。")
            }
        }
        if (path == "/api/export/v1-snapshot" && method == "GET") {
            val snapshot = buildJsonObject {
                put("format", "elementera-coast-v1-snapshot")
                put("version", 1)
                put("scope", "local")
                put("workspace", "local")
                put("exported_at", now())
                put("included_modules", JsonArray(listOf("chat", "daily", "model_profile", "calendar").map(::JsonPrimitive)))
                put("excluded_modules", JsonArray(listOf("attachments", "memory", "thinking_soil", "worldbook", "vault", "library", "voice", "local_appearance", "provider_credentials", "oauth_credentials", "full_restore").map(::JsonPrimitive)))
                put("chat", buildJsonObject {
                    put("conversations", buildJsonArray { cache.conversations().forEach { c ->
                    add(buildJsonObject {
                        put("conversation", element(RemoteConversation.serializer(), c))
                        put("history", element(RemoteHistory.serializer(), cache.history(c.id) ?: RemoteHistory(conversationId = c.id)))
                    })
                } })
                })
                put("daily", buildJsonObject {
                    put("profile", element(RemoteDailyProfile.serializer(), cache.dailyProfile() ?: RemoteDailyProfile()))
                    put("moments", array(RemoteDailyMoment.serializer(), cache.dailyMoments()))
                    put("diaries", array(RemoteDailyDiary.serializer(), cache.dailyDiaries()))
                })
                put("calendar", buildJsonObject { put("entries", calendar.snapshot()) })
                put("model_profile", element(RemoteProfile.serializer(), cache.profile() ?: RemoteProfile()))
            }
            return ok(r, "snapshot" to snapshot)
        }
        return unsupported(r)
    }

    private fun search(r: Request): Response {
        val q = r.url.queryParameter("q").orEmpty().trim()
        val results = mutableListOf<JsonObject>()
        if (q.isNotBlank()) for (c in cache.conversations()) {
            fun hit(kind: String, snippet: String, turn: String = "", msg: String = "", role: String = "") =
                buildJsonObject {
                    put("kind", kind); put("conversation_id", c.id); put("conversation_title", c.title)
                    put("turn_id", turn); put("message_id", msg); put("role", role); put("snippet", snippet)
                }
            if (c.title.contains(q, ignoreCase = true)) results.add(hit("conversation", c.title))
            for (t in cache.history(c.id)?.turns.orEmpty()) {
                fun scan(role: String, variants: List<RemoteVariant>) {
                    for (v in variants) if (!v.hidden) {
                        val at = v.content.indexOf(q, ignoreCase = true)
                        if (at >= 0) results.add(hit("message", v.content.substring((at - 40).coerceAtLeast(0), (at + q.length + 80).coerceAtMost(v.content.length)), t.id, v.id, role))
                    }
                }
                scan("user", t.user.variants)
                t.assistant.variantsByUserVariant.forEach { (k, variants) ->
                    if (k.toIntOrNull()?.let { t.user.variants.getOrNull(it)?.hidden == false } == true) scan("assistant", variants)
                }
            }
        }
        val start = (r.url.queryParameter("cursor")?.toIntOrNull() ?: 0).coerceIn(0, results.size)
        val end = (start + 50).coerceAtMost(results.size)
        return ok(r, "results" to JsonArray(results.subList(start, end)),
            "next_cursor" to JsonPrimitive(if (end < results.size) end.toString() else ""))
    }

    private fun daily(r: Request, path: String, method: String): Response {
        if (path == "/api/daily/moments") {
            val all = cache.dailyMoments()
            if (method == "GET") return ok(r, "moments" to array(RemoteDailyMoment.serializer(), all))
            if (method == "POST") {
                val b = json.decodeFromJsonElement(RemoteDailyMomentCreateRequest.serializer(), body(r))
                val timestamp = now()
                val m = RemoteDailyMoment(id = id(), date = b.date, text = b.text, status = b.status, createdAt = timestamp, updatedAt = timestamp, publishedAt = timestamp, likes = emptyList())
                cache.putDailyMoments(listOf(m) + all)
                return ok(r, "moment" to element(RemoteDailyMoment.serializer(), m))
            }
        }
        if (path.startsWith("/api/daily/moments/")) {
            val segments = r.url.pathSegments
            val mid = segments.getOrNull(3).orEmpty()
            val all = cache.dailyMoments()
            val m = all.firstOrNull { it.id == mid } ?: return missing(r)
            if (segments.size == 4 && method == "DELETE") {
                cache.putDailyMoments(all.filterNot { it.id == mid }); return ok(r)
            }
            val next = when {
                segments.size == 4 && method == "PATCH" -> {
                    val b = json.decodeFromJsonElement(RemoteDailyMomentPatchRequest.serializer(), body(r))
                    m.copy(date = b.date ?: m.date, text = b.text ?: m.text, reason = b.reason ?: m.reason)
                }
                segments.size == 5 && segments[4] == "like" && method in setOf("PUT", "DELETE") -> {
                    val liked = method == "PUT"
                    val count = (m.likeCount + (if (liked) 1 else 0) - (if (m.liked) 1 else 0)).coerceAtLeast(0)
                    // A legacy aggregate is not evidence of who liked or when.
                    val known = m.likes ?: if (m.likeCount == 0 && !m.liked) emptyList() else null
                    val likes = if (known != null) {
                        val previous = known.firstOrNull { it.actor == "owner" }
                        known.filterNot { it.actor == "owner" } +
                            if (liked) listOf(previous ?: RemoteDailyLike("owner", now())) else emptyList()
                    } else if (count == 0 && !liked) emptyList() else null
                    m.copy(liked = liked, likeCount = count, likes = likes)
                }
                segments.size == 5 && segments[4] == "comments" && method == "POST" ->
                    m.copy(comments = m.comments + RemoteDailyComment(id(), text = body(r).str("text").orEmpty(), createdAt = now()))
                segments.size == 6 && segments[4] == "comments" && method == "DELETE" ->
                    m.copy(comments = m.comments.filterNot { it.id == segments[5] })
                else -> return unsupported(r)
            }.copy(updatedAt = now())
            cache.putDailyMoments(all.map { if (it.id == mid) next else it })
            return ok(r, "moment" to element(RemoteDailyMoment.serializer(), next))
        }
        if (path == "/api/daily/diaries") {
            val all = cache.dailyDiaries()
            if (method == "GET") return ok(r, "diaries" to array(RemoteDailyDiary.serializer(), all))
            if (method == "POST") {
                val b = json.decodeFromJsonElement(RemoteDailyDiaryCreateRequest.serializer(), body(r))
                val d = RemoteDailyDiary(id = id(), date = b.date, weather = b.weather, mood = b.mood, tags = b.tags,
                    text = b.text, createdAt = now(), updatedAt = now())
                cache.putDailyDiaries(listOf(d) + all)
                return ok(r, "diary" to element(RemoteDailyDiary.serializer(), d))
            }
        }
        if (path.startsWith("/api/daily/diaries/")) {
            val did = r.url.pathSegments.last()
            val all = cache.dailyDiaries()
            val d = all.firstOrNull { it.id == did } ?: return missing(r)
            if (method == "DELETE") {
                cache.putDailyDiaries(all.filterNot { it.id == did }); return ok(r)
            }
            if (method == "PATCH") {
                val b = json.decodeFromJsonElement(RemoteDailyDiaryPatchRequest.serializer(), body(r))
                val next = d.copy(date = b.date ?: d.date, weather = b.weather ?: d.weather, mood = b.mood ?: d.mood,
                    tags = b.tags ?: d.tags, text = b.text ?: d.text, updatedAt = now())
                cache.putDailyDiaries(all.map { if (it.id == did) next else it })
                return ok(r, "diary" to element(RemoteDailyDiary.serializer(), next))
            }
        }
        return unsupported(r)
    }

    companion object { const val HOST = "local.coast.invalid" }
}
