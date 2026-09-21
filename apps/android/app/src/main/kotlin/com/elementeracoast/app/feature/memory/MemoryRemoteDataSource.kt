package com.elementeracoast.app.feature.memory

import com.elementeracoast.app.core.network.CoastApiConfig
import com.elementeracoast.app.core.network.CoastApiErrorKind
import com.elementeracoast.app.core.network.CoastApiException
import com.elementeracoast.app.core.remote.RemoteCustomInstructions
import com.elementeracoast.app.core.remote.RemoteCustomInstructionsPutRequest
import com.elementeracoast.app.core.remote.RemoteCustomInstructionsResponse
import com.elementeracoast.app.core.remote.RemoteGlobalExcerptConfirmRequest
import com.elementeracoast.app.core.remote.RemoteGlobalExcerptPatchRequest
import com.elementeracoast.app.core.remote.RemoteGlobalExcerptResponse
import com.elementeracoast.app.core.remote.RemoteMemoryEntry
import com.elementeracoast.app.core.remote.RemoteMemoryEntryListResponse
import com.elementeracoast.app.core.remote.RemoteMemoryEntryResponse
import com.elementeracoast.app.core.remote.RemoteMemoryEntryWriteRequest
import com.elementeracoast.app.core.remote.RemoteMemoryPocket
import com.elementeracoast.app.core.remote.RemoteMemoryPocketListResponse
import com.elementeracoast.app.core.remote.RemoteMemoryPocketResolveRequest
import com.elementeracoast.app.core.remote.RemoteMemoryPocketResolveResponse
import com.elementeracoast.app.core.remote.RemoteWorldbookEntry
import com.elementeracoast.app.core.remote.RemoteWorldbookEntryResponse
import com.elementeracoast.app.core.remote.RemoteWorldbookEntryWriteRequest
import com.elementeracoast.app.core.remote.RemoteWorldbookListResponse
import com.elementeracoast.app.core.remote.RemoteWorldbookMatchRequest
import com.elementeracoast.app.core.remote.RemoteWorldbookMatchResponse
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
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

