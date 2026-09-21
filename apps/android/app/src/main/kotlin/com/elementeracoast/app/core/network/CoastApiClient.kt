package com.elementeracoast.app.core.network

import com.elementeracoast.app.core.auth.AndroidKeystoreAuthStore
import com.elementeracoast.app.core.auth.AuthSession
import com.elementeracoast.app.core.remote.RemoteAttachment
import com.elementeracoast.app.core.remote.RemoteAttachmentResponse
import com.elementeracoast.app.core.remote.RemoteChatRequest
import com.elementeracoast.app.core.remote.RemoteConversation
import com.elementeracoast.app.core.remote.RemoteConversationListResponse
import com.elementeracoast.app.core.remote.RemoteConversationResponse
import com.elementeracoast.app.core.remote.RemoteDailyCommentRequest
import com.elementeracoast.app.core.remote.RemoteDailyDiary
import com.elementeracoast.app.core.remote.RemoteDailyDiaryCreateRequest
import com.elementeracoast.app.core.remote.RemoteDailyDiaryListResponse
import com.elementeracoast.app.core.remote.RemoteDailyDiaryPatchRequest
import com.elementeracoast.app.core.remote.RemoteDailyDiaryResponse
import com.elementeracoast.app.core.remote.RemoteDailyMoment
import com.elementeracoast.app.core.remote.RemoteDailyMomentCreateRequest
import com.elementeracoast.app.core.remote.RemoteDailyMomentListResponse
import com.elementeracoast.app.core.remote.RemoteDailyMomentPatchRequest
import com.elementeracoast.app.core.remote.RemoteDailyMomentResponse
import com.elementeracoast.app.core.remote.RemoteDailyModelPartnerCommentRequest
import com.elementeracoast.app.core.remote.RemoteDailyModelPartnerCommentResult
import com.elementeracoast.app.core.remote.RemoteDailyProfile
import com.elementeracoast.app.core.remote.RemoteDailyProfilePatch
import com.elementeracoast.app.core.remote.RemoteDailyProfileResponse
import com.elementeracoast.app.core.remote.RemoteDailyProfileUpdateRequest
import com.elementeracoast.app.core.remote.RemoteHistory
import com.elementeracoast.app.core.remote.RemoteHistoryResponse
import com.elementeracoast.app.core.remote.RemoteModelCatalogResponse
import com.elementeracoast.app.core.remote.RemoteProfile
import com.elementeracoast.app.core.remote.RemoteProfileResponse
import com.elementeracoast.app.core.remote.RemoteSessionResponse
import com.elementeracoast.app.core.remote.RemoteSoilOrganizeRequest
import com.elementeracoast.app.core.remote.RemoteSoilOrganizeResponse
import com.elementeracoast.app.core.remote.RemoteThoughtSoil
import com.elementeracoast.app.core.remote.RemoteThoughtSoilResponse
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.FormBody
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response

sealed interface ApiStreamEvent {
    data class Meta(val data: JsonElement) : ApiStreamEvent
    data class Delta(val text: String) : ApiStreamEvent
    data class Tool(val data: JsonElement) : ApiStreamEvent
    data class FurnitureRuns(val data: JsonElement) : ApiStreamEvent
    data class DeskSlip(val data: JsonElement) : ApiStreamEvent
    data class Usage(val data: JsonElement) : ApiStreamEvent
    data class Error(val error: CoastApiException) : ApiStreamEvent
    data class Done(val finishReason: String) : ApiStreamEvent
}

