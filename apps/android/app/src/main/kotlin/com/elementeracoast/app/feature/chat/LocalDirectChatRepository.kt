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
    private val knowledge: LocalKnowledgeStore,
    private val client: LocalProviderClient = LocalProviderClient()
) : ChatRepository by history {
    override fun streamReply(
        conversationId: String, historyWithUser: RemoteHistory, turnId: String,
        modelId: String, recentTurns: Int, contextBudget: Int, outputLength: String,
        maxOutputTokens: Int, crossWindow: CrossWindowRequest, realityContext: RemoteRealityContext
    ): Flow<ChatProgress> = flow {
        val (provider, model) = try { providers.resolve(modelId) } catch (_: Exception) { null }
            ?: throw CoastApiException(CoastApiErrorKind.Model, "local_provider_missing", "请在模型箱配置供应商并选择本机模型。")
        val attachmentIds=ChatSyncMapper.activeAttachmentIds(historyWithUser,turnId)
        val messages = ChatSyncMapper.contextMessages(historyWithUser, turnId, recentTurns)
        val switches=historyWithUser.contextSettings
        val policy=try{client.inputBudget(provider,model,contextBudget,maxOutputTokens,switches.localModelToolsEnabled||switches.localModelWriteEnabled||switches.crossWindowAuto)}catch(e:IllegalArgumentException){
            throw CoastApiException(CoastApiErrorKind.Request,"local_context_budget",e.message.orEmpty())
        }
        val prepared=try{knowledge.context(messages,policy.comfort,knowledge.surfaceFor(conversationId),conversationId,attachmentIds,turnId,crossWindow.toRemote(),realityContext,policy)}catch(e:IllegalArgumentException){
            throw CoastApiException(CoastApiErrorKind.Request,"local_context_budget",e.message.orEmpty())
        }
        val source=historyWithUser.turns.firstOrNull{it.id==turnId}
        val uid=source?.user?.variants?.getOrNull(source.user.active)?.id.orEmpty()
        val mid=ChatSyncMapper.nextAssistantVariantId(historyWithUser,turnId)
        val image=if(uid.isNotBlank())knowledge.imageTool(conversationId,turnId,uid,mid,providers,policy.vision)else null
        val stickerEnabled=uid.isNotBlank()&&knowledge.surfaceFor(conversationId) in setOf("main_chat","radio")&&switches.localModelWriteEnabled&&(switches.stickerAddEnabled||switches.stickerSendEnabled&&switches.localModelToolsEnabled)
        val mediaReserved=image!=null||stickerEnabled
        if(mediaReserved)history.persistHistory(conversationId,ChatSyncMapper.appendAssistant(historyWithUser,turnId,"",modelId,if(image!=null)"image_tool_ready"else "sticker_tool_ready",assistantVariantId=mid))
        val session=try{knowledge.toolSession(conversationId,turnId,crossWindow.toRemote(),prepared.receipt,modelId,policy.wireLimit,image,mid)}catch(e:IllegalArgumentException){throw CoastApiException(CoastApiErrorKind.Request,"local_tool_budget",e.message.orEmpty())}
        val runs=mutableListOf<com.elementeracoast.app.core.remote.RemoteFurnitureRun>()
        var content = ""
        var completed = false
        client.streamWithTools(provider, model, prepared.messages, maxOutputTokens,prepared.imageParts,session).collect { event ->
            when (event) {
                is LocalProviderEvent.Delta -> { content += event.text; emit(ChatProgress.Delta(event.text)) }
                is LocalProviderEvent.Tool -> {
                    runs.addAll(event.result.furnitureRuns)
                    ToolActivityBus.publish(event.id,event.name,event.result.ok)
                }
                is LocalProviderEvent.Done -> {
                    if (content.isBlank()&&image?.saved!=true&&session?.stickerSaved!=true) throw CoastApiException(CoastApiErrorKind.Model, "local_empty_reply", "供应商没有返回可显示的文字。")
                    val next = if(mediaReserved)ChatSyncMapper.completeReservedAssistant(history.loadHistory(conversationId),turnId,uid,mid,content,modelId,event.reason,runs,session?.receipt?:prepared.receipt,echo=event.metadata)
                    else ChatSyncMapper.appendAssistant(
                        history = ChatSyncMapper.clearUserFailure(historyWithUser, turnId), turnId = turnId,
                        content = content, modelId = modelId, finishReason = event.reason,furnitureRuns=runs,deskSlip=session?.receipt?:prepared.receipt,modelEcho=event.metadata)
                    val saved = history.persistHistory(conversationId, next)
                    completed = true
                    emit(ChatProgress.Completed(saved, modelId, event.reason,TurnDeskMapper.toUi(session?.receipt?:prepared.receipt)))
                }
            }
        }
        if (!completed) throw CoastApiException(CoastApiErrorKind.Stream, "local_stream_incomplete", "本机回复未正常完成。")
    }
}
