package com.elementeracoast.app.feature.chatgpt

import java.net.InetAddress
import java.net.ServerSocket
import java.net.SocketTimeoutException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import okhttp3.FormBody
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/** Display only exact account-catalog effort values; unknown means no slider. */
internal fun decodeChatGptReasoningEfforts(model: JsonObject): List<String> {
    val known = listOf("none", "minimal", "low", "medium", "high", "xhigh", "max")
    val source = model["supported_reasoning_efforts"] ?: model["reasoning_efforts"]
        ?: (model["reasoning"] as? JsonObject)?.get("efforts")
    val advertised = (source as? JsonArray).orEmpty().mapNotNull {
        (it as? JsonPrimitive)?.contentOrNull
    }
    return known.filter(advertised::contains)
}

data class ChatGptAccountModel(
    val slug: String,
    val displayName: String,
    val reasoningEfforts: List<String> = emptyList()
)
data class ChatGptProbeResult(
    val text: String,
    val inputTokens: Long?,
    val cachedTokens: Long?,
    val outputTokens: Long?
)

/** Native-only ChatGPT plan client. Tokens never pass through the Coast server. */
class ChatGptPlanRepository(
    private val store: ChatGptSecureStore,
    private val http: OkHttpClient = OkHttpClient()
) {
    private val json = Json { ignoreUnknownKeys = true }
    private val mutex = Mutex()
    @Volatile private var latestModels = emptyList<ChatGptAccountModel>()

    fun reasoningEffortsFor(slug: String): List<String> =
        latestModels.firstOrNull { it.slug == slug }?.reasoningEfforts.orEmpty()

    fun currentAccount(): ChatGptConnection? = store.load()
    fun preferredModel(): String? = store.preferredModel()
    fun selectModel(slug: String?) = store.selectModel(slug)

    /** Only the local Native inference adapter receives this token, never Coast Cloudflare. */
    internal suspend fun accessTokenForInference(): String = mutex.withLock {
        withContext(Dispatchers.IO) { activeCredentials().accessToken }
    }

    suspend fun connect(openBrowser: (String) -> Unit): ChatGptConnection = mutex.withLock {
        val existing = store.load()
        val hostId = store.hostId()
        val state = ChatGptOAuthProtocol.randomUrlSafe()
        val nonce = ChatGptOAuthProtocol.randomUrlSafe()
        val verifier = ChatGptOAuthProtocol.randomUrlSafe(64)
        val server = withContext(Dispatchers.IO) {
            ServerSocket(0, 1, InetAddress.getByName("127.0.0.1")).apply {
                soTimeout = 180_000
            }
        }
        try {
            val redirect = "http://127.0.0.1:" + server.localPort + ChatGptOAuthProtocol.CALLBACK_PATH
            val url = ChatGptOAuthProtocol.authorizationUrl(
                hostId, redirect, state, nonce, ChatGptOAuthProtocol.challenge(verifier), existing
            )
            withContext(Dispatchers.Main) { openBrowser(url) }
            val callback = withContext(Dispatchers.IO) {
                var answer: ChatGptOAuthProtocol.Callback? = null
                repeat(5) {
                    if (answer == null) {
                        server.accept().use { socket ->
                            require(socket.inetAddress.isLoopbackAddress)
                            socket.soTimeout = 10_000
                            val line = socket.getInputStream().bufferedReader().readLine().orEmpty()
                            val requestPath = line.split(" ").getOrNull(1).orEmpty()
                            if (line.startsWith("GET ") &&
                                requestPath.substringBefore("?") == ChatGptOAuthProtocol.CALLBACK_PATH
                            ) {
                                answer = ChatGptOAuthProtocol.verifyCallback(
                                    requestPath, state, existing?.clientId
                                )
                                respond(socket, "授权已收到，请回海岸查看结果。")
                            } else respond(socket, "此地址仅供海岸 ChatGPT 登录。")
                        }
                    }
                }
                answer ?: error("ChatGPT 登录没有收到有效回调。")
            }
            val response = withContext(Dispatchers.IO) {
                postToken(
                    FormBody.Builder()
                        .add("grant_type", "authorization_code")
                        .add("client_id", callback.clientId)
                        .add("code", callback.code)
                        .add("code_verifier", verifier)
                        .add("redirect_uri", redirect)
                        .add("resource", ChatGptOAuthProtocol.RESOURCE_URL)
                        .build()
                )
            }
            val idToken = response["id_token"]?.jsonPrimitive?.contentOrNull.orEmpty()
            val identity = withContext(Dispatchers.IO) {
                ChatGptIdentityVerifier(http).verify(idToken, callback.clientId, nonce)
            }
            if (existing != null) require(identity.subject == existing.subject) {
                "ChatGPT 登录的账户与原账户不一致。"
            }
            val scopes = response["scope"]?.jsonPrimitive?.contentOrNull.orEmpty()
                .split(" ").filter(String::isNotBlank)
            require("chatgpt.tokens.use.direct" in scopes && "resource.invoke" in scopes) {
                "当前账户未批准 ChatGPT 套餐调用权限。"
            }
            val access = response["access_token"]?.jsonPrimitive?.contentOrNull.orEmpty()
            val refresh = response["refresh_token"]?.jsonPrimitive?.contentOrNull.orEmpty()
            require(access.isNotBlank() && refresh.isNotBlank())
            val value = ChatGptConnection(
                clientId = callback.clientId, hostId = hostId, subject = identity.subject,
                email = identity.email, idToken = idToken, accessToken = access,
                refreshToken = refresh, scopes = scopes,
                expiresAtEpochSeconds = System.currentTimeMillis() / 1000 +
                    (response["expires_in"]?.jsonPrimitive?.longOrNull ?: 3600L)
            )
            withContext(Dispatchers.IO) { store.save(value) }
            value
        } catch (_: SocketTimeoutException) {
            throw IllegalStateException("ChatGPT 授权超时，请回海岸重试。")
        } finally {
            server.close()
        }
    }

    suspend fun models(): List<ChatGptAccountModel> = mutex.withLock {
        val access = withContext(Dispatchers.IO) { activeCredentials().accessToken }
        withContext(Dispatchers.IO) {
            val request = Request.Builder()
                .url("https://api.openai.com/v1/models")
                .header("Authorization", "Bearer " + access).get().build()
            val catalog = http.newCall(request).execute().use { response ->
                check(response.isSuccessful) { "模型目录未能载入（HTTP " + response.code + "）。" }
                json.parseToJsonElement(response.body?.string().orEmpty()).jsonObject
            }
            val models = (catalog["models"] as? JsonArray).orEmpty().mapNotNull {
                val item = it as? JsonObject ?: return@mapNotNull null
                if (item["visibility"]?.jsonPrimitive?.contentOrNull != "list") return@mapNotNull null
                val slug = item["slug"]?.jsonPrimitive?.contentOrNull.orEmpty()
                if (slug.isBlank()) null else ChatGptAccountModel(
                    slug, item["display_name"]?.jsonPrimitive?.contentOrNull.orEmpty().ifBlank { slug },
                    decodeChatGptReasoningEfforts(item)
                )
            }
            latestModels = models
            models
        }
    }

    /** One real, user-triggered Responses API smoke test; does not alter chat history. */
    suspend fun probe(model: String): ChatGptProbeResult =
        completeText(model, "请只回答：海岸已连接。")

    /** Also used for plan-funded thought-soil, never routed to OpenRouter. */
    suspend fun completeText(model: String, prompt: String): ChatGptProbeResult = mutex.withLock {
        require(model.isNotBlank() && prompt.isNotBlank())
        val access = withContext(Dispatchers.IO) { activeCredentials().accessToken }
        withContext(Dispatchers.IO) {
            val payload = buildJsonObject {
                put("model", model)
                put("input", buildJsonArray { add(buildJsonObject {
                    put("role", "user")
                    put("content", prompt)
                }) })
                put("store", false)
                put("stream", true)
            }.toString()
            val request = Request.Builder()
                .url("https://api.openai.com/v1/responses")
                .header("Authorization", "Bearer " + access)
                .header("Accept", "text/event-stream")
                .post(payload.toRequestBody("application/json; charset=utf-8".toMediaType()))
                .build()
            http.newBuilder()
                .readTimeout(120, java.util.concurrent.TimeUnit.SECONDS)
                .build().newCall(request).execute().use { response ->
                check(response.isSuccessful) {
                    "GPT 套餐请求未被接受（HTTP " + response.code + "）。"
                }
                val output = StringBuilder()
                var completed: JsonObject? = null
                response.body?.charStream()?.buffered()?.use { reader ->
                    while (true) {
                        val line = reader.readLine() ?: break
                        if (!line.startsWith("data: ")) continue
                        val data = line.removePrefix("data: ").trim()
                        if (data == "[DONE]") break
                        val event = runCatching { json.parseToJsonElement(data).jsonObject }
                            .getOrNull() ?: continue
                        when (event["type"]?.jsonPrimitive?.contentOrNull) {
                            "response.output_text.delta" ->
                                output.append(event["delta"]?.jsonPrimitive?.contentOrNull.orEmpty())
                            "response.completed" -> completed = event["response"] as? JsonObject
                            "response.failed" -> error("GPT 返回失败；请查看套餐用量或重新授权。")
                            "response.incomplete" -> error("GPT 回复没有完整完成。")
                        }
                    }
                }
                val final = completed ?: error("GPT 回复流缺少 response.completed。")
                require(output.isNotBlank()) { "GPT 没有返回思维壤正文。" }
                require(output.length <= 10000) { "GPT 思维壤整理结果超过后端允许的 10000 字符。" }
                val usage = final["usage"] as? JsonObject
                val inputDetails = usage?.get("input_tokens_details") as? JsonObject
                ChatGptProbeResult(
                    output.toString(),
                    usage?.get("input_tokens")?.jsonPrimitive?.longOrNull,
                    inputDetails?.get("cached_tokens")?.jsonPrimitive?.longOrNull,
                    usage?.get("output_tokens")?.jsonPrimitive?.longOrNull
                )
            }
        }
    }

    suspend fun disconnect(): Boolean = mutex.withLock {
        val current = store.load() ?: return@withLock true
        val revoked = withContext(Dispatchers.IO) {
            runCatching {
                val discovery = http.newCall(Request.Builder()
                    .url("https://auth.openai.com/.well-known/openid-configuration").build())
                    .execute().use { response ->
                        check(response.isSuccessful)
                        json.parseToJsonElement(response.body?.string().orEmpty()).jsonObject
                    }
                val endpoint = discovery["revocation_endpoint"]?.jsonPrimitive?.contentOrNull.orEmpty()
                require(endpoint.startsWith("https://auth.openai.com/"))
                val body = FormBody.Builder()
                    .add("token", current.refreshToken)
                    .add("token_type_hint", "refresh_token")
                    .add("client_id", current.clientId).build()
                http.newCall(Request.Builder().url(endpoint).post(body).build()).execute().use {
                    it.code == 200
                }
            }.getOrDefault(false)
        }
        withContext(Dispatchers.IO) { store.clear() }
        revoked
    }

    private fun activeCredentials(): ChatGptConnection {
        val value = store.load() ?: error("请先连接 ChatGPT。")
        if (value.expiresAtEpochSeconds > System.currentTimeMillis() / 1000 + 120) return value
        val renewed = postToken(FormBody.Builder()
            .add("grant_type", "refresh_token")
            .add("client_id", value.clientId)
            .add("refresh_token", value.refreshToken)
            .add("resource", ChatGptOAuthProtocol.RESOURCE_URL).build())
        val access = renewed["access_token"]?.jsonPrimitive?.contentOrNull.orEmpty()
        val refresh = renewed["refresh_token"]?.jsonPrimitive?.contentOrNull.orEmpty()
        require(access.isNotBlank() && refresh.isNotBlank()) { "ChatGPT 凭证续期失败，请重新授权。" }
        val scopes = renewed["scope"]?.jsonPrimitive?.contentOrNull
            ?.split(" ")?.filter(String::isNotBlank) ?: value.scopes
        require("chatgpt.tokens.use.direct" in scopes) { "ChatGPT 套餐权限已失效。" }
        return value.copy(
            accessToken = access,
            refreshToken = refresh,
            scopes = scopes,
            expiresAtEpochSeconds = System.currentTimeMillis() / 1000 +
                (renewed["expires_in"]?.jsonPrimitive?.longOrNull ?: 3600L)
        ).also(store::save)
    }

    private fun postToken(body: FormBody): JsonObject =
        http.newCall(Request.Builder().url(ChatGptOAuthProtocol.TOKEN_ENDPOINT).post(body).build())
            .execute().use { response ->
                check(response.isSuccessful) {
                    "ChatGPT 登录服务拒绝了请求（HTTP " + response.code + "）。"
                }
                json.parseToJsonElement(response.body?.string().orEmpty()).jsonObject
            }

    private fun respond(socket: java.net.Socket, message: String) {
        val content = "<!doctype html><html><meta charset=\"UTF-8\"><body><p>" +
            message + "</p></body></html>"
        val bytes = content.toByteArray(Charsets.UTF_8)
        val header = "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n" +
            "Cache-Control: no-store\r\nContent-Length: " + bytes.size +
            "\r\nConnection: close\r\n\r\n"
        socket.getOutputStream().write(header.toByteArray(Charsets.US_ASCII) + bytes)
        socket.getOutputStream().flush()
    }
}
