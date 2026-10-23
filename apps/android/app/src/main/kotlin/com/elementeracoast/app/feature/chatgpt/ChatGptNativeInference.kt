package com.elementeracoast.app.feature.chatgpt

import com.elementeracoast.app.core.network.CoastApiClient
import com.elementeracoast.app.core.network.CoastApiErrorKind
import com.elementeracoast.app.core.network.CoastApiException
import com.elementeracoast.app.core.remote.RemoteChatRequest
import com.elementeracoast.app.core.remote.RemoteDeskSlip
import com.elementeracoast.app.core.remote.RemoteFurnitureRun
import com.elementeracoast.app.core.remote.RemoteNativeChatContext
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*
import okhttp3.Call
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

internal sealed interface NativeChatEvent {
    data class Delta(val text: String) : NativeChatEvent
    data class Tool(val id: String, val name: String, val ok: Boolean) : NativeChatEvent
    data class Completed(
        val text: String,
        val usage: NativeChatUsage,
        val deskSlip: RemoteDeskSlip,
        val furnitureRuns: List<RemoteFurnitureRun>,
        val requestedReasoningEffort: String? = null,
        val returnedReasoningEffort: String? = null
    ) : NativeChatEvent
}

/**
 * Read instruction strings only from system/developer messages. User content can be
 * a multimodal array (text + image); calling jsonPrimitive on it throws.
 */
internal fun nativeSystemInstructions(messages: List<JsonElement>): String =
    messages.mapNotNull { message ->
        val obj = message as? JsonObject ?: return@mapNotNull null
        val role = (obj["role"] as? JsonPrimitive)?.contentOrNull
        if (role !in listOf("system", "developer")) return@mapNotNull null
        (obj["content"] as? JsonPrimitive)?.contentOrNull
    }.joinToString("\n\n")

/** Convert the Coast message-parts contract to Responses input without dropping images. */
internal fun normalizeNativeInput(obj: JsonObject): JsonObject {
    val content = obj["content"]
    if (content !is JsonArray) return obj
    return buildJsonObject {
        put("role", obj["role"] ?: JsonPrimitive("user"))
        put("content", buildJsonArray {
            content.forEach { part ->
                val item = part as? JsonObject ?: throw CoastApiException(
                    CoastApiErrorKind.Request, "unsupported_native_input",
                    "图片或文字附件结构不完整。"
                )
                when ((item["type"] as? JsonPrimitive)?.contentOrNull) {
                    "text" -> add(buildJsonObject {
                        put("type", "input_text")
                        put("text", (item["text"] as? JsonPrimitive)?.contentOrNull.orEmpty())
                    })
                    "image_url" -> {
                        val url = ((item["image_url"] as? JsonObject)?.get("url") as? JsonPrimitive)
                            ?.contentOrNull.orEmpty()
                        if (!url.startsWith("data:image/") && !url.startsWith("https://")) {
                            throw CoastApiException(CoastApiErrorKind.Request,
                                "unsupported_native_image_url", "图片附件缺少有效的图像地址。")
                        }
                        add(buildJsonObject { put("type", "input_image"); put("image_url", url) })
                    }
                    else -> throw CoastApiException(
                        CoastApiErrorKind.Request, "unsupported_native_input",
                        "此附件格式不被当前 ChatGPT 模型接受。"
                    )
                }
            }
        })
    }
}

internal data class NativeCoastToolCall(val callId: String, val name: String)

/** The namespace remains attached to every replayed tool result in stateless Responses turns. */
internal fun parseNativeCoastToolCall(tool: JsonObject): NativeCoastToolCall {
    val namespace = tool["namespace"]?.jsonPrimitive?.contentOrNull
    val rawName = tool["name"]?.jsonPrimitive?.contentOrNull.orEmpty()
    val name = rawName.removePrefix("coast.")
    val callId = tool["call_id"]?.jsonPrimitive?.contentOrNull.orEmpty()
    if ((namespace != null && namespace != "coast") || callId.isBlank() || name.isBlank()) {
        throw CoastApiException(CoastApiErrorKind.Decode, "invalid_tool_call", "ChatGPT 工具调用信息不完整或不属于当前 Coast 工具清单。")
    }
    return NativeCoastToolCall(callId, name)
}

