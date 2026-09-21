package com.elementeracoast.app.feature.dogtalk

import com.elementeracoast.app.core.model.CrossWindowLimits
import com.elementeracoast.app.core.model.CrossWindowMessage
import com.elementeracoast.app.core.model.CrossWindowSource
import com.elementeracoast.app.core.model.CrossWindowSourceSnapshot
import com.elementeracoast.app.core.model.CrossWindowTurn
import com.elementeracoast.app.core.network.CoastApiConfig
import com.elementeracoast.app.core.network.CoastApiErrorKind
import com.elementeracoast.app.core.network.CoastApiException
import com.elementeracoast.app.core.remote.RemoteCrossWindowSourcesResponse
import java.io.IOException
import java.net.URLEncoder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request

interface CrossWindowRepository {
    suspend fun sources(currentConversationId: String): CrossWindowSourceSnapshot
}

class DefaultCrossWindowRepository(
    private val config: CoastApiConfig,
    private val client: OkHttpClient,
    private val json: Json = Json { ignoreUnknownKeys = true; explicitNulls = false }
) : CrossWindowRepository {
    override suspend fun sources(currentConversationId: String): CrossWindowSourceSnapshot = withContext(Dispatchers.IO) {
        val path = "/api/chat/cross-window/messages?current_conversation_id=${query(currentConversationId)}"
        val remote = try {
            client.newCall(Request.Builder().url(config.url(path)).get().build()).execute().use { response ->
                val text = response.body?.string().orEmpty()
                if (!response.isSuccessful) throw responseError(response.code, text)
                runCatching { json.decodeFromString(RemoteCrossWindowSourcesResponse.serializer(), text) }.getOrElse { cause ->
                    throw CoastApiException(CoastApiErrorKind.Decode, "invalid_json", "跨窗口历史索引的数据格式无法读取。", response.code, cause)
                }
            }
        } catch (error: CoastApiException) {
            throw error
        } catch (error: IOException) {
            throw CoastApiException(CoastApiErrorKind.Network, "network_unreachable", "无法连接后端。", cause = error)
        }
        val limits = remote.limits
        CrossWindowSourceSnapshot(
            description = remote.description,
            limits = CrossWindowLimits(
                defaultTurns = limits.defaultTurns.coerceAtLeast(1),
                technicalMaxTurnsPerSource = limits.technicalMaxTurnsPerSource.coerceAtLeast(1)
            ),
            sources = remote.sources.map { source ->
                CrossWindowSource(
                    conversationId = source.conversationId,
                    title = source.title,
                    roomType = source.roomType,
                    source = source.source,
                    sourceWindowId = source.sourceWindowId,
                    updatedAt = source.updatedAt,
                    messageCount = source.messageCount,
                    turnCount = source.turnCount,
                    readable = source.readable,
                    disabledReason = source.disabledReason,
                    turns = source.turns.map { turn ->
                        CrossWindowTurn(
                            turnId = turn.turnId ?: "${source.conversationId}:turn:${turn.turnNumber}",
                            turnNumber = turn.turnNumber,
                            messages = turn.messages.map { message ->
                                CrossWindowMessage(
                                    messageId = message.messageId,
                                    role = message.role,
                                    displayAuthor = message.displayAuthor?.takeIf(String::isNotBlank)
                                        ?: if (message.role == "assistant") "另一位屋主" else "user",
                                    createdAt = message.createdAt,
                                    length = message.length,
                                    preview = message.preview
                                )
                            }
                        )
                    }
                )
            }
        )
    }

    private fun responseError(status: Int, text: String): CoastApiException {
        var type = if (status == 401) "unauthorized" else "request_failed"
        var message = if (status == 401) "登录状态已失效。" else "跨窗口历史索引请求失败（$status）。"
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

    private fun query(value: String) = URLEncoder.encode(value, Charsets.UTF_8.name())
}