/** Memory-only typed remote source sharing CoastBackendGraph's single authenticated OkHttpClient. */
class MemoryRemoteDataSource(
    private val config: CoastApiConfig,
    private val client: OkHttpClient,
    private val json: Json = Json { ignoreUnknownKeys = true; explicitNulls = false; encodeDefaults = false }
) {
    suspend fun listEntries(entryType: String): List<RemoteMemoryEntry> = request(
        Request.Builder().url(config.url("/api/memory/entries?entry_type=${query(entryType)}&library=1&limit=100")).get().build(),
        RemoteMemoryEntryListResponse.serializer()
    ).entries

    suspend fun createEntry(value: RemoteMemoryEntryWriteRequest): RemoteMemoryEntry = request(
        Request.Builder().url(config.url("/api/memory/entries")).post(body(json.encodeToString(value))).build(),
        RemoteMemoryEntryResponse.serializer()
    ).entry

    suspend fun patchEntry(id: String, value: RemoteMemoryEntryWriteRequest): RemoteMemoryEntry = request(
        Request.Builder().url(config.url("/api/memory/entries/${path(id)}")).patch(body(json.encodeToString(value))).build(),
        RemoteMemoryEntryResponse.serializer()
    ).entry

    suspend fun deleteEntry(id: String) {
        requestElement(Request.Builder().url(config.url("/api/memory/entries/${path(id)}")).delete().build())
    }

    suspend fun listPockets(conversationId: String): List<RemoteMemoryPocket> = request(
        Request.Builder().url(config.url("/api/memory/pockets?conversation_id=${query(conversationId)}&status=pending")).get().build(),
        RemoteMemoryPocketListResponse.serializer()
    ).pockets

    suspend fun resolvePocket(id: String, value: RemoteMemoryPocketResolveRequest): RemoteMemoryPocketResolveResponse = request(
        Request.Builder().url(config.url("/api/memory/pockets/${path(id)}/resolve")).post(body(json.encodeToString(value))).build(),
        RemoteMemoryPocketResolveResponse.serializer()
    )

    suspend fun getInstructions(): RemoteCustomInstructions? = request(
        Request.Builder().url(config.url("/api/memory/custom-instructions")).get().build(),
        RemoteCustomInstructionsResponse.serializer()
    ).instructions

    suspend fun putInstructions(content: String): RemoteCustomInstructions? = request(
        Request.Builder().url(config.url("/api/memory/custom-instructions")).put(
            body(json.encodeToString(RemoteCustomInstructionsPutRequest(content = content)))
        ).build(),
        RemoteCustomInstructionsResponse.serializer()
    ).instructions

    suspend fun getGlobalExcerpt(): RemoteGlobalExcerptResponse = request(
        Request.Builder().url(config.url("/api/memory/global-excerpt")).get().build(),
        RemoteGlobalExcerptResponse.serializer()
    )

    suspend fun setGlobalExcerptWriteEnabled(enabled: Boolean): RemoteGlobalExcerptResponse = request(
        Request.Builder().url(config.url("/api/memory/global-excerpt")).patch(
            body(json.encodeToString(RemoteGlobalExcerptPatchRequest(writeEnabled = enabled)))
        ).build(),
        RemoteGlobalExcerptResponse.serializer()
    )

    suspend fun confirmGlobalExcerptCandidate(id: String, editedBody: String? = null): RemoteGlobalExcerptResponse = request(
        Request.Builder().url(config.url("/api/memory/global-excerpt/candidates/${path(id)}")).patch(
            body(json.encodeToString(RemoteGlobalExcerptConfirmRequest(
                action = "confirm",
                editedBody = editedBody,
                operator = "user"
            )))
        ).build(),
        RemoteGlobalExcerptResponse.serializer()
    )

    suspend fun discardGlobalExcerptCandidate(id: String) {
        requestElement(
            Request.Builder().url(config.url("/api/memory/global-excerpt/candidates/${path(id)}")).delete().build()
        )
    }

    suspend fun listWorldbook(): List<RemoteWorldbookEntry> = request(
        Request.Builder().url(config.url("/api/worldbook")).get().build(),
        RemoteWorldbookListResponse.serializer()
    ).entries

    suspend fun createWorldbook(value: RemoteWorldbookEntryWriteRequest): RemoteWorldbookEntry = request(
        Request.Builder().url(config.url("/api/worldbook")).post(body(json.encodeToString(value))).build(),
        RemoteWorldbookEntryResponse.serializer()
    ).entry

    suspend fun patchWorldbook(id: String, value: RemoteWorldbookEntryWriteRequest): RemoteWorldbookEntry = request(
        Request.Builder().url(config.url("/api/worldbook/${path(id)}")).patch(body(json.encodeToString(value))).build(),
        RemoteWorldbookEntryResponse.serializer()
    ).entry

    suspend fun deleteWorldbook(id: String) {
        requestElement(Request.Builder().url(config.url("/api/worldbook/${path(id)}")).delete().build())
    }

    suspend fun testWorldbook(input: String): List<RemoteWorldbookEntry> = request(
        Request.Builder().url(config.url("/api/worldbook/test-match")).post(
            body(json.encodeToString(RemoteWorldbookMatchRequest(input = input)))
        ).build(),
        RemoteWorldbookMatchResponse.serializer()
    ).matches

    private suspend fun <T> request(request: Request, serializer: KSerializer<T>): T = withContext(Dispatchers.IO) {
        try {
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) throw responseError(response.code, response.body?.string().orEmpty())
                val text = response.body?.string().orEmpty()
                runCatching { json.decodeFromString(serializer, text) }.getOrElse { cause ->
                    throw CoastApiException(CoastApiErrorKind.Decode, "invalid_json", "海岸记忆返回的数据格式无法读取。", response.code, cause)
                }
            }
        } catch (error: CoastApiException) {
            throw error
        } catch (error: IOException) {
            throw CoastApiException(CoastApiErrorKind.Network, "network_unreachable", "无法连接海岸后端。", cause = error)
        }
    }

    private suspend fun requestElement(request: Request) = withContext(Dispatchers.IO) {
        try {
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) throw responseError(response.code, response.body?.string().orEmpty())
                val text = response.body?.string().orEmpty()
                if (text.isNotBlank()) runCatching { json.parseToJsonElement(text) }.getOrElse { cause ->
                    throw CoastApiException(CoastApiErrorKind.Decode, "invalid_json", "海岸记忆返回的数据格式无法读取。", response.code, cause)
                }
            }
        } catch (error: CoastApiException) {
            throw error
        } catch (error: IOException) {
            throw CoastApiException(CoastApiErrorKind.Network, "network_unreachable", "无法连接海岸后端。", cause = error)
        }
    }

    private fun responseError(status: Int, text: String): CoastApiException {
        var type = if (status == 401) "unauthorized" else "request_failed"
        var message = if (status == 401) "登录状态已失效。" else "海岸记忆请求失败（$status）。"
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

    private fun body(value: String) = value.toRequestBody(JSON)
    private fun query(value: String) = java.net.URLEncoder.encode(value, Charsets.UTF_8.name())
    private fun path(value: String) = query(value).replace("+", "%20")

    private companion object { val JSON = "application/json; charset=utf-8".toMediaType() }
}