internal fun nativeCoastToolOutput(call: NativeCoastToolCall, output: String): JsonObject = buildJsonObject {
    put("type", "function_call_output")
    put("call_id", call.callId)
    put("name", call.name)
    put("namespace", "coast")
    put("output", output)
}

/**
 * The completed Responses payload is the authoritative source of message text and tool calls.
 * Some successful streams omit output_text.delta events even though the final message has text.
 */
internal data class NativeResponseOutput(
    val items: JsonArray,
    val toolCalls: List<JsonObject>,
    val finalText: String,
    val hasReasoning: Boolean
)

/**
 * A completed Responses event is not guaranteed to repeat its output list. Capture full
 * output_item.done frames, which include completed function arguments, as a fallback.
 */
internal fun readNativeResponseOutput(
    response: JsonObject,
    streamedItems: Map<Int, JsonObject> = emptyMap()
): NativeResponseOutput {
    val finalItems = response["output"] as? JsonArray
    val items = if (finalItems != null && finalItems.isNotEmpty()) finalItems
        else JsonArray(streamedItems.toSortedMap().values.toList())
    val objects = items.mapNotNull { it as? JsonObject }
    val toolCalls = objects.filter { it["type"]?.jsonPrimitive?.contentOrNull == "function_call" }
    val finalText = objects
        .filter { it["type"]?.jsonPrimitive?.contentOrNull == "message" }
        .flatMap { (it["content"] as? JsonArray)?.toList().orEmpty() }
        .mapNotNull { it as? JsonObject }
        .filter { it["type"]?.jsonPrimitive?.contentOrNull == "output_text" }
        .joinToString("") { it["text"]?.jsonPrimitive?.contentOrNull.orEmpty() }
    return NativeResponseOutput(
        items, toolCalls, finalText,
        objects.any { it["type"]?.jsonPrimitive?.contentOrNull == "reasoning" }
    )
}

/** Never emit a duplicate of text that was already streamed to the UI. */
internal fun missingNativeFinalText(streamed: String, finalText: String): String =
    if (finalText.startsWith(streamed)) finalText.drop(streamed.length) else ""

/** Ignore partial output_item.added frames: only done frames are safe to execute. */
internal fun completedNativeStreamItem(event: JsonObject): Pair<Int, JsonObject>? {
    if (event["type"]?.jsonPrimitive?.contentOrNull != "response.output_item.done") return null
    val index = event["output_index"]?.jsonPrimitive?.intOrNull ?: return null
    val item = event["item"] as? JsonObject ?: return null
    if (item["status"]?.jsonPrimitive?.contentOrNull == "incomplete") return null
    return index to item
}

/** Only structural, provider-supplied metadata is exposed in errors; never content or args. */
internal fun nativeOutputKinds(output: NativeResponseOutput): String =
    output.items.mapNotNull { (it as? JsonObject)?.get("type")?.jsonPrimitive?.contentOrNull }
        .map { kind -> when (kind) {
            "message", "function_call", "reasoning", "program", "program_output",
            "tool_search_call", "tool_search_output" -> kind
            else -> "other"
        } }.distinct().take(6).joinToString(",").ifBlank { "none" }

/**
 * Hosted search is opt-in per user query. Never inject a hosted search into ordinary
 * requests for models whose account policy may not allow it.
 */
internal fun requestsNativeWebSearch(userText: String): Boolean =
    Regex(
        "联网|上网.{0,5}(搜|查|找)|网上.{0,5}(搜|查|找)|网页搜索|搜索网页|网络搜索|搜索新闻|搜索最新|搜索一下|搜一下|帮我搜索|帮我搜|search the web|web search",
        RegexOption.IGNORE_CASE
    ).containsMatchIn(userText)

