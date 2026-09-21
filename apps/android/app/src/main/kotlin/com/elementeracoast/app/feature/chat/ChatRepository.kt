package com.elementeracoast.app.feature.chat

import com.elementeracoast.app.core.model.CrossWindowMode
import com.elementeracoast.app.core.model.CrossWindowRequest
import com.elementeracoast.app.core.model.TurnDeskReceipt
import com.elementeracoast.app.core.network.ApiStreamEvent
import com.elementeracoast.app.core.network.CoastApiClient
import com.elementeracoast.app.core.network.CoastApiErrorKind
import com.elementeracoast.app.core.network.CoastApiException
import com.elementeracoast.app.core.remote.RemoteAttachment
import com.elementeracoast.app.core.remote.RemoteCacheStore
import com.elementeracoast.app.core.remote.RemoteChatRequest
import com.elementeracoast.app.core.remote.RemoteCrossWindowRequest
import com.elementeracoast.app.core.remote.RemoteCrossWindowMessageSelection
import com.elementeracoast.app.core.remote.RemoteDeskSlip
import com.elementeracoast.app.core.remote.RemoteFurnitureRun
import com.elementeracoast.app.core.remote.RemoteHistory
import com.elementeracoast.app.core.remote.RemoteMessageModelMetadataResponse
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.flow
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

sealed interface ChatProgress {
    data class Delta(val text: String) : ChatProgress
    data class Completed(
        val history: RemoteHistory,
        val modelId: String,
        val finishReason: String,
        val deskReceipt: TurnDeskReceipt? = null
    ) : ChatProgress
}

interface ChatRepository {
    fun cachedHistory(conversationId: String): RemoteHistory?
    suspend fun loadHistory(conversationId: String): RemoteHistory
    suspend fun persistHistory(conversationId: String, history: RemoteHistory): RemoteHistory
    suspend fun uploadAttachment(conversationId: String, name: String, mime: String, bytes: ByteArray): RemoteAttachment
    suspend fun deleteAttachment(conversationId: String, attachmentId: String)
    suspend fun modelMetadata(
        conversationId: String,
        messageId: String,
        includeRaw: Boolean = false
    ): RemoteMessageModelMetadataResponse = RemoteMessageModelMetadataResponse(
        ok = true,
        conversationId = conversationId,
        messageId = messageId,
        status = "not_returned",
        sanitized = true
    )
    fun streamReply(
        conversationId: String,
        historyWithUser: RemoteHistory,
        turnId: String,
        modelId: String,
        recentTurns: Int,
        contextBudget: Int,
        crossWindow: CrossWindowRequest = CrossWindowRequest()
    ): Flow<ChatProgress>
    fun failedHistory(historyWithUser: RemoteHistory, turnId: String, modelId: String, error: CoastApiException, partialContent: String = ""): RemoteHistory
    fun cancelledHistory(historyWithUser: RemoteHistory, turnId: String, modelId: String, partialContent: String): RemoteHistory
    fun clearFailure(history: RemoteHistory, turnId: String): RemoteHistory
    fun cacheHistory(conversationId: String, history: RemoteHistory)
}

