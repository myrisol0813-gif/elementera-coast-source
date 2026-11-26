package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.network.CoastApiErrorKind
import com.elementeracoast.app.core.network.CoastApiException
import com.elementeracoast.app.core.network.TurnToolPolicy
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
    data class Done(val reason: String, val metadata: com.elementeracoast.app.core.remote.RemoteModelMetadata? = null) : LocalProviderEvent
    data class Tool(val id:String,val name:String,val result:com.elementeracoast.app.core.remote.RemoteNativeToolResult):LocalProviderEvent
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

    /** Only fixed diagnostic phrases, never raw upstream bodies or credentials. */
    private fun authReason(response: okhttp3.Response): String {
        val detail = runCatching {
            val obj = json.parseToJsonElement(response.peekBody(4096).string()).jsonObject
            (obj["error"] as? JsonObject)?.get("message")?.jsonPrimitive?.contentOrNull.orEmpty().lowercase()
        }.getOrDefault("")
        return when {
            "no auth credentials" in detail -> "供应商报告未收到授权凭据"
            "user not found" in detail -> "供应商报告 User not found"
            "invalid api key" in detail || "invalid key" in detail -> "供应商报告 Key 无效"
            "disabled" in detail || "revoked" in detail -> "供应商报告凭据已禁用或撤销"
            else -> "供应商未返回可安全展示的具体原因"
        }
    }

    suspend fun authorizationCheck(p: LocalProviderConfig): String = withContext(Dispatchers.IO) {
        val url = normalizeLocalProviderUrl(p.baseUrl).toHttpUrl()
        require(url.host == "openrouter.ai" && url.port == 443 && url.encodedPath.trimEnd('/') == "/api/v1") {
            "当前授权自检仅支持 OpenRouter 官方地址。"
        }
        val key = p.apiKey
        val format = if (key.startsWith("sk-or-v1-") && key.length == 73 && key.none { it.isWhitespace() }) "常见格式"
            else "非典型格式（不代表一定无效）"
        val prefix = "Key 长度 ${key.length} · $format · GET /api/v1/key"
        try {
            val req = request(p, "/key").get().build()
            val headerOk = req.headers.values("Authorization").size == 1 && req.header("Authorization") == "Bearer " + key
            if (!headerOk) return@withContext "$prefix · 本机请求头校验失败"
            http.newCall(req).execute().use { response ->
                "$prefix · 请求头构造一致 · HTTP ${response.code} · " +
                    (if (response.isSuccessful) "授权通过" else authReason(response))
            }
        } catch (e: CancellationException) { throw e }
        catch (_: Exception) { "$prefix · 请求未完成，请检查网络或 Key 中的非法字符" }
    }

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

    private data class ModelCatalog(val providerId:String,val baseUrl:String,val readAt:Long,val body:JsonObject?)
    @Volatile private var modelCatalog:ModelCatalog?=null
    private suspend fun catalog(p:LocalProviderConfig):JsonObject? {
        val now=System.currentTimeMillis()
        val cached=modelCatalog?.takeIf{it.providerId==p.id&&it.baseUrl==p.baseUrl&&now-it.readAt in 0..(if(it.body==null)60000L else 600000L)}
        if(cached!=null)return cached.body
        val fetched=try{get(p,"/models")}catch(e:CancellationException){throw e}catch(_:Exception){null}
        modelCatalog=ModelCatalog(p.id,p.baseUrl,now,fetched)
        return fetched
    }
    internal suspend fun inputBudget(p:LocalProviderConfig,model:String,requested:Int,output:Int,tools:Boolean):LocalInputBudget {
        val data=if(requested==0||LocalSoilPolicy.isOpenRouter(p))catalog(p) else modelCatalog?.takeIf{it.providerId==p.id&&it.baseUrl==p.baseUrl}?.body
        val entry=(data?.get("data") as? JsonArray)?.mapNotNull{it as? JsonObject}?.firstOrNull{(it["id"] as? JsonPrimitive)?.contentOrNull==model}
        return LocalInputBudget.resolve(requested,output,tools,entry)
    }
    internal suspend fun soilPolicy(p:LocalProviderConfig,model:String):LocalSoilPolicy {
        if(!LocalSoilPolicy.isOpenRouter(p))return LocalSoilPolicy()
        return LocalSoilPolicy.forProvider(p,model,catalog(p))
    }

    /** Dedicated non-streaming organization for OpenRouter. No tools or chat history. */
    internal fun organize(p:LocalProviderConfig,model:String,prompt:String,budget:Int,policy:LocalSoilPolicy):Flow<LocalProviderEvent> {
        if(!policy.nonStreaming)return stream(p,model,listOf(RemoteChatMessage("user",prompt)),budget)
        return callbackFlow {
            val active=java.util.concurrent.atomic.AtomicReference<okhttp3.Call?>()
            val job=launch(Dispatchers.IO){
                try{
                    val payload=buildJsonObject{
                        put("model",model);put("stream",false);put("max_tokens",budget)
                        put("messages",localMultimodalMessages(listOf(RemoteChatMessage("user",prompt)),emptyList()))
                        for((key,value) in policy.options())put(key,value)
                    }
                    val call=http.newCall(request(p,"/chat/completions").header("Accept","application/json")
                        .post(payload.toString().toRequestBody(media)).build())
                    active.set(call)
                    call.execute().use{response->
                        if(!response.isSuccessful)throw failure(response.code)
                        val source=requireNotNull(response.body).source()
                        source.request(1048577);require(source.buffer.size<=1048576)
                        val root=json.parseToJsonElement(source.readUtf8()).jsonObject
                        require(root["error"]==null||root["error"]==JsonNull)
                        val choice=root.getValue("choices").jsonArray.first().jsonObject
                        val reason=choice.getValue("finish_reason").jsonPrimitive.content
                        val message=choice["message"] as? JsonObject
                        val content=(message?.get("content") as? JsonPrimitive)?.contentOrNull.orEmpty()
                        if(reason=="stop"&&content.isNotBlank())send(LocalProviderEvent.Delta(content))
                        send(LocalProviderEvent.Done(reason))
                    }
                    close()
                }catch(e:CancellationException){throw e}
                catch(e:CoastApiException){close(e)}
                catch(_:Exception){close(CoastApiException(CoastApiErrorKind.Decode,"local_soil_response","供应商整理响应格式不兼容。"))}
            }
            awaitClose{active.getAndSet(null)?.cancel();job.cancel()}
        }
    }

    fun stream(p: LocalProviderConfig, model: String, messages: List<RemoteChatMessage>, maxTokens: Int,imageParts:List<JsonObject> = emptyList(),temperature:Double?=null): Flow<LocalProviderEvent> =
        streamWithTools(p,model,messages,maxTokens,imageParts,null,temperature)

    internal fun streamWithTools(p:LocalProviderConfig, model:String, messages:List<RemoteChatMessage>,maxTokens:Int,imageParts:List<JsonObject>,session:LocalToolSession?,temperature:Double?=null):Flow<LocalProviderEvent> = callbackFlow {
        val history=localMultimodalMessages(messages,imageParts).toMutableList()
        val echo=LocalProviderEcho(p,model,maxTokens)
        val active=java.util.concurrent.atomic.AtomicReference<okhttp3.Call?>()
        val reader=launch(Dispatchers.IO) {
            try {
                var callsMade=0
                val limit=session?.maxCalls?:TurnToolPolicy.DEFAULT_CALLS
                for(round in 0..limit){
                    val finalOnly=TurnToolPolicy.finalOnly(round,callsMade,limit)
                    val payload=buildJsonObject {
                        put("model",model);put("stream",true)
                        val host=normalizeLocalProviderUrl(p.baseUrl).toHttpUrl().host
                        val official=host=="api.openai.com"
                        if(host in setOf("api.openai.com","openrouter.ai","qianfan.baidubce.com"))put("stream_options",buildJsonObject{put("include_usage",true)})
                        put(if(official)"max_completion_tokens"else "max_tokens",maxTokens.coerceIn(64,65536))
                        put("messages",JsonArray(history))
                        temperature?.let{put("temperature",it)}
                        if(session!=null){put("tools",session.completionsTools);put("tool_choice",if(finalOnly)"none"else "auto")}
                    }
                    val call=http.newCall(request(p,"/chat/completions").header("Accept","text/event-stream").post(payload.toString().toRequestBody(media)).build())
                    active.set(call)
                    var reason:String?=null;var done=false
                    val pending=sortedMapOf<Int,ToolParts>()
                    val roundText=StringBuilder()
                    call.execute().use{response->
                        if(!response.isSuccessful)throw failure(response.code)
                        val source=response.body?.source()?:error("missing body")
                        while(!source.exhausted()){
                            val line=source.readUtf8Line()?:break
                            if(!line.startsWith("data:"))continue
                            val data=line.substringAfter("data:").trim()
                            if(data=="[DONE]"){done=true;break}
                            if(data.isBlank())continue
                            val chunk=json.parseToJsonElement(data).jsonObject
                            if(chunk["error"]!=null&&chunk["error"]!=JsonNull)throw CoastApiException(CoastApiErrorKind.Model,"local_provider_error","供应商在生成过程中返回错误。")
                            echo.observe(chunk) // usage-only final chunks may have an empty choices array
                            val choice=(chunk["choices"] as? JsonArray)?.firstOrNull() as? JsonObject?:continue
                            val delta=choice["delta"] as? JsonObject
                            (delta?.get("content") as? JsonPrimitive)?.contentOrNull?.takeIf(String::isNotEmpty)?.let{
                                roundText.append(it);send(LocalProviderEvent.Delta(it))
                            }
                            (delta?.get("tool_calls") as? JsonArray)?.forEach{raw->
                                require(session!=null)
                                val item=raw.jsonObject
                                val index=item["index"]?.jsonPrimitive?.intOrNull?:0
                                require(index in 0 until LocalToolSession.MAX_CALLS)
                                val parts=pending.getOrPut(index){ToolParts()}
                                item["id"]?.jsonPrimitive?.contentOrNull?.let{parts.id.append(it)}
                                val fn=item["function"] as? JsonObject
                                fn?.get("name")?.jsonPrimitive?.contentOrNull?.let{parts.name.append(it)}
                                fn?.get("arguments")?.jsonPrimitive?.contentOrNull?.let{parts.arguments.append(it)}
                                require(parts.id.length<=240&&parts.name.length<=160&&parts.arguments.length<=12000)
                            }
                            (choice["finish_reason"] as? JsonPrimitive)?.contentOrNull?.let{reason=it}
                        }
                    }
                    active.compareAndSet(call,null)
                    echo.endRound()
                    if(!done&&reason==null)throw CoastApiException(CoastApiErrorKind.Stream,"local_stream_incomplete","供应商回复流提前结束。")
                    if(pending.isEmpty()){
                        if(reason in setOf("tool_calls","function_call"))throw CoastApiException(CoastApiErrorKind.Model,"local_tool_format","供应商未返回完整的工具调用。")
                        val finish=reason?:"stop"
                        send(LocalProviderEvent.Done(finish,echo.metadata(finish)));close();return@launch
                    }
                    if(session==null||reason!="tool_calls")throw CoastApiException(CoastApiErrorKind.Model,"local_tool_format","供应商未返回兼容的工具调用。")
                    if(finalOnly){
                        send(LocalProviderEvent.Delta(TurnToolPolicy.LIMIT_NOTICE))
                        send(LocalProviderEvent.Done("stop",echo.metadata("stop")));close();return@launch
                    }
                    require(pending.values.all{it.id.isNotBlank()&&it.name.isNotBlank()})
                    val calls=pending.values.map{part->buildJsonObject{
                        put("id",part.id.toString());put("type","function")
                        put("function",buildJsonObject{put("name",part.name.toString());put("arguments",part.arguments.toString())})
                    }}
                    history.add(buildJsonObject{put("role","assistant");put("content",if(roundText.isEmpty())JsonNull else JsonPrimitive(roundText.toString()));put("tool_calls",JsonArray(calls))})
                    for(part in pending.values){
                        val result=if(TurnToolPolicy.canExecute(callsMade,limit)){
                            callsMade++
                            session.execute(part.id.toString(),part.name.toString(),part.arguments.toString())
                        }else com.elementeracoast.app.core.remote.RemoteNativeToolResult(ok=false,output=TurnToolPolicy.LIMIT_RECEIPT,deskSlip=session.receipt)
                        history.add(buildJsonObject{put("role","tool");put("tool_call_id",part.id.toString());put("content",result.output)})
                        send(LocalProviderEvent.Tool(part.id.toString(),part.name.toString(),result))
                    }
                    history.addAll(session.takePrivateContinuation())
                    session.requireContinuationBudget(history)
                }
            }catch(e:CancellationException){throw e}
            catch(e:CoastApiException){close(e)}
            catch(e:Exception){
                val (kind,code,message)=when(e){
                    is java.net.SocketTimeoutException -> Triple(CoastApiErrorKind.Network,"timeout","等待供应商回复超时。")
                    is java.net.UnknownHostException -> Triple(CoastApiErrorKind.Network,"dns","供应商域名解析失败。")
                    is javax.net.ssl.SSLException -> Triple(CoastApiErrorKind.Network,"tls","供应商安全连接失败。")
                    is java.io.IOException -> Triple(CoastApiErrorKind.Network,"connection","供应商网络传输中断。")
                    is IllegalArgumentException -> if(e.message=="工具续请求超出预算。") Triple(CoastApiErrorKind.Model,"budget","本轮工具续请求超出上下文预算。") else Triple(CoastApiErrorKind.Decode,"format","供应商返回或工具参数格式不兼容。")
                    else -> Triple(CoastApiErrorKind.Decode,"processing","模型响应处理未完成。")
                }
                close(CoastApiException(kind,"local_provider_"+code,message))
            }
        }
        awaitClose{active.getAndSet(null)?.cancel();reader.cancel()}
    }
    private class ToolParts {
        val id=StringBuilder();val name=StringBuilder();val arguments=StringBuilder()
    }
}

/** Shared Chat Completions parts contract; the existing Responses normalizer translates it. */
internal fun localMultimodalMessages(messages:List<RemoteChatMessage>,images:List<JsonObject>):JsonArray{
    val user=messages.indexOfLast{it.role=="user"}
    require(images.isEmpty()||user>=0)
    return JsonArray(messages.mapIndexed{i,m->buildJsonObject{
        put("role",m.role)
        if(i==user&&images.isNotEmpty())put("content",JsonArray(listOf(buildJsonObject{put("type","text");put("text",m.content)})+images))
        else put("content",m.content)
    }})
}