/** Preserve provider-supplied URL citations without showing internal tool arguments. */
internal fun nativeWebSearchSources(output: NativeResponseOutput): List<String> {
    val sources = mutableListOf<String>()
    val objects = output.items.mapNotNull { it as? JsonObject }
    objects.forEach { item ->
        when (item["type"]?.jsonPrimitive?.contentOrNull) {
            "message" -> (item["content"] as? JsonArray).orEmpty().forEach { content ->
                val body = content as? JsonObject ?: return@forEach
                (body["annotations"] as? JsonArray).orEmpty().forEach { annotation ->
                    val obj = annotation as? JsonObject ?: return@forEach
                    obj["url"]?.jsonPrimitive?.contentOrNull?.let(sources::add)
                }
            }
            "web_search_call" -> {
                val action = item["action"] as? JsonObject
                (action?.get("sources") as? JsonArray).orEmpty().forEach { source ->
                    val obj = source as? JsonObject ?: return@forEach
                    obj["url"]?.jsonPrimitive?.contentOrNull?.let(sources::add)
                }
            }
        }
    }
    return sources.mapNotNull { raw ->
        runCatching {
            val uri = java.net.URI(raw)
            if (uri.scheme !in listOf("https", "http") || uri.host.isNullOrBlank()) null
            else raw.take(1400)
        }.getOrNull()
    }.distinct().take(6)
}

internal fun nativeVisionCount(input: JsonArray): Int =
    input.sumOf { message ->
        val body = (message as? JsonObject)?.get("content") as? JsonArray
        body.orEmpty().count { (it as? JsonObject)?.get("type")?.jsonPrimitive?.contentOrNull == "input_image" }
    }

/** A strictly structural failure report: never surface exception messages or raw model payloads. */
internal fun diagnoseNativeInferenceFailure(
    error: Exception, stage: String, imageCount: Int, requestCharsK: Int
): CoastApiException {
    val failure = when (error) {
        is java.net.SocketTimeoutException -> "timeout"
        is java.net.UnknownHostException -> "dns"
        is javax.net.ssl.SSLException -> "tls"
        is java.io.EOFException -> "connection_closed"
        is java.net.SocketException -> "connection"
        is java.io.IOException -> "io"
        else -> "processing"
    }
    val description = when (failure) {
        "timeout" -> "请求等待超时"
        "dns" -> "域名解析失败"
        "tls" -> "安全连接失败"
        "connection_closed" -> "连接提前断开"
        "connection", "io" -> "网络传输失败"
        else -> "处理模型数据时发生异常"
    }
    val validStage = stage.takeIf { it in setOf(
        "authorization", "input_preparation", "openai_request",
        "openai_response", "openai_stream", "output_processing", "coast_tool_execution"
    ) } ?: "unknown"
    return CoastApiException(
        if (error is java.io.IOException) CoastApiErrorKind.Network else CoastApiErrorKind.Decode,
        "chatgpt_plan_${failure}_${validStage}",
        "ChatGPT ${description}（阶段=${validStage}；图片数=${imageCount.coerceAtLeast(0)}；请求长度约=${requestCharsK.coerceAtLeast(0)}K字符）。未传输私密错误细节。",
        cause = error
    )
}

internal data class NativeChatUsage(
    val input: Long = 0,
    val cached: Long = 0,
    val output: Long = 0,
    val reported: Boolean = false
)

