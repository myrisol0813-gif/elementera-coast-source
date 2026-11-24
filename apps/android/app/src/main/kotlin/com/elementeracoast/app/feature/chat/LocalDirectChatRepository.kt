package com.elementeracoast.app.feature.chat

import com.elementeracoast.app.core.local.*
import com.elementeracoast.app.core.model.CrossWindowRequest
import com.elementeracoast.app.core.network.CoastApiErrorKind
import com.elementeracoast.app.core.network.CoastApiException
import com.elementeracoast.app.core.remote.RemoteHistory
import com.elementeracoast.app.core.remote.RemoteRealityContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.collect

/** Reuses the existing history format, streaming UI, branches and stop/retry behavior. */
internal class LocalDirectChatRepository(
    private val history: ChatRepository,
    private val providers: LocalProviderStore,
    private val client: LocalProviderClient = LocalProviderClient()
) : ChatRepository by history {
    override fun streamReply(
        conversationId: String, historyWithUser: RemoteHistory, turnId: String,
        modelId: String, recentTurns: Int, contextBudget: Int, outputLength: String,
        maxOutputTokens: Int, crossWindow: CrossWindowRequest, realityContext: RemoteRealityContext
    ): Flow<ChatProgress> = flow {
        val (provider, model) = try { providers.resolve(modelId) } catch (_: Exception) { null }
            ?: throw CoastApiException(CoastApiErrorKind.Model, "local_provider_missing", "请在模型箱配置供应商并选择本机模型。")
        if (ChatSyncMapper.activeAttachmentIds(historyWithUser, turnId).isNotEmpty())
            throw CoastApiException(CoastApiErrorKind.Request, "local_attachment_pending", "本机附件推理尚未接入。")
        val messages = ChatSyncMapper.contextMessages(historyWithUser, turnId, recentTurns)
        if (messages.sumOf { it.content.length.toLong() } > contextBudget.coerceAtLeast(1800).toLong() * 3)
            throw CoastApiException(CoastApiErrorKind.Request, "local_context_budget", "近期文字超过本机预览的保守上下文预算，请减少近期轮数或提高预算。")
        var content = ""
        var completed = false
        client.stream(provider, model, messages, maxOutputTokens).collect { event ->
            when (event) {
                is LocalProviderEvent.Delta -> { content += event.text; emit(ChatProgress.Delta(event.text)) }
                is LocalProviderEvent.Done -> {
                    if (content.isBlank()) throw CoastApiException(CoastApiErrorKind.Model, "local_empty_reply", "供应商没有返回可显示的文字。")
                    val next = ChatSyncMapper.appendAssistant(
                        history = ChatSyncMapper.clearUserFailure(historyWithUser, turnId), turnId = turnId,
                        content = content, modelId = modelId, finishReason = event.reason)
                    val saved = history.persistHistory(conversationId, next)
                    completed = true
                    emit(ChatProgress.Completed(saved, modelId, event.reason))
                }
            }
        }
        if (!completed) throw CoastApiException(CoastApiErrorKind.Stream, "local_stream_incomplete", "本机回复未正常完成。")
    }
}
