package com.elementeracoast.app.feature.shell

import com.elementeracoast.app.core.network.CoastApiConfig
import com.elementeracoast.app.core.network.CoastApiErrorKind
import com.elementeracoast.app.core.network.CoastApiException
import com.elementeracoast.app.core.remote.RemoteConversation
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
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

class ConversationTitleRemoteDataSource(
    private val config: CoastApiConfig,
    private val client: OkHttpClient,
    private val json: Json = Json { ignoreUnknownKeys = true; explicitNulls = false; encodeDefaults = false }
) {
    suspend fun generate(conversationId: String, user: String, assistant: String): RemoteConversation? = withContext(Dispatchers.IO) {
        val payload = json.encodeToString(TitleRequest(conversationId, user, assistant))
        val request = Request.Builder()
            .url(config.url("/api/chat/title"))
            .post(payload.toRequestBody(JSON))
            .build()
        try {
            client.newCall(request).execute().use { response ->
                val text = response.body?.string().orEmpty()
                if (!response.isSuccessful) throw responseError(response.code, text)
                runCatching { json.decodeFromString(TitleResponse.serializer(), text) }.getOrElse { cause ->
                    throw CoastApiException(CoastApiErrorKind.Decode, "invalid_json", "窗口命名返回的数据格式无法读取。", response.code, cause)
                }.conversation
            }
        } catch (error: CoastApiException) {
            throw error
        } catch (error: IOException) {
            throw CoastApiException(CoastApiErrorKind.Network, "network_unreachable", "无法连接海岸后端。", cause = error)
        }
    }

    private fun responseError(status: Int, text: String): CoastApiException {
        var type = if (status == 401) "unauthorized" else "request_failed"
        var message = if (status == 401) "登录状态已失效。" else "窗口自动命名失败（$status）。"
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

    @Serializable
    private data class TitleRequest(
        @SerialName("conversation_id") val conversationId: String,
        val user: String,
        val assistant: String
    )

    @Serializable
    private data class TitleResponse(
        val ok: Boolean = false,
        val skipped: Boolean = false,
        val conversation: RemoteConversation? = null
    )

    private companion object {
        val JSON = "application/json; charset=utf-8".toMediaType()
    }
}