/** All inference is local-to-OpenAI; Coast receives neither OAuth access nor refresh tokens. */
internal class ChatGptNativeInference(
    private val account: ChatGptPlanRepository,
    private val coast: CoastApiClient,
    client: OkHttpClient = OkHttpClient()
) {
    private val http = client.newBuilder().readTimeout(120, TimeUnit.SECONDS).build()
    private val json = Json { ignoreUnknownKeys = true }

    fun stream(
        model: String,
        request: RemoteChatRequest,
        prepared: RemoteNativeChatContext,
        reasoningEffort: String? = null
    ): Flow<NativeChatEvent> = callbackFlow {
        val activeCall = AtomicReference<Call?>()
        val job = launch(Dispatchers.IO) {
            var stage = "authorization"
            var imageCount = 0
            var requestKiB = 0
            try {
                val access = account.accessTokenForInference()
                stage = "input_preparation"
                val voiceToolAvailable = prepared.tools.any { item ->
                    (item as? JsonObject)?.get("name")?.jsonPrimitive?.contentOrNull == "voice_create"
                }
                val instructions = nativeSystemInstructions(prepared.modelMessages) +
                    if (voiceToolAvailable) "\\n用户明确要求合成或留存语音时，使用 coast.voice_create 工具。没有成功的真实工具结果时，不得声称已生成语音，不得编造音频 URL 或输出占位变量。" else ""
                val history = mutableListOf<JsonElement>()
                prepared.modelMessages.forEach { message ->
                    val obj = message.jsonObject
                    if (obj["role"]?.jsonPrimitive?.contentOrNull !in listOf("system", "developer")) {
                        history.add(normalizeNativeInput(obj))
                    }
                }
                imageCount = nativeVisionCount(JsonArray(history))
                // Evaluate the user's real message, not a rewritten/assembled model context item.
                val searchEnabled = request.messages.lastOrNull()
                    ?.takeIf { it.role == "user" }
                    ?.content?.let(::requestsNativeWebSearch) ?: false
                val searchSources = linkedSetOf<String>()
                var didSearch = false
                var returnedReasoningEffort: String? = null
                val text = StringBuilder()
                val runs = mutableListOf<RemoteFurnitureRun>()
                var desk = prepared.deskSlip
                var usageTotal = NativeChatUsage()
                var callsMade = 0

                for (round in 0..12) {
                    val body = buildJsonObject {
                        put("model", model)
                        put("input", JsonArray(history))
                        put("store", false)
                        put("stream", true)
                        if (reasoningEffort != null) put("reasoning", buildJsonObject {
                            put("effort", reasoningEffort)
                        })
                        // Preserve stateless reasoning across tool-call continuation on older Responses backends.
                        put("include", buildJsonArray { add("reasoning.encrypted_content") })
                        if (instructions.isNotBlank()) put("instructions", instructions)
                        // A direct request to search must use search, not merely offer it as optional.
                        // Force only the provider-hosted tool; this never selects Coast write tools.
                        if (searchEnabled && round == 0) put("tool_choice", buildJsonObject {
                            put("type", "web_search")
                        })
                        if (prepared.tools.isNotEmpty() || searchEnabled) put("tools", buildJsonArray {
                            if (prepared.tools.isNotEmpty()) add(buildJsonObject {
                                put("type", "namespace")
                                put("name", "coast")
                                put("description", "海岸授权工具：记忆、日记、日历、书房、语音生成和开发工具。语音创建请使用 voice_create，未执行不能声称完成。")
                                put("tools", prepared.tools)
                            })
                            if (searchEnabled) add(buildJsonObject { put("type", "web_search") })
                        })
                    }
                    val payload = body.toString()
                    requestKiB = payload.length / 1024 // character count only; no private content logged
                    stage = "openai_request"
                    val call = http.newCall(Request.Builder()
                        .url("https://api.openai.com/v1/responses")
                        .header("Authorization", "Bearer " + access)
                        .header("Accept", "text/event-stream")
                        .post(payload.toRequestBody("application/json; charset=utf-8".toMediaType()))
                        .build())
                    activeCall.set(call)
                    var completed: JsonObject? = null
                    val streamedItems = mutableMapOf<Int, JsonObject>()
                    val roundText = StringBuilder()
                    call.execute().use { response ->
                        stage = "openai_response"
                        if (!response.isSuccessful) throw CoastApiException(
                            CoastApiErrorKind.Model,
                            "chatgpt_plan_http_" + response.code,
                            (if (round > 0) "ChatGPT 接收工具结果后无法继续（HTTP " else "ChatGPT 未接受请求（HTTP ") +
                                response.code + "）。" + if (searchEnabled && response.code in listOf(400, 403))
                                "本轮请求包含网页搜索，当前模型或账号可能不支持；可换模型或不请求联网。"
                            else "请检查模型权限或本轮工具调用。",
                            response.code
                        )
                        stage = "openai_stream"
                        response.body?.charStream()?.buffered()?.use { reader ->
                            while (true) {
                                val line = reader.readLine() ?: break
                                if (!line.startsWith("data: ")) continue
                                val raw = line.removePrefix("data: ").trim()
                                if (raw == "[DONE]") break
                                val event = runCatching { json.parseToJsonElement(raw).jsonObject }.getOrNull()
                                    ?: continue
                                completedNativeStreamItem(event)?.let { (index, item) ->
                                    streamedItems[index] = item
                                }
                                when (event["type"]?.jsonPrimitive?.contentOrNull) {
                                    "response.output_text.delta" -> {
                                        val delta = event["delta"]?.jsonPrimitive?.contentOrNull.orEmpty()
                                        text.append(delta)
                                        roundText.append(delta)
                                        trySend(NativeChatEvent.Delta(delta))
                                    }
                                    "response.completed" -> completed = event["response"] as? JsonObject
                                    "response.failed" -> {
                                        val error = (event["response"] as? JsonObject)?.get("error") as? JsonObject
                                        val code = error?.get("code")?.jsonPrimitive?.contentOrNull.orEmpty()
                                        throw CoastApiException(
                                            CoastApiErrorKind.Model,
                                            code.ifBlank { "chatgpt_plan_failed" }.take(80),
                                            "ChatGPT 返回失败；请检查账户额度或模型权限。"
                                        )
                                    }
                                    "response.incomplete" -> throw CoastApiException(
                                        CoastApiErrorKind.Stream, "chatgpt_plan_incomplete", "模型回复未完整结束。"
                                    )
                                }
                            }
                        }
                    }
                    activeCall.set(null)
                    stage = "output_processing"
                    val response = completed ?: throw CoastApiException(
                        CoastApiErrorKind.Stream, "chatgpt_plan_incomplete", "ChatGPT 回复流提前中断。"
                    )
                    returnedReasoningEffort = (response["reasoning"] as? JsonObject)
                        ?.get("effort")?.jsonPrimitive?.contentOrNull ?: returnedReasoningEffort
                    val usage = response["usage"] as? JsonObject
                    val detail = usage?.get("input_tokens_details") as? JsonObject
                    usageTotal = usageTotal.copy(
                        input = usageTotal.input + (usage?.get("input_tokens")?.jsonPrimitive?.longOrNull ?: 0),
                        cached = usageTotal.cached + (detail?.get("cached_tokens")?.jsonPrimitive?.longOrNull ?: 0),
                        output = usageTotal.output + (usage?.get("output_tokens")?.jsonPrimitive?.longOrNull ?: 0),
                        reported = usageTotal.reported || usage != null
                    )
                    val output = readNativeResponseOutput(response, streamedItems)
                    val finishedSearch: (JsonObject) -> Boolean = { item ->
                        item["type"]?.jsonPrimitive?.contentOrNull == "web_search_call" &&
                            item["status"]?.jsonPrimitive?.contentOrNull !in listOf("failed", "incomplete")
                    }
                    if (output.items.mapNotNull { it as? JsonObject }.any(finishedSearch)
                        || streamedItems.values.any(finishedSearch)) {
                        didSearch = true
                    }
                    searchSources.addAll(nativeWebSearchSources(output))
                    if (streamedItems.isNotEmpty()) {
                        searchSources.addAll(nativeWebSearchSources(
                            readNativeResponseOutput(buildJsonObject { }, streamedItems)
                        ))
                    }
                    val missingText = missingNativeFinalText(roundText.toString(), output.finalText)
                    if (missingText.isNotEmpty()) {
                        text.append(missingText)
                        trySend(NativeChatEvent.Delta(missingText))
                    }
                    val pending = output.toolCalls
                    if (pending.isEmpty()) {
                        if (text.isBlank()) {
                            val detail = when {
                                output.hasReasoning -> "只有推理输出"
                                output.items.isNotEmpty() -> "没有可显示的正文或可执行工具"
                                else -> "没有返回任何输出项目"
                            }
                            val guidance = when {
                                callsMade > 0 -> "工具可能已执行；请先核对朋友圈或工具记录，勿直接重发。"
                                prepared.tools.isEmpty() -> "海岸本轮未向模型提供工具，请检查后端工具权限。"
                                else -> "本轮未收到可执行的工具调用，请保留本轮回执供排查。"
                            }
                            val status = response["status"]?.jsonPrimitive?.contentOrNull ?: "unknown"
                            throw CoastApiException(
                                CoastApiErrorKind.Model, "chatgpt_plan_empty",
                                "ChatGPT $detail。$guidance（状态=$status；工具数=${prepared.tools.size}；流输出项=${streamedItems.size}；类型=${nativeOutputKinds(output)}）"
                            )
                        }
                        if (didSearch) {
                            trySend(NativeChatEvent.Tool("web_search", "网页搜索", true))
                            if (searchSources.isNotEmpty()) {
                                val references = searchSources.joinToString("\n") { "- $it" }
                                val supplement = "\n\n搜索来源：\n$references"
                                text.append(supplement)
                                trySend(NativeChatEvent.Delta(supplement))
                            }
                        }
                        if (searchEnabled && !didSearch) {
                            trySend(NativeChatEvent.Tool("web_search", "模型未执行本轮请求的网页搜索", false))
                            val warning = "\n\n提示：本轮虽已向模型提供网页搜索工具，但模型未实际调用，以上内容不属于实时搜索结果。"
                            text.append(warning)
                            trySend(NativeChatEvent.Delta(warning))
                        }
                        if (imageCount > 0) trySend(NativeChatEvent.Tool("vision_input", "图片已递入模型输入 $imageCount 张（不代表模型已识别）", true))
                        trySend(NativeChatEvent.Completed(
                            text.toString(), usageTotal, desk, runs,
                            reasoningEffort, returnedReasoningEffort
                        ))
                        break
                    }
                    if (round == 12 || callsMade + pending.size > 12) throw CoastApiException(
                        CoastApiErrorKind.Model, "tool_limit", "这轮的工具调用超过 12 次。"
                    )
                    history.addAll(output.items)
                    for (tool in pending) {
                        stage = "coast_tool_execution"
                        val requestedTool = parseNativeCoastToolCall(tool)
                        val callId = requestedTool.callId
                        val name = requestedTool.name
                        val params = buildJsonObject {
                            put("id", callId)
                            put("type", "function")
                            put("function", buildJsonObject {
                                put("name", name)
                                put("arguments", tool["arguments"]?.jsonPrimitive?.contentOrNull ?: "{}")
                            })
                        }
                        val result = coast.executeNativeChatGptTool(request, params, callsMade++)
                        runs.addAll(result.furnitureRuns)
                        desk = result.deskSlip
                        trySend(NativeChatEvent.Tool(callId, name, result.ok))
                        history.add(nativeCoastToolOutput(requestedTool, result.output))
                    }
                }
            } catch (cancelled: CancellationException) {
                close()
                throw cancelled
            } catch (error: Exception) {
                val diagnosed = if (error is CoastApiException) error
                    else diagnoseNativeInferenceFailure(error, stage, imageCount, requestKiB)
                close(diagnosed)
                return@launch
            } finally {
                activeCall.getAndSet(null)?.cancel()
                close()
            }
        }
        awaitClose { activeCall.getAndSet(null)?.cancel(); job.cancel() }
    }

}