class CoastApiClient(
    private val config: CoastApiConfig,
    private val client: OkHttpClient,
    private val json: Json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        encodeDefaults = false
    }
) {
    private val historyJson = Json(json) { encodeDefaults = true }

    suspend fun login(password: String): AuthSession {
        val request = Request.Builder().url(config.url("/login")).post(FormBody.Builder().add("password", password).build()).build()
        val cookie = execute(request) { response ->
            if (response.code == 401) throw CoastApiException(CoastApiErrorKind.Unauthorized, "invalid_password", "访问密码不正确。", 401)
            if (response.code !in 300..399) throw responseError(response)
            val raw = response.headers.values("Set-Cookie").firstOrNull { it.startsWith("${AndroidKeystoreAuthStore.COOKIE_NAME}=") }
                ?: throw CoastApiException(CoastApiErrorKind.Decode, "missing_session_cookie", "后端没有返回登录凭据。")
            raw.substringBefore(';').trim()
        }
        val provisional = AuthSession(cookie, 0L)
        val verified = getSession(provisional)
        if (!verified.authenticated || (!verified.persistsUntilLogout && verified.expiresAt <= 0L)) {
            throw CoastApiException(CoastApiErrorKind.Unauthorized, "invalid_session", "登录凭据未通过验证。", 401)
        }
        return AuthSession(cookie, if (verified.persistsUntilLogout) 0L else verified.expiresAt)
    }

    suspend fun getSession(overrideSession: AuthSession? = null): RemoteSessionResponse {
        val builder = Request.Builder().url(config.url("/api/session")).get()
        overrideSession?.cookieHeader?.let { builder.header("Cookie", it) }
        return jsonRequest(builder.build(), RemoteSessionResponse.serializer())
    }

    suspend fun logout(session: AuthSession?) {
        val builder = Request.Builder().url(config.url("/logout")).get()
        session?.cookieHeader?.let { builder.header("Cookie", it) }
        runCatching { execute(builder.build()) { Unit } }
    }

    suspend fun getGlobalSnapshot(): JsonElement {
        val envelope = jsonRequestElement(
            Request.Builder().url(config.url("/api/export/v1-snapshot")).get().build()
        )
        return envelope.runCatching { jsonObject["snapshot"] }.getOrNull()
            ?: throw CoastApiException(
                CoastApiErrorKind.Decode,
                "snapshot_missing",
                "全局快照没有返回 snapshot 正文。"
            )
    }

    suspend fun getProfile(): RemoteProfile = jsonRequest(Request.Builder().url(config.url("/api/chat/profile")).get().build(), RemoteProfileResponse.serializer()).profile

    suspend fun putProfile(profile: RemoteProfile): RemoteProfile {
        val payload = json.encodeToString(RemoteProfile.serializer(), profile)
        return jsonRequest(Request.Builder().url(config.url("/api/chat/profile")).put(jsonBody(payload)).build(), RemoteProfileResponse.serializer()).profile
    }

    suspend fun getDailyProfile(): RemoteDailyProfile =
        jsonRequest(Request.Builder().url(config.url("/api/daily/profile")).get().build(), RemoteDailyProfileResponse.serializer()).profile

    suspend fun putDailyProfile(patch: RemoteDailyProfilePatch): RemoteDailyProfile {
        val payload = json.encodeToString(RemoteDailyProfileUpdateRequest.serializer(), RemoteDailyProfileUpdateRequest(patch))
        return jsonRequest(Request.Builder().url(config.url("/api/daily/profile")).put(jsonBody(payload)).build(), RemoteDailyProfileResponse.serializer()).profile
    }

    suspend fun listDailyMoments(): List<RemoteDailyMoment> =
        jsonRequest(Request.Builder().url(config.url("/api/daily/moments")).get().build(), RemoteDailyMomentListResponse.serializer()).moments

    suspend fun createDailyMoment(value: RemoteDailyMomentCreateRequest): RemoteDailyMoment {
        val payload = json.encodeToString(RemoteDailyMomentCreateRequest.serializer(), value)
        return jsonRequest(Request.Builder().url(config.url("/api/daily/moments")).post(jsonBody(payload)).build(), RemoteDailyMomentResponse.serializer()).moment
    }

    suspend fun patchDailyMoment(id: String, value: RemoteDailyMomentPatchRequest): RemoteDailyMoment {
        val payload = json.encodeToString(RemoteDailyMomentPatchRequest.serializer(), value)
        return jsonRequest(Request.Builder().url(config.url("/api/daily/moments/${encodePath(id)}")).patch(jsonBody(payload)).build(), RemoteDailyMomentResponse.serializer()).moment
    }

    suspend fun deleteDailyMoment(id: String) {
        jsonRequestElement(Request.Builder().url(config.url("/api/daily/moments/${encodePath(id)}")).delete().build())
    }

    suspend fun setDailyMomentLike(id: String, liked: Boolean): RemoteDailyMoment {
        val builder = Request.Builder().url(config.url("/api/daily/moments/${encodePath(id)}/like"))
        val request = if (liked) builder.put(jsonBody("{}")).build() else builder.delete().build()
        return jsonRequest(request, RemoteDailyMomentResponse.serializer()).moment
    }

    suspend fun addDailyMomentComment(id: String, text: String): RemoteDailyMoment {
        val payload = json.encodeToString(RemoteDailyCommentRequest.serializer(), RemoteDailyCommentRequest(text = text))
        return jsonRequest(Request.Builder().url(config.url("/api/daily/moments/${encodePath(id)}/comments")).post(jsonBody(payload)).build(), RemoteDailyMomentResponse.serializer()).moment
    }

    suspend fun deleteDailyMomentComment(id: String, commentId: String): RemoteDailyMoment =
        jsonRequest(
            Request.Builder().url(config.url("/api/daily/moments/${encodePath(id)}/comments/${encodePath(commentId)}")).delete().build(),
            RemoteDailyMomentResponse.serializer()
        ).moment

    suspend fun requestDailyModelPartnerComment(id: String): RemoteDailyModelPartnerCommentResult {
        val payload = json.encodeToString(RemoteDailyModelPartnerCommentRequest.serializer(), RemoteDailyModelPartnerCommentRequest())
        val request = Request.Builder()
            .url(config.url("/api/daily/moments/${encodePath(id)}/model-partner-comment"))
            .post(jsonBody(payload))
            .header("Accept", "text/event-stream")
            .build()
        return execute(request) { response ->
            if (!response.isSuccessful) throw responseError(response)
            val source = response.body?.source() ?: throw CoastApiException(CoastApiErrorKind.Stream, "empty_stream", "后端没有返回可读取的朋友圈留言流。")
            val parser = SseParser(json)
            var result: RemoteDailyModelPartnerCommentResult? = null
            while (!source.exhausted()) {
                val event = parser.acceptLine(source.readUtf8Line()) ?: continue
                when (event.event) {
                    "result" -> result = json.decodeFromJsonElement(RemoteDailyModelPartnerCommentResult.serializer(), event.data)
                    "error" -> throw dailyStreamError(event.data)
                }
            }
            val final = parser.acceptLine(null)
            if (final?.event == "result") result = json.decodeFromJsonElement(RemoteDailyModelPartnerCommentResult.serializer(), final.data)
            if (final?.event == "error") throw dailyStreamError(final.data)
            result ?: throw CoastApiException(CoastApiErrorKind.Stream, "stream_incomplete", "另一位屋主留言流提前结束。", 502)
        }
    }

    suspend fun listDailyDiaries(): List<RemoteDailyDiary> =
        jsonRequest(Request.Builder().url(config.url("/api/daily/diaries")).get().build(), RemoteDailyDiaryListResponse.serializer()).diaries

    suspend fun createDailyDiary(value: RemoteDailyDiaryCreateRequest): RemoteDailyDiary {
        val payload = json.encodeToString(RemoteDailyDiaryCreateRequest.serializer(), value)
        return jsonRequest(Request.Builder().url(config.url("/api/daily/diaries")).post(jsonBody(payload)).build(), RemoteDailyDiaryResponse.serializer()).diary
    }

    suspend fun patchDailyDiary(id: String, value: RemoteDailyDiaryPatchRequest): RemoteDailyDiary {
        val payload = json.encodeToString(RemoteDailyDiaryPatchRequest.serializer(), value)
        return jsonRequest(Request.Builder().url(config.url("/api/daily/diaries/${encodePath(id)}")).patch(jsonBody(payload)).build(), RemoteDailyDiaryResponse.serializer()).diary
    }

    suspend fun deleteDailyDiary(id: String) {
        jsonRequestElement(Request.Builder().url(config.url("/api/daily/diaries/${encodePath(id)}")).delete().build())
    }

    suspend fun listConversations(): List<RemoteConversation> =
        jsonRequest(Request.Builder().url(config.url("/api/chat/conversations")).get().build(), RemoteConversationListResponse.serializer()).conversations

    suspend fun createConversation(title: String, roomType: String): RemoteConversation {
        val payload = json.encodeToString(mapOf("title" to title, "room_type" to roomType))
        return jsonRequest(Request.Builder().url(config.url("/api/chat/conversations")).post(jsonBody(payload)).build(), RemoteConversationResponse.serializer()).conversation
    }

    suspend fun renameConversation(id: String, title: String): RemoteConversation {
        val payload = json.encodeToString(mapOf("title" to title))
        return jsonRequest(Request.Builder().url(config.url("/api/chat/conversations/${encodePath(id)}")).patch(jsonBody(payload)).build(), RemoteConversationResponse.serializer()).conversation
    }

    suspend fun deleteConversation(id: String) { jsonRequestElement(Request.Builder().url(config.url("/api/chat/conversations/${encodePath(id)}")).delete().build()) }

    suspend fun getHistory(conversationId: String): RemoteHistory =
        jsonRequest(Request.Builder().url(config.url("/api/chat/history?conversation_id=${encodeQuery(conversationId)}")).get().build(), RemoteHistoryResponse.serializer()).history

    suspend fun uploadChatAttachment(
        conversationId: String,
        name: String,
        mime: String,
        bytes: ByteArray
    ): RemoteAttachment {
        if (bytes.isEmpty()) throw CoastApiException(CoastApiErrorKind.Request, "attachment_empty", "附件是空文件。", 400)
        if (bytes.size > 8 * 1024 * 1024) {
            throw CoastApiException(CoastApiErrorKind.Request, "file_too_large", "附件超过当前 8 MB 限制。", 413)
        }
        val mediaType = runCatching { mime.ifBlank { "application/octet-stream" }.toMediaType() }
            .getOrElse { "application/octet-stream".toMediaType() }
        val body = MultipartBody.Builder()
            .setType(MultipartBody.FORM)
            .addFormDataPart("conversation_id", conversationId)
            .addFormDataPart("file", name.ifBlank { "附件" }, bytes.toRequestBody(mediaType))
            .build()
        return jsonRequest(
            Request.Builder().url(config.url("/api/chat/attachments")).post(body).build(),
            RemoteAttachmentResponse.serializer()
        ).attachment
    }

    suspend fun deleteChatAttachment(conversationId: String, attachmentId: String) {
        jsonRequestElement(
            Request.Builder()
                .url(config.url("/api/chat/attachments/${encodePath(attachmentId)}?conversation_id=${encodeQuery(conversationId)}"))
                .delete()
                .build()
        )
    }

    suspend fun putHistory(conversationId: String, history: RemoteHistory): RemoteHistory {
        val payload = historyJson.encodeToString(RemoteHistory.serializer(), history.copy(conversationId = null))
        return jsonRequest(Request.Builder().url(config.url("/api/chat/history?conversation_id=${encodeQuery(conversationId)}")).put(jsonBody(payload)).build(), RemoteHistoryResponse.serializer()).history
    }

    suspend fun listModels(refresh: Boolean = false): RemoteModelCatalogResponse {
        val suffix = if (refresh) "?refresh=1" else ""
        return jsonRequest(Request.Builder().url(config.url("/api/models$suffix")).get().build(), RemoteModelCatalogResponse.serializer())
    }

    suspend fun getThoughtSoil(conversationId: String): RemoteThoughtSoil =
        jsonRequest(Request.Builder().url(config.url("/api/memory/soil?conversation_id=${encodeQuery(conversationId)}")).get().build(), RemoteThoughtSoilResponse.serializer()).soil

    suspend fun organizeThoughtSoil(conversationId: String, modelId: String): RemoteSoilOrganizeResponse {
        val payload = json.encodeToString(RemoteSoilOrganizeRequest.serializer(), RemoteSoilOrganizeRequest(conversationId = conversationId, model = modelId))
        return jsonRequest(Request.Builder().url(config.url("/api/memory/soil/organize")).post(jsonBody(payload)).build(), RemoteSoilOrganizeResponse.serializer())
    }

    fun streamChat(payload: RemoteChatRequest): Flow<ApiStreamEvent> = callbackFlow {
        val body = json.encodeToString(RemoteChatRequest.serializer(), payload)
        val request = Request.Builder().url(config.url("/api/chat")).post(jsonBody(body)).header("Accept", "text/event-stream").build()
        val call = client.newCall(request)
        val readerJob = launch(Dispatchers.IO) {
            try {
                call.execute().use { response ->
                    if (!response.isSuccessful) throw responseError(response)
                    val source = response.body?.source() ?: throw CoastApiException(CoastApiErrorKind.Stream, "empty_stream", "后端没有返回可读取的回复流。")
                    val parser = SseParser(json)
                    while (!source.exhausted()) {
                        val event = parser.acceptLine(source.readUtf8Line()) ?: continue
                        send(mapStreamEvent(event))
                    }
                    val finalEvent = parser.acceptLine(null)
                    if (finalEvent != null) send(mapStreamEvent(finalEvent))
                }
                close()
            } catch (error: Throwable) {
                if (call.isCanceled()) close() else close(asApiException(error))
            }
        }
        awaitClose { call.cancel(); readerJob.cancel() }
    }

    private fun mapStreamEvent(event: CoastSseEvent): ApiStreamEvent {
        val obj = event.data.runCatching { jsonObject }.getOrNull()
        return when (event.event) {
            "meta" -> ApiStreamEvent.Meta(event.data)
            "delta" -> ApiStreamEvent.Delta(obj?.get("content")?.jsonPrimitive?.contentOrNull.orEmpty())
            "tool" -> ApiStreamEvent.Tool(event.data)
            "furniture_runs" -> ApiStreamEvent.FurnitureRuns(event.data)
            "desk_slip" -> ApiStreamEvent.DeskSlip(event.data)
            "usage" -> ApiStreamEvent.Usage(event.data)
            "done" -> ApiStreamEvent.Done(obj?.get("finish_reason")?.jsonPrimitive?.contentOrNull.orEmpty())
            "error" -> ApiStreamEvent.Error(CoastApiException(coastErrorKind(0, obj?.get("type")?.jsonPrimitive?.contentOrNull.orEmpty()), obj?.get("type")?.jsonPrimitive?.contentOrNull ?: "stream_error", obj?.get("message")?.jsonPrimitive?.contentOrNull ?: "流式生成中断。"))
            else -> ApiStreamEvent.Meta(event.data)
        }
    }

    private fun dailyStreamError(data: JsonElement): CoastApiException {
        val obj = data.runCatching { jsonObject }.getOrNull()
        val type = obj?.get("type")?.jsonPrimitive?.contentOrNull ?: "daily_stream_error"
        val status = obj?.get("status")?.jsonPrimitive?.contentOrNull?.toIntOrNull() ?: 500
        val message = obj?.get("message")?.jsonPrimitive?.contentOrNull ?: "另一位屋主留言生成失败。"
        return CoastApiException(coastErrorKind(status, type), type, message, status)
    }

    private suspend fun <T> jsonRequest(request: Request, serializer: kotlinx.serialization.KSerializer<T>): T = execute(request) { response ->
        if (!response.isSuccessful) throw responseError(response)
        val text = response.body?.string().orEmpty()
        try { json.decodeFromString(serializer, text) }
        catch (cause: Throwable) { throw CoastApiException(CoastApiErrorKind.Decode, "invalid_json", "后端返回的数据格式无法读取。", response.code, cause) }
    }

    private suspend fun jsonRequestElement(request: Request): JsonElement = execute(request) { response ->
        if (!response.isSuccessful) throw responseError(response)
        val text = response.body?.string().orEmpty()
        try { json.parseToJsonElement(text) }
        catch (cause: Throwable) { throw CoastApiException(CoastApiErrorKind.Decode, "invalid_json", "后端返回的数据格式无法读取。", response.code, cause) }
    }

    private suspend fun <T> execute(request: Request, block: (Response) -> T): T = kotlinx.coroutines.withContext(Dispatchers.IO) {
        try { client.newCall(request).execute().use(block) }
        catch (error: CoastApiException) { throw error }
        catch (error: IOException) { throw CoastApiException(CoastApiErrorKind.Network, "network_unreachable", "无法连接后端。", cause = error) }
    }

    private fun responseError(response: Response): CoastApiException {
        val text = response.body?.string().orEmpty()
        var type = if (response.code == 401) "unauthorized" else "request_failed"
        var message = if (response.code == 401) "登录状态已失效。" else "请求失败（${response.code}）。"
        runCatching {
            val root = json.parseToJsonElement(text).jsonObject
            val error = root["error"]
            if (error != null) {
                if (error is kotlinx.serialization.json.JsonObject) {
                    type = error["type"]?.jsonPrimitive?.contentOrNull ?: type
                    message = error["message"]?.jsonPrimitive?.contentOrNull ?: message
                } else message = error.jsonPrimitive.contentOrNull ?: message
            }
        }
        return CoastApiException(coastErrorKind(response.code, type), type, message, response.code)
    }

    private fun asApiException(error: Throwable): CoastApiException = when (error) {
        is CoastApiException -> error
        is IOException -> CoastApiException(CoastApiErrorKind.Network, "network_unreachable", "无法连接后端。", cause = error)
        else -> CoastApiException(CoastApiErrorKind.Stream, "stream_error", "流式生成中断。", cause = error)
    }

    private fun jsonBody(value: String) = value.toRequestBody(JSON_MEDIA_TYPE)
    private fun encodeQuery(value: String): String = java.net.URLEncoder.encode(value, Charsets.UTF_8.name())
    private fun encodePath(value: String): String = java.net.URLEncoder.encode(value, Charsets.UTF_8.name()).replace("+", "%20")

    companion object { private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType() }
}
