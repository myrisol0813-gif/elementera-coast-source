package com.elementeracoast.app.feature.chat

import com.elementeracoast.app.core.model.CrossWindowRequest
import com.elementeracoast.app.core.network.CoastApiClient
import com.elementeracoast.app.core.network.CoastApiErrorKind
import com.elementeracoast.app.core.network.CoastApiException
import com.elementeracoast.app.core.remote.RemoteChatRequest
import com.elementeracoast.app.core.remote.RemoteHistory
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
import kotlinx.serialization.json.put

internal const val CHATGPT_PLAN_PREFIX = "chatgpt-plan:"

internal fun isChatGptPlanModel(modelId: String): Boolean =
    modelId.startsWith(CHATGPT_PLAN_PREFIX) && modelId.length > CHATGPT_PLAN_PREFIX.length

/** Shares Coast histories and receipts. Only the model execution path is different. */
internal class NativeChatGptTurnRepository(
    private val api: CoastApiClient,
    private val historyRepository: ChatRepository,
    private val account: ChatGptPlanRepository,
    private val reasoningStore: ReasoningEffortStore? = null
) : ChatRepository by historyRepository {
    private val inference = ChatGptNativeInference(account, api)

    override fun streamReply(
        conversationId: String,
        historyWithUser: RemoteHistory,
        turnId: String,
        selectedModel: String,
        recentTurns: Int,
        contextBudget: Int,
        outputLength: String,
        maxOutputTokens: Int,
        crossWindow: CrossWindowRequest
    ): Flow<ChatProgress> = flow {
        require(isChatGptPlanModel(selectedModel))
        val model = selectedModel.removePrefix(CHATGPT_PLAN_PREFIX)
        val assistantId = ChatSyncMapper.nextAssistantVariantId(historyWithUser, turnId)
        val request = RemoteChatRequest(
            conversationId = conversationId,
            sourceTurnId = turnId,
            messageId = assistantId,
            model = model,
            messages = ChatSyncMapper.contextMessages(historyWithUser, turnId, recentTurns),
            attachmentIds = ChatSyncMapper.activeAttachmentIds(historyWithUser, turnId),
            localDate = LocalDate.now().toString(),
            localDateTime = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")),
            settings = mapOf(
                "recentTurns" to recentTurns.coerceAtLeast(1).toString(),
                "contextBudget" to contextBudget.coerceAtLeast(1800).toString(),
                // These remain user-visible but unsupported by the ChatGPT plan route;
                // the provider adapter never sends forbidden max_output_tokens.
                "outputLength" to outputLength,
                "maxOutputTokens" to maxOutputTokens.coerceIn(64, 65536).toString()
            ),
            crossWindow = crossWindow.toRemote(),
            stream = true
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
                        text = if (event.ok) "官端 GPT 工具完成 · " + event.name
                            else "官端 GPT 工具失败 · " + event.name,
                        success = event.ok
                    )
                }
                is NativeChatEvent.Completed -> {
                    completed = true
                    val next = ChatSyncMapper.appendAssistant(
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
            "官端 GPT 回复流提前结束，没有写入假成功消息。"
        )
    }
}
