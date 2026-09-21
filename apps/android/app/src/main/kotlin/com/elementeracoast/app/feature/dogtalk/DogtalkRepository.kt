package com.elementeracoast.app.feature.dogtalk

import com.elementeracoast.app.core.network.CoastApiConfig
import com.elementeracoast.app.core.network.CoastApiErrorKind
import com.elementeracoast.app.core.network.CoastApiException
import com.elementeracoast.app.core.remote.RemoteDogtalk
import com.elementeracoast.app.core.remote.RemoteDogtalkResponse
import com.elementeracoast.app.core.remote.RemoteDogtalkSaveRequest
import java.io.IOException
import java.net.URLEncoder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
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

interface DogtalkRepository {
    val snapshots: StateFlow<Map<String, DogtalkUiState>>
    fun cached(scope: DogtalkScope, conversationId: String): DogtalkUiState
    suspend fun refresh(scope: DogtalkScope, conversationId: String): DogtalkUiState
    suspend fun save(scope: DogtalkScope, conversationId: String, value: DogtalkUiState): DogtalkUiState
}

class DefaultDogtalkRepository(
    private val config: CoastApiConfig,
    private val client: OkHttpClient,
    private val json: Json = Json { ignoreUnknownKeys = true; explicitNulls = false; encodeDefaults = true }
) : DogtalkRepository {
    private val state = MutableStateFlow<Map<String, DogtalkUiState>>(emptyMap())
    private val ids = mutableMapOf<String, String?>()
    override val snapshots: StateFlow<Map<String, DogtalkUiState>> = state.asStateFlow()

    override fun cached(scope: DogtalkScope, conversationId: String): DogtalkUiState =
        state.value[key(scope, conversationId)] ?: DogtalkUiState()

    override suspend fun refresh(scope: DogtalkScope, conversationId: String): DogtalkUiState {
        val remote = request(
            Request.Builder().url(config.url(queryPath(scope, conversationId))).get().build(),
            RemoteDogtalkResponse.serializer()
        ).dogtalk
        return publish(scope, conversationId, remote)
    }

    override suspend fun save(scope: DogtalkScope, conversationId: String, value: DogtalkUiState): DogtalkUiState {
        val targetKey = key(scope, conversationId)
        val payload = RemoteDogtalkSaveRequest(
            id = ids[targetKey],
            roomScope = scope.wireValue,
            conversationId = conversationId.takeIf { scope == DogtalkScope.Main && it.isNotBlank() },
            body = value.body,
            trueCore = value.trueCore,
            weather = value.weather,
            readMode = value.readMode.wireValue
        )
        val remote = request(
            Request.Builder().url(config.url("/api/dogtalk")).put(json.encodeToString(payload).toRequestBody(JSON)).build(),
            RemoteDogtalkResponse.serializer()
        ).dogtalk
        return publish(scope, conversationId, remote)
    }

    private fun publish(scope: DogtalkScope, conversationId: String, remote: RemoteDogtalk): DogtalkUiState {
        val targetKey = key(scope, conversationId)
        ids[targetKey] = remote.id
        val value = DogtalkUiState(
            body = remote.body,
            trueCore = remote.trueCore,
            weather = remote.weather,
            readMode = DogtalkReadMode.fromWire(remote.readMode)
        )
        state.value = state.value + (targetKey to value)
        return value
    }

    private fun queryPath(scope: DogtalkScope, conversationId: String): String = buildString {
        append("/api/dogtalk?room_scope=")
        append(query(scope.wireValue))
        if (scope == DogtalkScope.Main && conversationId.isNotBlank()) {
            append("&conversation_id=")
            append(query(conversationId))
        }
    }

    private fun key(scope: DogtalkScope, conversationId: String): String =
        if (scope == DogtalkScope.Main) "conversation:$conversationId" else "${scope.wireValue}:main"

    private suspend fun <T> request(request: Request, serializer: kotlinx.serialization.KSerializer<T>): T = withContext(Dispatchers.IO) {
        try {
            client.newCall(request).execute().use { response ->
                val text = response.body?.string().orEmpty()
                if (!response.isSuccessful) throw responseError(response.code, text)
                runCatching { json.decodeFromString(serializer, text) }.getOrElse { cause ->
                    throw CoastApiException(CoastApiErrorKind.Decode, "invalid_json", "人类思考链返回的数据格式无法读取。", response.code, cause)
                }
            }
        } catch (error: CoastApiException) {
            throw error
        } catch (error: IOException) {
            throw CoastApiException(CoastApiErrorKind.Network, "network_unreachable", "无法连接后端。", cause = error)
        }
    }

    private fun responseError(status: Int, text: String): CoastApiException {
        var type = if (status == 401) "unauthorized" else "request_failed"
        var message = if (status == 401) "登录状态已失效。" else "人类思考链请求失败（$status）。"
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

    private companion object {
        val JSON = "application/json; charset=utf-8".toMediaType()
    }
}
