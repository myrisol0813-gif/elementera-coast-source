package com.elementeracoast.app.feature.gate

import android.content.Context
import com.elementeracoast.app.core.network.CoastApiConfig
import com.elementeracoast.app.core.network.CoastApiErrorKind
import com.elementeracoast.app.core.network.CoastApiException
import com.elementeracoast.app.core.network.coastErrorKind
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response

class MailboxRepository(
    private val config: CoastApiConfig,
    private val sessionStore: MailboxSessionStore,
    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .followRedirects(false)
        .build(),
    private val json: Json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        encodeDefaults = false
    }
) {
    fun hasSession(): Boolean = !sessionStore.load().isNullOrBlank()

    suspend fun login(passphrase: String): MailboxVisitor {
        val payload = """{"passphrase":${json.encodeToString(passphrase)}}"""
        val response = request(
            Request.Builder()
                .url(config.url("/api/mailbox/login"))
                .post(jsonBody(payload))
                .build(),
            MailboxVisitorEnvelope.serializer(),
            includeSession = false
        )
        captureSession(response.headers)
        return response.body.visitor()
    }

    suspend fun register(
        displayName: String,
        passphrase: String,
        preferredName: String,
        allowMemory: Boolean
    ): MailboxVisitor {
        val payload = """{"display_name":${json.encodeToString(displayName)},"passphrase":${json.encodeToString(passphrase)},"preferred_name":${json.encodeToString(preferredName)},"allow_memory":$allowMemory}"""
        val response = request(
            Request.Builder()
                .url(config.url("/api/mailbox/register"))
                .post(jsonBody(payload))
                .build(),
            MailboxVisitorEnvelope.serializer(),
            includeSession = false
        )
        captureSession(response.headers)
        return response.body.visitor()
    }

    suspend fun me(): MailboxVisitor =
        requestJson("/api/mailbox/me", MailboxVisitorEnvelope.serializer()).visitor()

    suspend fun roomSnapshot(): MailboxRoomSnapshot = coroutineScope {
        val messages = async { requestJson("/api/mailbox/messages", MailboxMessagesEnvelope.serializer()).messages }
        val status = async { requestJson("/api/mailbox/status", MailboxStatus.serializer()) }
        val memory = async { requestJson("/api/mailbox/memory", MailboxMemoryEnvelope.serializer()).memory }
        MailboxRoomSnapshot(messages.await(), status.await(), memory.await())
    }

    suspend fun send(content: String): MailboxMessage {
        val payload = """{"content":${json.encodeToString(content)}}"""
        return requestJson(
            "/api/mailbox/send",
            MailboxMessageEnvelope.serializer(),
            method = "POST",
            body = payload
        ).message
    }

    suspend fun editMessage(messageId: String, content: String): MailboxMessage {
        val payload = """{"content":${json.encodeToString(content)}}"""
        return requestJson(
            "/api/mailbox/messages/${encodePath(messageId)}",
            MailboxMessageEnvelope.serializer(),
            method = "PATCH",
            body = payload
        ).message
    }

    suspend fun deleteMessage(messageId: String) {
        requestJson(
            "/api/mailbox/messages/${encodePath(messageId)}",
            MailboxOkEnvelope.serializer(),
            method = "DELETE"
        )
    }

    suspend fun resolvePocket(pocketId: String, action: String) {
        val payload = """{"action":${json.encodeToString(action)}}"""
        requestJson(
            "/api/mailbox/memory/pockets/${encodePath(pocketId)}/resolve",
            MailboxOkEnvelope.serializer(),
            method = "POST",
            body = payload
        )
    }

    suspend fun deleteMemoryEntry(entryId: String) {
        requestJson(
            "/api/mailbox/memory/entries/${encodePath(entryId)}",
            MailboxOkEnvelope.serializer(),
            method = "DELETE"
        )
    }

    suspend fun logout() {
        runCatching {
            requestJson(
                "/api/mailbox/logout",
                MailboxOkEnvelope.serializer(),
                method = "POST",
                body = "{}"
            )
        }
        sessionStore.clear()
    }

    suspend fun deleteAccount() {
        requestJson(
            "/api/mailbox/account",
            MailboxOkEnvelope.serializer(),
            method = "DELETE"
        )
        sessionStore.clear()
    }

    private suspend fun <T> requestJson(
        path: String,
        serializer: KSerializer<T>,
        method: String = "GET",
        body: String? = null
    ): T {
        val builder = Request.Builder().url(config.url(path))
        when (method) {
            "GET" -> builder.get()
            "POST" -> builder.post(jsonBody(body ?: "{}"))
            "PATCH" -> builder.patch(jsonBody(body ?: "{}"))
            "DELETE" -> if (body == null) builder.delete() else builder.delete(jsonBody(body))
            else -> error("Unsupported mailbox method: $method")
        }
        return request(builder.build(), serializer, includeSession = true).body
    }

    private suspend fun <T> request(
        original: Request,
        serializer: KSerializer<T>,
        includeSession: Boolean
    ): ParsedResponse<T> = withContext(Dispatchers.IO) {
        val builder = original.newBuilder()
            .header("Accept", "application/json")
            .header("X-Coast-Client", "native-android-mailbox")
        if (includeSession) {
            sessionStore.load()?.takeIf(String::isNotBlank)?.let { builder.header("Cookie", it) }
        }
        if (original.method !in setOf("GET", "HEAD")) {
            builder.header("Origin", config.origin)
        }
        try {
            client.newCall(builder.build()).execute().use { response ->
                val text = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    if (response.code == 401) sessionStore.clear()
                    throw responseError(response, text)
                }
                val decoded = runCatching { json.decodeFromString(serializer, text) }.getOrElse { cause ->
                    throw CoastApiException(
                        CoastApiErrorKind.Decode,
                        "mailbox_invalid_json",
                        "访客信箱返回的数据格式无法读取。",
                        response.code,
                        cause
                    )
                }
                ParsedResponse(decoded, response.headers.values("Set-Cookie"))
            }
        } catch (error: CoastApiException) {
            throw error
        } catch (error: IOException) {
            throw CoastApiException(
                CoastApiErrorKind.Network,
                "mailbox_network_unreachable",
                "无法连接访客信箱后端。",
                cause = error
            )
        }
    }

    private fun captureSession(setCookies: List<String>) {
        val cookie = setCookies
            .firstOrNull { it.startsWith("${AndroidMailboxSessionStore.COOKIE_NAME}=") }
            ?.substringBefore(';')
            ?.trim()
            ?: throw CoastApiException(
                CoastApiErrorKind.Decode,
                "mailbox_session_cookie_missing",
                "访客信箱没有返回访客登录态。"
            )
        sessionStore.save(cookie)
    }

    private fun responseError(response: Response, text: String): CoastApiException {
        var type = when (response.code) {
            401 -> "mailbox_session_required"
            403 -> "forbidden"
            503 -> "mailbox_unavailable"
            else -> "mailbox_request_failed"
        }
        var message = when (response.code) {
            401 -> "访客登录态已失效，请重新输入暗号。"
            403 -> "当前访客没有执行这个操作的权限。"
            503 -> "访客信箱后端暂时不可用，请稍后重试。"
            else -> "访客信箱请求失败（${response.code}）。"
        }
        runCatching {
            val error = json.parseToJsonElement(text).jsonObject["error"]?.jsonObject ?: return@runCatching
            type = error["type"]?.jsonPrimitive?.contentOrNull ?: type
            message = error["message"]?.jsonPrimitive?.contentOrNull ?: message
        }
        return CoastApiException(
            coastErrorKind(response.code, type),
            type,
            message,
            response.code
        )
    }

    private fun jsonBody(value: String) = value.toRequestBody(JSON_MEDIA_TYPE)

    private fun encodePath(value: String): String =
        java.net.URLEncoder.encode(value, Charsets.UTF_8.name()).replace("+", "%20")

    private data class ParsedResponse<T>(
        val body: T,
        val headers: List<String>
    )

    companion object {
        private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()

        fun production(context: Context): MailboxRepository =
            MailboxRepository(
                config = CoastApiConfig.production(),
                sessionStore = AndroidMailboxSessionStore(context.applicationContext)
            )
    }
}
