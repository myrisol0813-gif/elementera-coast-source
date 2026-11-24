package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.network.CoastApiErrorKind
import com.elementeracoast.app.core.network.CoastApiException
import com.elementeracoast.app.core.remote.RemoteChatMessage
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

sealed interface LocalProviderEvent {
    data class Delta(val text: String) : LocalProviderEvent
    data class Done(val reason: String) : LocalProviderEvent
}

/** Only sends to the explicitly selected provider; no cookies, redirects, Coast fallback or raw logs. */
class LocalProviderClient(private val http: OkHttpClient = OkHttpClient.Builder()
    .connectTimeout(15, TimeUnit.SECONDS).readTimeout(90, TimeUnit.SECONDS)
    .followRedirects(false).followSslRedirects(false).build()) {
    private val json = Json { ignoreUnknownKeys = true }
    private val media = "application/json".toMediaType()

    private fun request(p: LocalProviderConfig, suffix: String): Request.Builder =
        Request.Builder().url(normalizeLocalProviderUrl(p.baseUrl) + suffix)
            .header("Authorization", "Bearer " + p.apiKey)

    private fun failure(code: Int): CoastApiException = CoastApiException(
        CoastApiErrorKind.Model, "local_provider_http",
        when (code) {
            401 -> "供应商未接受 API Key，请检查是否复制完整、是否已失效。"
            403 -> "供应商禁止此请求，请检查模型访问权限、账户或策略限制。"
            402 -> "模型供应商报告余额不足。"
            429 -> "模型供应商限流或额度不足。"
            in 300..399 -> "供应商要求重定向；为保护 Key，已阻止跳转。请检查 Base URL。"
            else -> "模型供应商请求失败（HTTP $code）。"
        }, code)

    private suspend fun get(p: LocalProviderConfig, suffix: String): JsonObject = withContext(Dispatchers.IO) {
        try {
            http.newCall(request(p, suffix).get().build()).execute().use { response ->
                if (!response.isSuccessful) throw failure(response.code)
                json.parseToJsonElement(response.body?.string().orEmpty()).jsonObject
            }
        } catch (e: CancellationException) { throw e }
        catch (e: CoastApiException) { throw e }
        catch (_: Exception) { throw CoastApiException(CoastApiErrorKind.Model, "local_provider_request", "无法读取供应商响应，请检查网络与 API URL。") }
    }

    suspend fun models(p: LocalProviderConfig): List<String> {
        val data = get(p, "/models")["data"] as? JsonArray
            ?: throw CoastApiException(CoastApiErrorKind.Decode, "local_models_format", "供应商未返回兼容的模型目录。")
        return data.mapNotNull { (it as? JsonObject)?.get("id")?.jsonPrimitive?.contentOrNull }
            .filter(String::isNotBlank).distinct().take(3000)
    }

    suspend fun balance(p: LocalProviderConfig): String {
        val url = normalizeLocalProviderUrl(p.baseUrl).toHttpUrl()
        if (url.host != "openrouter.ai" || url.encodedPath.trimEnd('/') != "/api/v1")
            return "此供应商尚无已适配的余额接口，请以其账户页面为准。"
        val data = get(p, "/key")["data"]?.jsonObject
            ?: throw CoastApiException(CoastApiErrorKind.Decode, "local_balance_format", "供应商未返回额度数据。")
        val remaining = data["limit_remaining"]?.jsonPrimitive?.doubleOrNull
        val usage = data["usage"]?.jsonPrimitive?.doubleOrNull
        return "Key 限额剩余：" + (remaining?.let { "USD " + it } ?: "未设置限额或未返回") +
            "；已用：" + (usage?.let { "USD " + it } ?: "未返回") + "。这不是账户总余额。"
    }

    fun stream(p: LocalProviderConfig, model: String, messages: List<RemoteChatMessage>, maxTokens: Int): Flow<LocalProviderEvent> = callbackFlow {
        val payload = buildJsonObject {
            put("model", model)
            put("stream", true)
            val official = normalizeLocalProviderUrl(p.baseUrl).toHttpUrl().host == "api.openai.com"
            put(if (official) "max_completion_tokens" else "max_tokens", maxTokens.coerceIn(64, 65536))
            put("messages", buildJsonArray {
                messages.forEach { m -> add(buildJsonObject { put("role", m.role); put("content", m.content) }) }
            })
        }
        val call = http.newCall(request(p, "/chat/completions").header("Accept", "text/event-stream")
            .post(payload.toString().toRequestBody(media)).build())
        val reader = launch(Dispatchers.IO) {
            try {
                call.execute().use { response ->
                    if (!response.isSuccessful) throw failure(response.code)
                    val source = response.body?.source() ?: error("missing body")
                    var reason: String? = null
                    var done = false
                    while (!source.exhausted()) {
                        val line = source.readUtf8Line() ?: break
                        if (!line.startsWith("data:")) continue
                        val data = line.substringAfter("data:").trim()
                        if (data == "[DONE]") { done = true; break }
                        if (data.isBlank()) continue
                        val chunk = json.parseToJsonElement(data).jsonObject
                        if (chunk["error"] != null && chunk["error"] != JsonNull)
                            throw CoastApiException(CoastApiErrorKind.Model, "local_provider_error", "供应商在生成过程中返回错误。")
                        val choice = (chunk["choices"] as? JsonArray)?.firstOrNull() as? JsonObject ?: continue
                        val delta = (choice["delta"] as? JsonObject)?.get("content") as? JsonPrimitive
                        delta?.contentOrNull?.takeIf(String::isNotEmpty)?.let { send(LocalProviderEvent.Delta(it)) }
                        (choice["finish_reason"] as? JsonPrimitive)?.contentOrNull?.let { reason = it }
                    }
                    if (!done && reason == null) throw CoastApiException(CoastApiErrorKind.Stream, "local_stream_incomplete", "供应商回复流提前结束。")
                    if (reason == "tool_calls" || reason == "function_call") throw CoastApiException(CoastApiErrorKind.Model, "local_tools_pending", "本机工具执行尚未接入。")
                    send(LocalProviderEvent.Done(reason ?: "stop"))
                }
                close()
            } catch (e: CancellationException) { throw e }
            catch (e: CoastApiException) { close(e) }
            catch (_: Exception) { close(CoastApiException(CoastApiErrorKind.Stream, "local_provider_stream", "模型连接中断或返回格式不兼容。")) }
        }
        awaitClose { call.cancel(); reader.cancel() }
    }
}
