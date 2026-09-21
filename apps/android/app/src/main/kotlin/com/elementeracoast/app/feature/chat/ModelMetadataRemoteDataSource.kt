package com.elementeracoast.app.feature.chat

import android.content.Context
import com.elementeracoast.app.core.auth.AndroidKeystoreAuthStore
import com.elementeracoast.app.core.network.CoastApiConfig
import com.elementeracoast.app.core.network.CoastApiErrorKind
import com.elementeracoast.app.core.network.CoastApiException
import com.elementeracoast.app.core.network.CoastHttpClient
import com.elementeracoast.app.core.remote.RemoteMessageModelMetadataResponse
import com.elementeracoast.app.core.remote.RemoteModelMetadata
import com.elementeracoast.app.core.remote.RemoteModelRequestMetadata
import com.elementeracoast.app.core.remote.RemoteModelUsage
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request

/** Read-only model echo source. It never participates in prompt/context assembly. */
class ModelMetadataRemoteDataSource(
    private val config: CoastApiConfig,
    private val client: OkHttpClient,
    private val json: Json = Json { ignoreUnknownKeys = true; explicitNulls = false }
) {
    suspend fun get(
        conversationId: String,
        messageId: String,
        includeRaw: Boolean = false
    ): RemoteMessageModelMetadataResponse {
        if (
            config.normalizedBaseUrl == "https://elementera-coast-source.invalid" &&
            conversationId == "source-preview-demo" &&
            messageId == "source-preview-demo-assistant"
        ) {
            return sourcePreviewMetadata(conversationId, messageId, includeRaw)
        }
        return withContext(Dispatchers.IO) {
        val suffix = buildString {
            append("/api/chat/message-metadata?conversation_id=")
            append(query(conversationId))
            append("&message_id=")
            append(query(messageId))
            if (includeRaw) append("&include_raw=1")
        }
        try {
            client.newCall(Request.Builder().url(config.url(suffix)).get().build()).execute().use { response ->
                val text = response.body?.string().orEmpty()
                if (!response.isSuccessful) throw responseError(response.code, text)
                runCatching { json.decodeFromString(RemoteMessageModelMetadataResponse.serializer(), text) }
                    .getOrElse { cause ->
                        throw CoastApiException(
                            CoastApiErrorKind.Decode,
                            "invalid_json",
                            "模型后端返回原文返回的数据格式无法读取。",
                            response.code,
                            cause
                        )
                    }
            }
        } catch (error: CoastApiException) {
            throw error
        } catch (error: IOException) {
            throw CoastApiException(CoastApiErrorKind.Network, "network_unreachable", "无法连接后端。", cause = error)
        }
        }
    }

    private fun sourcePreviewMetadata(
        conversationId: String,
        messageId: String,
        includeRaw: Boolean
    ): RemoteMessageModelMetadataResponse {
        val toolCalls = json.parseToJsonElement(
            """[{"name":"read_file","status":"success"},{"name":"memory_search","status":"success"}]"""
        )
        val toolResults = json.parseToJsonElement(
            """[{"name":"read_file","result":"source-preview-notes.txt"},{"name":"memory_search","result":"1 demo hit"}]"""
        )
        val raw = if (includeRaw) {
            json.parseToJsonElement(
                """{"source":"local_source_preview","sanitized":true,"note":"No real provider request was made."}"""
            )
        } else null
        return RemoteMessageModelMetadataResponse(
            ok = true,
            messageId = messageId,
            conversationId = conversationId,
            status = "sanitized",
            sanitized = true,
            metadata = RemoteModelMetadata(
                provider = "source-preview",
                requestedModel = "source/demo-model",
                resolvedModel = "source/demo-model",
                reasoningSummary = "本地样板回波：仅展示模型回波界面，没有真实推理或供应商调用。",
                reasoningStatus = "sanitized",
                usage = RemoteModelUsage(
                    promptTokens = 512,
                    completionTokens = 128,
                    totalTokens = 640
                ),
                finishReason = "stop",
                nativeFinishReason = "demo",
                isStream = true,
                toolCalls = toolCalls,
                toolResults = toolResults,
                request = RemoteModelRequestMetadata(
                    temperature = 0.7,
                    maxTokens = 1024,
                    stream = true
                )
            ),
            rawMetadataSanitized = raw
        )
    }

    private fun responseError(status: Int, text: String): CoastApiException {
        var type = if (status == 401) "unauthorized" else "request_failed"
        var message = if (status == 401) "登录状态已失效。" else "模型后端返回原文读取失败（$status）。"
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

    private fun query(value: String) = java.net.URLEncoder.encode(value, Charsets.UTF_8.name())

    companion object {
        fun production(context: Context): ModelMetadataRemoteDataSource {
            val appContext = context.applicationContext
            val config = CoastApiConfig.production()
            val authStore = AndroidKeystoreAuthStore(appContext)
            val http = CoastHttpClient(config, authStore).client
            return ModelMetadataRemoteDataSource(config, http)
        }
    }
}