class DefaultChatRepository(
    private val api: CoastApiClient,
    private val cache: RemoteCacheStore,
    private val metadataRemote: ModelMetadataRemoteDataSource? = null,
    private val json: Json = Json { ignoreUnknownKeys = true; explicitNulls = false }
) : ChatRepository {
    override fun cachedHistory(conversationId: String): RemoteHistory? = cache.history(conversationId)

    override suspend fun loadHistory(conversationId: String): RemoteHistory =
        api.getHistory(conversationId).also { cache.putHistory(conversationId, it) }

    override suspend fun persistHistory(conversationId: String, history: RemoteHistory): RemoteHistory =
        api.putHistory(conversationId, history).also { cache.putHistory(conversationId, it) }

    override suspend fun uploadAttachment(conversationId: String, name: String, mime: String, bytes: ByteArray): RemoteAttachment =
        api.uploadChatAttachment(conversationId, name, mime, bytes)

    override suspend fun deleteAttachment(conversationId: String, attachmentId: String) {
        api.deleteChatAttachment(conversationId, attachmentId)
    }

    override suspend fun modelMetadata(
        conversationId: String,
        messageId: String,
        includeRaw: Boolean
    ): RemoteMessageModelMetadataResponse = metadataRemote?.get(conversationId, messageId, includeRaw)
        ?: super<ChatRepository>.modelMetadata(conversationId, messageId, includeRaw)

    override fun streamReply(
        conversationId: String,
        historyWithUser: RemoteHistory,
        turnId: String,
        modelId: String,
        recentTurns: Int,
        contextBudget: Int,
        crossWindow: CrossWindowRequest
    ): Flow<ChatProgress> = flow {
        var content = ""
        var actualModel = modelId
        var finishReason = ""
        var furnitureRuns = emptyList<RemoteFurnitureRun>()
        var deskSlip: RemoteDeskSlip? = null
        var done = false
        val normalizedRecentTurns = recentTurns.coerceAtLeast(1)
        val assistantVariantId = ChatSyncMapper.nextAssistantVariantId(historyWithUser, turnId)
        val request = RemoteChatRequest(
            conversationId = conversationId,
            sourceTurnId = turnId,
            messageId = assistantVariantId,
            model = modelId,
            messages = ChatSyncMapper.contextMessages(historyWithUser, turnId, normalizedRecentTurns),
            attachmentIds = ChatSyncMapper.activeAttachmentIds(historyWithUser, turnId),
            localDate = LocalDate.now().toString(),
            localDateTime = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")),
            settings = mapOf(
                "recentTurns" to normalizedRecentTurns.toString(),
                "contextBudget" to contextBudget.coerceAtLeast(1800).toString()
            ),
            crossWindow = crossWindow.toRemote(),
            stream = true
        )
        api.streamChat(request).collect { event ->
            when (event) {
                is ApiStreamEvent.Meta -> {
                    actualModel = event.data.runCatching {
                        jsonObject["model"]?.jsonPrimitive?.content
                    }.getOrNull().orEmpty().ifBlank { actualModel }
                }
                is ApiStreamEvent.Delta -> {
                    content += event.text
                    emit(ChatProgress.Delta(event.text))
                }
                is ApiStreamEvent.FurnitureRuns -> {
                    furnitureRuns = runCatching {
                        json.decodeFromJsonElement(ListSerializer(RemoteFurnitureRun.serializer()), event.data)
                    }.getOrDefault(emptyList())
                }
                is ApiStreamEvent.DeskSlip -> {
                    deskSlip = runCatching {
                        json.decodeFromJsonElement(RemoteDeskSlip.serializer(), event.data)
                    }.getOrNull()
                    deskSlip?.webSearch?.takeIf { it.used }?.let { search ->
                        val sourceCount = search.resultsCount.coerceAtLeast(search.results.size)
                        ToolActivityBus.publish(
                            id = "web-search-$turnId",
                            text = if (sourceCount > 0) "网络搜索完成 · $sourceCount 个来源" else "网络搜索完成",
                            success = true
                        )
                    }
                }
                is ApiStreamEvent.Tool -> {
                    val obj = event.data.runCatching { jsonObject }.getOrNull()
                    val id = obj?.get("id")?.jsonPrimitive?.contentOrNull.orEmpty().ifBlank { "tool-$turnId-${System.nanoTime()}" }
                    val name = obj?.get("name")?.jsonPrimitive?.contentOrNull.orEmpty()
                    val ok = obj?.get("ok")?.jsonPrimitive?.booleanOrNull ?: true
                    ToolActivityBus.publish(id, friendlyToolActivity(name, ok), ok)
                }
                is ApiStreamEvent.Done -> {
                    finishReason = event.finishReason
                    done = true
                }
                is ApiStreamEvent.Error -> throw event.error
                is ApiStreamEvent.Usage -> Unit
            }
        }
        if (!done) throw CoastApiException(
            CoastApiErrorKind.Stream,
            "stream_incomplete",
            "回复流提前中断。"
        )
        val completed = ChatSyncMapper.appendAssistant(
            history = ChatSyncMapper.clearUserFailure(historyWithUser, turnId),
            turnId = turnId,
            content = content,
            modelId = actualModel,
            finishReason = finishReason,
            furnitureRuns = mergeFurnitureRuns(furnitureRuns, deskSlip),
            deskSlip = deskSlip,
            assistantVariantId = assistantVariantId
        )
        val saved = persistHistory(conversationId, completed)
        emit(ChatProgress.Completed(saved, actualModel, finishReason, deskSlip?.let(TurnDeskMapper::toUi)))
    }

    override fun failedHistory(
        historyWithUser: RemoteHistory,
        turnId: String,
        modelId: String,
        error: CoastApiException,
        partialContent: String
    ): RemoteHistory {
        val marked = ChatSyncMapper.markUserFailure(historyWithUser, turnId, "${error.type}: ${error.message}")
        return if (partialContent.isBlank()) marked else ChatSyncMapper.appendAssistant(
            history = marked,
            turnId = turnId,
            content = partialContent,
            modelId = modelId,
            finishReason = "error",
            errorDetail = "${error.type}: ${error.message}",
            assistantVariantId = ChatSyncMapper.nextAssistantVariantId(historyWithUser, turnId)
        )
    }

    override fun cancelledHistory(
        historyWithUser: RemoteHistory,
        turnId: String,
        modelId: String,
        partialContent: String
    ): RemoteHistory {
        val clean = ChatSyncMapper.clearUserFailure(historyWithUser, turnId)
        return if (partialContent.isBlank()) clean else ChatSyncMapper.appendAssistant(
            history = clean,
            turnId = turnId,
            content = partialContent,
            modelId = modelId,
            finishReason = "cancelled",
            assistantVariantId = ChatSyncMapper.nextAssistantVariantId(historyWithUser, turnId)
        )
    }

    override fun clearFailure(history: RemoteHistory, turnId: String): RemoteHistory =
        ChatSyncMapper.clearUserFailure(history, turnId)

    override fun cacheHistory(conversationId: String, history: RemoteHistory) = cache.putHistory(conversationId, history)

    private fun CrossWindowRequest.toRemote(): RemoteCrossWindowRequest? {
        if (mode == CrossWindowMode.Off) return null
        return RemoteCrossWindowRequest(
            mode = mode.wireValue,
            messages = if (mode == CrossWindowMode.Manual) {
                messages.map { item -> RemoteCrossWindowMessageSelection(item.conversationId, item.messageId) }
            } else emptyList()
        )
    }
}
