package com.elementeracoast.app.feature.chat

import com.elementeracoast.app.core.model.CrossWindowRequest
import com.elementeracoast.app.core.network.CoastApiClient
import com.elementeracoast.app.core.network.CoastApiErrorKind
import com.elementeracoast.app.core.network.CoastApiException
import com.elementeracoast.app.core.remote.RemoteChatRequest
import com.elementeracoast.app.core.remote.RemoteHistory
import com.elementeracoast.app.core.remote.RemoteRealityContext
import com.elementeracoast.app.feature.chatgpt.ChatGptNativeInference
import com.elementeracoast.app.feature.chatgpt.ChatGptPlanRepository
import com.elementeracoast.app.feature.chatgpt.NativeChatEvent
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.flow
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.*
import com.elementeracoast.app.core.network.RemoteReplyRunRequest
import com.elementeracoast.app.core.network.ReplyRunEvent
import com.elementeracoast.app.core.network.ReplyRunWire
import com.elementeracoast.app.core.network.CoastSseEvent
import com.elementeracoast.app.core.remote.RemoteVariant
import com.elementeracoast.app.core.remote.RemoteModelUsage
import com.elementeracoast.app.feature.chatgpt.NativePlanSequence
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.withContext
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withTimeout
import java.util.UUID

internal const val CHATGPT_PLAN_PREFIX = "chatgpt-plan:"

internal fun isChatGptPlanModel(modelId: String): Boolean =
    modelId.startsWith(CHATGPT_PLAN_PREFIX) && modelId.length > CHATGPT_PLAN_PREFIX.length

