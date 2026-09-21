package com.elementeracoast.app.feature.letters

import android.content.Context
import com.elementeracoast.app.core.auth.AndroidKeystoreAuthStore
import com.elementeracoast.app.core.network.CoastApiConfig
import com.elementeracoast.app.core.network.CoastApiErrorKind
import com.elementeracoast.app.core.network.CoastApiException
import com.elementeracoast.app.core.network.CoastHttpClient
import com.elementeracoast.app.core.remote.RemoteHistory
import com.elementeracoast.app.core.remote.RemoteLandingLetterRequest
import com.elementeracoast.app.core.remote.RemoteLandingLetterResponse
import com.elementeracoast.app.core.remote.RemoteModelUsage
import java.io.IOException
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

data class IslandLetterReceipt(
    val reply: String,
    val model: String,
    val usage: RemoteModelUsage? = null,
    val finishReason: String? = null,
    val history: RemoteHistory? = null
)

/** Real landing-letter sender. Local IslandLetterStore remains draft-only. */
class IslandLetterRemoteDataSource(
    private val config: CoastApiConfig,
    private val client: OkHttpClient,
    private val json: Json = Json { ignoreUnknownKeys = true; explicitNulls = false; encodeDefaults = false }
) {
    suspend fun send(
        conversationId: String,
        modelName: String,
        text: String,
        recentTurns: Int,
        contextBudget: Int
    ): IslandLetterReceipt = withContext(Dispatchers.IO) {
        val cleanConversation = conversationId.trim()
        val cleanModel = modelName.trim()
        val cleanText = text.trim().take(IslandLetterStore.MAX_LENGTH)
        if (cleanConversation.isBlank()) throw CoastApiException(
            CoastApiErrorKind.Request,
            "missing_conversation",
            "当前窗口还没有海岸 conversation id。"
        )
        if (cleanModel.isBlank()) throw CoastApiException(
            CoastApiErrorKind.Request,
            "missing_model",
            "请先选择当前聊天模型。"
        )
        if (cleanText.isBlank()) throw CoastApiException(
            CoastApiErrorKind.Request,
            "empty_letter",
            "登岛信还是空的。"
        )
        val payload = RemoteLandingLetterRequest(
            conversationId = cleanConversation,
            model = cleanModel,
            letterText = cleanText,
            localDate = LocalDate.now().toString(),
            localDateTime = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")),
            settings = mapOf(
                "recentTurns" to recentTurns.coerceAtLeast(1).toString(),
                "contextBudget" to contextBudget.coerceAtLeast(1800).toString()
            )
        )
        val body = json.encodeToString(RemoteLandingLetterRequest.serializer(), payload).toRequestBody(JSON_MEDIA)
        val request = Request.Builder().url(config.url("/api/chat/landing-letter")).post(body).build()
        try {
            client.newCall(request).execute().use { response ->
                val raw = response.body?.string().orEmpty()
                if (!response.isSuccessful) throw responseError(response.code, raw)
                val decoded = runCatching { json.decodeFromString(RemoteLandingLetterResponse.serializer(), raw) }
                    .getOrElse { cause ->
                        throw CoastApiException(
                            CoastApiErrorKind.Decode,
                            "invalid_json",
                            "登岛信回执的数据格式无法读取。",
                            response.code,
                            cause
                        )
                    }
                val reply = decoded.assistant?.content.orEmpty()
                if (!decoded.ok || reply.isBlank()) throw CoastApiException(
                    CoastApiErrorKind.Server,
                    "empty_landing_reply",
                    "海岸收到了信，但没有返回可显示的回复。",
                    response.code
                )
                IslandLetterReceipt(
                    reply = reply,
                    model = decoded.model.ifBlank { cleanModel },
                    usage = decoded.usage,
                    finishReason = decoded.finishReason,
                    history = decoded.history
                )
            }
        } catch (error: CoastApiException) {
            throw error
        } catch (error: IOException) {
            throw CoastApiException(CoastApiErrorKind.Network, "network_unreachable", "无法连接海岸后端。", cause = error)
        }
    }

    private fun responseError(status: Int, text: String): CoastApiException {
        var type = if (status == 401) "unauthorized" else "request_failed"
        var message = if (status == 401) "需要先登录海岸。" else "递信失败，请稍后再试。"
        runCatching {
            val error = json.parseToJsonElement(text).jsonObject["error"]
            if (error is JsonObject) {
                type = error["type"]?.jsonPrimitive?.contentOrNull ?: type
                message = error["message"]?.jsonPrimitive?.contentOrNull ?: message
            } else if (error != null) {
                message = error.jsonPrimitive.contentOrNull ?: message
            }
        }
        val kind = when {
            status == 401 -> CoastApiErrorKind.Unauthorized
            status == 404 -> CoastApiErrorKind.NotFound
            status >= 500 -> CoastApiErrorKind.Server
            else -> CoastApiErrorKind.Request
        }
        return CoastApiException(kind, type, message, status)
    }

    companion object {
        private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()

        fun production(context: Context): IslandLetterRemoteDataSource {
            val appContext = context.applicationContext
            val config = CoastApiConfig.production()
            val authStore = AndroidKeystoreAuthStore(appContext)
            val http = CoastHttpClient(config, authStore).client
            return IslandLetterRemoteDataSource(config, http)
        }
    }
}