/** Shares Coast histories and receipts. Only the model execution path is different. */
internal class NativeChatGptTurnRepository(
    private val api: CoastApiClient,
    private val historyRepository: ChatRepository,
    private val account: ChatGptPlanRepository,
    private val reasoningStore: ReasoningEffortStore? = null,
    private val toolLimit: () -> Int = { com.elementeracoast.app.core.network.TurnToolPolicy.DEFAULT_CALLS }
) : ChatRepository by historyRepository {
    private val inference = ChatGptNativeInference(account, api)

    override fun streamReplyRun(request:RemoteReplyRunRequest):Flow<ReplyRunEvent> = flow {
        require(isChatGptPlanModel(request.model))
        val slug=request.model.removePrefix(CHATGPT_PLAN_PREFIX)
        val json=Json{ignoreUnknownKeys=true;explicitNulls=false}
        val wire=ReplyRunWire(request,json)
        val settings=request.settings.mapValues{(_,v)->v.jsonPrimitive.content}
        val effort=reasoningStore?.get(request.model,account.reasoningEffortsFor(slug))
        var acquired=false
        var settled=false
        var saved=0
        var status="completed"
        var detail:String?=null
        fun bad():Nothing=throw CoastApiException(CoastApiErrorKind.Stream,"native_plan_group_unconfirmed","套餐连续回复回执未确认；不会自动重试。")
        try{
            val start=api.nativePlanReplyRun(request,"start")
            if(!start.ok)bad()
            acquired=true
            emit(wire.accept(CoastSseEvent("reply_group_start",buildJsonObject{
                put("sequence_id",request.sequenceId);put("max_messages",start.maxMessages)
            })))
            for(index in 0 until start.maxMessages){
                val mid=UUID.randomUUID().toString()
                val step=api.nativePlanReplyRun(request,"next",buildJsonObject{put("message_id",mid);put("index",index)})
                val context=step.context?:bad()
                if(!step.ok||!context.ok||step.maxMessages!=start.maxMessages||
                    step.toolBudget !in 0..request.budget.toolBudget||step.tokenBudget !in 1..request.budget.tokenBudget||
                    step.mayContinue&&index+1>=start.maxMessages)bad()
                emit(wire.accept(CoastSseEvent("reply_begin",buildJsonObject{put("message_id",mid);put("index",index)})))
                val envelope=RemoteChatRequest(conversationId=request.conversationId,sourceTurnId=request.turnId,messageId=mid,
                    model=slug,messages=emptyList(),localDate=request.localDate,localDateTime=request.localDateTime,
                    realityContext=request.realityContext,settings=settings,crossWindow=request.crossWindow,
                    imageToolEnabled=request.imageToolEnabled&&step.toolBudget>0,imageModelId=request.imageModelId,
                    replySequenceId=request.sequenceId,userVariantId=request.userVariantId)
                var done:NativeChatEvent.Completed?=null
                coroutineScope{
                    val heartbeat=launch{
                        while(true){
                            delay(60_000)
                            val renewed=api.nativePlanReplyRun(request,"heartbeat",buildJsonObject{put("message_id",mid)})
                            if(!renewed.ok)bad()
                        }
                    }
                    try{
                        inference.stream(slug,envelope,context,effort,NativePlanSequence(step.mayContinue,step.toolBudget,step.tokenBudget)).collect{event->
                            when(event){
                                is NativeChatEvent.Delta->emit(wire.accept(CoastSseEvent("reply_delta",buildJsonObject{put("message_id",mid);put("content",event.text)})))
                                is NativeChatEvent.Tool->ToolActivityBus.publish(event.id,event.name,event.ok)
                                is NativeChatEvent.Completed->{if(done!=null)bad();done=event}
                            }
                        }
                    }finally{heartbeat.cancelAndJoin()}
                }
                val reply=done?:bad()
                val usage=reply.usage.takeIf{it.reported}?.let{
                    RemoteModelUsage(promptTokens=it.input,completionTokens=it.output,cachedTokens=it.cached,totalTokens=it.input+it.output)
                }
                val variant=RemoteVariant(id=mid,content=reply.text,modelId=request.model,finishReason="stop",
                    generationSource="chat",usage=usage,furnitureRuns=reply.furnitureRuns,deskSlip=reply.deskSlip)
                val committed=api.nativePlanReplyRun(request,"commit",buildJsonObject{
                    put("message_id",mid);put("variant",json.encodeToJsonElement(RemoteVariant.serializer(),variant))
                    putJsonObject("receipt"){
                        put("tool_calls",reply.ordinaryToolCalls)
                        put("total_tokens",usage?.totalTokens?.let(::JsonPrimitive)?:JsonNull)
                        put("continue_requested",reply.continueRequested)
                    }
                })
                val history=committed.history?:bad()
                if(!committed.ok)bad()
                val event=wire.accept(CoastSseEvent("reply_committed",buildJsonObject{
                    put("message_id",mid);put("index",index);put("history",json.encodeToJsonElement(RemoteHistory.serializer(),history))
                }))
                saved++
                historyRepository.cacheHistory(request.conversationId,history)
                emit(event)
                if(reply.sequenceStopReason!=null){status="permission_or_budget";detail=reply.sequenceStopReason;break}
                if(!committed.continueRequested)break
                if(!reply.continueRequested||!step.mayContinue)bad()
                if(index+1>=start.maxMessages){status="limit_reached";break}
            }
            val end=api.nativePlanReplyRun(request,"settle",buildJsonObject{put("status",status)})
            if(!end.ok||end.history==null)bad()
            settled=true
            historyRepository.cacheHistory(request.conversationId,end.history)
            emit(wire.accept(CoastSseEvent("reply_group_end",buildJsonObject{
                put("status",status);put("saved",saved);detail?.let{put("message",it)}
                put("history",json.encodeToJsonElement(RemoteHistory.serializer(),end.history))
            })))
            wire.finish()
        }catch(cancelled:CancellationException){
            status="cancelled";throw cancelled
        }catch(error:Exception){
            status="failed"
            if(error is CoastApiException)throw error
            throw CoastApiException(CoastApiErrorKind.Stream,"native_plan_group_failed","套餐连续回复未确认完成；已保存内容保留，不会自动重试。",cause=error)
        }finally{
            if(acquired&&!settled)withContext(NonCancellable){
                // At most one settlement attempt; do not retry an uncertain provider request.
                runCatching{withTimeout(5000){
                    val end=api.nativePlanReplyRun(request,"settle",buildJsonObject{put("status",if(status=="cancelled")status else "failed")})
                    end.history?.let{historyRepository.cacheHistory(request.conversationId,it)}
                }}
            }
        }
    }

    override fun streamReply(
        conversationId: String,
        historyWithUser: RemoteHistory,
        turnId: String,
        selectedModel: String,
        recentTurns: Int,
        contextBudget: Int,
        outputLength: String,
        maxOutputTokens: Int,
        crossWindow: CrossWindowRequest,
        realityContext: RemoteRealityContext
    ): Flow<ChatProgress> = flow {
        require(isChatGptPlanModel(selectedModel))
        val model = selectedModel.removePrefix(CHATGPT_PLAN_PREFIX)
        val assistantId = ChatSyncMapper.nextAssistantVariantId(historyWithUser, turnId)
        val source=historyWithUser.turns.firstOrNull{it.id==turnId}
        val uid=source?.user?.variants?.getOrNull(source.user.active)?.id.orEmpty()
        val lease=api.startNativeSingleChat(conversationId)
        try {
            coroutineScope {
                val heartbeat=lease?.let { claim ->
                    launch {
                        while(true){
                            delay(60_000)
                            if(!api.heartbeatNativeSingleChat(conversationId,claim))throw CoastApiException(
                                CoastApiErrorKind.Stream,"native_single_claim_lost","普通聊天执行预约已失效；不会自动重试。")
                        }
                    }
                }
                try {
        val selectedImage=api.getProfile().currentImageModel
        val imageEnabled=uid.isNotBlank()&&selectedImage.isNotBlank()
        val cfg=historyWithUser.contextSettings
        val mediaReserved=imageEnabled||uid.isNotBlank()&&(cfg.stickerSendEnabled||cfg.stickerAddEnabled)
        if(mediaReserved)historyRepository.persistHistory(conversationId,ChatSyncMapper.appendAssistant(historyWithUser,turnId,"",selectedModel,if(imageEnabled)"image_tool_ready"else "sticker_tool_ready",assistantVariantId=assistantId))
        val request = RemoteChatRequest(
            conversationId = conversationId,
            sourceTurnId = turnId,
            messageId = assistantId,
            model = model,
            messages = ChatSyncMapper.contextMessages(historyWithUser, turnId, recentTurns),
            attachmentIds = ChatSyncMapper.activeAttachmentIds(historyWithUser, turnId),
            localDate = LocalDate.now().toString(),
            localDateTime = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")),
            realityContext = realityContext,
            settings = mapOf(
                "recentTurns" to recentTurns.coerceAtLeast(1).toString(),
                "contextBudget" to (if(contextBudget==0)0 else contextBudget.coerceAtLeast(1800)).toString(),
                // These remain user-visible but unsupported by the ChatGPT plan route;
                // the provider adapter never sends forbidden max_output_tokens.
                "outputLength" to outputLength,
                "maxOutputTokens" to maxOutputTokens.coerceIn(64, 65536).toString(),
                "toolCallLimit" to com.elementeracoast.app.core.network.TurnToolPolicy.normalize(toolLimit()).toString()
            ),
            crossWindow = crossWindow.toRemote(),
            stream = true,
            imageToolEnabled=imageEnabled,
            imageModelId=selectedImage.takeIf{imageEnabled},
            nativeSingleClaim=lease
        )
        val context = api.prepareNativeChatGpt(request)
        var content = ""
        var completed = false
        val effort = reasoningStore?.get(selectedModel, account.reasoningEffortsFor(model))
        inference.stream(model, request, context, effort).collect { event ->
            when (event) {
                is NativeChatEvent.Delta -> {
                    content += event.text
                    emit(ChatProgress.Delta(event.text))
                }
                is NativeChatEvent.Tool -> {
                    ToolActivityBus.publish(
                        id = event.id,
                        text = if (event.ok) "ChatGPT 工具完成 · " + event.name
                            else "ChatGPT 工具失败 · " + event.name,
                        success = event.ok
                    )
                }
                is NativeChatEvent.Completed -> {
                    completed = true
                    val next = if(mediaReserved)ChatSyncMapper.completeReservedAssistant(historyRepository.loadHistory(conversationId),turnId,uid,assistantId,event.text,selectedModel,"stop",event.furnitureRuns,event.deskSlip)
                    else ChatSyncMapper.appendAssistant(
                        history = ChatSyncMapper.clearUserFailure(historyWithUser, turnId),
                        turnId = turnId,
                        content = event.text,
                        modelId = selectedModel,
                        finishReason = "stop",
                        furnitureRuns = event.furnitureRuns,
                        deskSlip = event.deskSlip,
                        assistantVariantId = assistantId
                    )
                    if (event.requestedReasoningEffort != null) {
                        ToolActivityBus.publish(
                            id = "reasoning-${assistantId}",
                            text = "推理档位已请求 · ${event.requestedReasoningEffort} · " +
                                (event.returnedReasoningEffort?.let { "上游报告 $it" }
                                    ?: "上游未报告实际档位"),
                            success = true
                        )
                    }
                    val stored = historyRepository.persistHistory(conversationId, next)
                    val usage = event.usage
                    val snapshot = buildJsonObject {
                        put("status", "saved")
                        put("sanitized", true)
                        put("metadata", buildJsonObject {
                            put("provider", "chatgpt_plan")
                            put("requested_model", model)
                            put("resolved_model", model)
                            put("finish_reason", "stop")
                            event.requestedReasoningEffort?.let { put("reasoning_effort_requested", it) }
                            event.returnedReasoningEffort?.let { put("reasoning_effort_reported", it) }
                            if (usage.reported) put("usage", buildJsonObject {
                                put("prompt_tokens", usage.input)
                                put("completion_tokens", usage.output)
                                put("total_tokens", usage.input + usage.output)
                                put("cached_tokens", usage.cached)
                                put("input_tokens_details", buildJsonObject {
                                    put("cached_tokens", usage.cached)
                                })
                            })
                        })
                    }
                    try {
                        api.saveNativeChatGptEcho(conversationId, assistantId, snapshot)
                    } catch (cancelled: CancellationException) {
                        throw cancelled
                    } catch (_: Exception) {
                        // History is saved; metadata failure must not fabricate a failed reply.
                    }
                    emit(ChatProgress.Completed(stored, selectedModel, "stop", TurnDeskMapper.toUi(event.deskSlip)))
                }
            }
        }
        if (!completed) throw CoastApiException(
            CoastApiErrorKind.Stream, "chatgpt_plan_stream_incomplete",
            "ChatGPT 回复流提前结束，没有写入假成功消息。"
        )
                } finally { heartbeat?.cancelAndJoin() }
            }
        } finally {
            if(lease!=null)withContext(NonCancellable){
                runCatching { withTimeout(5000){api.releaseNativeSingleChat(conversationId,lease)} }
            }
        }
    }
}
