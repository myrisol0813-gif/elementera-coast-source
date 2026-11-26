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
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import com.elementeracoast.app.core.network.ReplyRunEvent
import com.elementeracoast.app.core.network.RemoteReplyRunRequest
import com.elementeracoast.app.core.remote.RemoteChatMessage
import com.elementeracoast.app.core.remote.RemoteFurnitureRun
import com.elementeracoast.app.core.remote.RemoteVariant
import java.time.Instant
import java.util.UUID

/** Reuses the existing history format, streaming UI, branches and stop/retry behavior. */
internal class LocalDirectChatRepository(
    private val history: ChatRepository,
    private val providers: LocalProviderStore,
    private val knowledge: LocalKnowledgeStore,
    private val client: LocalProviderClient = LocalProviderClient(),
    private val sequenceStore:LocalPersistence?=null
) : ChatRepository by history {
    override fun streamReplyRun(request:RemoteReplyRunRequest):Flow<ReplyRunEvent> = flow {
        val store=sequenceStore?:throw CoastApiException(CoastApiErrorKind.Model,"local_sequence_unavailable","本机连续回复存储尚未接通。")
        val ledger=LocalReplyRunStore(store)
        val cid=request.conversationId;val seq=request.sequenceId;val tid=request.turnId
        val (provider,model)=try{providers.resolve(request.model)}catch(_:Exception){null}?:throw CoastApiException(CoastApiErrorKind.Model,"local_provider_missing","请先选择本机供应商模型。")
        fun number(key:String,fallback:Int)=request.settings[key]?.jsonPrimitive?.intOrNull?:fallback
        val recent=number("recentTurns",8).coerceAtLeast(1)
        val context=number("contextBudget",6000)
        val output=number("maxOutputTokens",8000).coerceIn(64,65536)
        val temperature=when(request.settings["creativity"]?.jsonPrimitive?.contentOrNull){"stable"->0.3;"expansive"->1.0;else->0.7}
        if(!LocalReplyRunStore.markLive(cid,seq))throw CoastApiException(CoastApiErrorKind.Request,"reply_run_not_acquired","同一任务已在本机运行。")
        try{
        try{withContext(Dispatchers.IO){
            ledger.recover(cid)
            val cache=com.elementeracoast.app.core.remote.RemoteCacheStore(store,strictReads=true)
            val h=cache.history(cid)?:error("原窗口不存在")
            val cfg=h.contextSettings
            if(request.imageToolEnabled)require(cache.profile()?.currentImageModel==request.imageModelId){"生图模型选择已变化。"}
            h
        }}catch(e:CancellationException){throw e}catch(e:Exception){
            throw CoastApiException(CoastApiErrorKind.Request,"local_reply_preflight",e.message.orEmpty().take(240).ifBlank{"连续回复准备失败。"})
        }
        val acquired=withContext(Dispatchers.IO){ledger.acquire(request)}
        if(!acquired)throw CoastApiException(CoastApiErrorKind.Request,"reply_run_not_acquired","连续回复任务未取得资格；没有调用模型。")
        var saved=0;var status="completed";var detail:String?=null
        var deliveredDogtalk=""
        try{
            val max=withContext(Dispatchers.IO){ledger.maxMessages(cid,seq)}
            emit(ReplyRunEvent.Start(max))
            for(index in 0 until max){
                currentCoroutineContext().ensureActive()
                val mid=UUID.randomUUID().toString()
                if(!withContext(Dispatchers.IO){ledger.reserve(cid,seq,mid,index)}){status="permission_or_budget";break}
                val claim=withContext(Dispatchers.IO){ledger.claim(cid,seq,mid)}
                if(claim==null){status="reservation_lost";break}
                val source=claim.history.turns.single{it.id==tid}
                val cfg=claim.history.contextSettings
                val attachmentIds=ChatSyncMapper.activeAttachmentIds(claim.history,tid)
                val policy=client.inputBudget(provider,model,context,output,claim.mayContinue||claim.tools>0&&(cfg.localModelToolsEnabled||cfg.localModelWriteEnabled||cfg.crossWindowAuto))
                val prepared=withContext(Dispatchers.IO){
                    knowledge.context(ChatSyncMapper.contextMessages(claim.history,tid,recent),policy.comfort,knowledge.surfaceFor(cid),cid,attachmentIds,tid,request.crossWindow,request.realityContext?:RemoteRealityContext(),policy,groupDogtalk=if(index==0)null else deliveredDogtalk)
                }
                if(index==0)deliveredDogtalk=prepared.receipt.dogtalk.context.takeIf{prepared.receipt.dogtalk.delivered}.orEmpty()
                val previous=withContext(Dispatchers.IO){
                    val wire=mutableListOf<JsonObject>()
                    val receipts=mutableListOf<com.elementeracoast.app.core.remote.RemoteDeskSequenceMessage>()
                    val originals=LocalAttachmentStore(store)
                    for(v in claim.previous){
                        if(v.content.isNotBlank())wire.add(buildJsonObject{put("role","assistant");put("content",v.content)})
                        val refs=v.attachments.filter{it.imageGeneration?.messageId==v.id||it.stickerDelivery?.messageId==v.id}
                        val delivered=mutableListOf<com.elementeracoast.app.core.remote.RemoteDeskAttachmentItem>()
                        val withheld=mutableListOf<com.elementeracoast.app.core.remote.RemoteDeskAttachmentItem>()
                        val parts=mutableListOf<JsonObject>()
                        for(a in refs){
                            val row=originals.entries().singleOrNull{it.metadata["id"]?.jsonPrimitive?.content==a.id&&it.metadata["conversation_id"]?.jsonPrimitive?.content==cid}
                            val read=row?.let{prepareGeneratedImageReadback(a.id,originals.bytes(it),a.mime,policy.vision)}
                            if(read?.continuationMessage!=null){
                                parts.addAll(read.continuationMessage.getValue("content").jsonArray.map{it.jsonObject}.filter{it["type"]?.jsonPrimitive?.content=="image_url"})
                                delivered.add(com.elementeracoast.app.core.remote.RemoteDeskAttachmentItem(id=a.id,name=a.name,type="image",mode="image"))
                            }else withheld.add(com.elementeracoast.app.core.remote.RemoteDeskAttachmentItem(id=a.id,name=a.name,type="image",reason=read?.receipt?.get("status")?.jsonPrimitive?.contentOrNull?:"attachment_not_found"))
                        }
                        if(refs.isNotEmpty()){
                            val note="【本组前序媒体 · 系统转交，非人类新发言】原助手消息 "+v.id+"；已保存图像 "+refs.joinToString("、"){it.id}+"。"+if(parts.isEmpty())"本次未递入像素，不要声称看见。" else "附已核验的部分或全部像素；未递入："+withheld.joinToString("、"){it.id}
                            wire.add(buildJsonObject{
                                if(parts.isEmpty()){put("role","system");put("content",note)}
                                else{put("role","user");put("content",JsonArray(listOf(buildJsonObject{put("type","text");put("text",note)})+parts))}
                            })
                        }
                        receipts.add(com.elementeracoast.app.core.remote.RemoteDeskSequenceMessage(v.id,v.content,
                            if(refs.isEmpty())null else com.elementeracoast.app.core.remote.RemoteDeskAttachments(uploaded=refs.size,deliveredToModel=delivered.size,delivered=delivered,notDelivered=withheld,vision=com.elementeracoast.app.core.remote.RemoteDeskAttachmentVision(supported=policy.vision==true,imagesDelivered=parts.size))))
                    }
                    wire to receipts
                }
                val image=if(claim.tools>0&&request.imageToolEnabled)withContext(Dispatchers.IO){
                    knowledge.imageTool(cid,tid,request.userVariantId,mid,providers,policy.vision,seq)
                        ?:throw CoastApiException(CoastApiErrorKind.Request,"local_image_unavailable","所选本机生图模型或写入授权不可用。")
                }else null
                val sticker=claim.tools>0&&cfg.localModelWriteEnabled&&(cfg.stickerAddEnabled||cfg.stickerSendEnabled&&cfg.localModelToolsEnabled)
                if(image!=null||sticker)require(withContext(Dispatchers.IO){ledger.reserveMedia(cid,seq,mid,request.model,image!=null)}){"媒体预约未确认。"}
                val session=if(claim.tools>0)withContext(Dispatchers.IO){knowledge.toolSession(cid,tid,request.crossWindow,prepared.receipt,request.model,policy.wireLimit,image,mid,seq)}else null
                var content="";var done:LocalProviderEvent.Done?=null
                val runs=mutableListOf<RemoteFurnitureRun>()
                currentCoroutineContext().ensureActive()
                emit(ReplyRunEvent.Begin(mid,index))
                client.streamWithTools(provider,model,prepared.messages,output,prepared.imageParts,session,temperature,
                    LocalSequenceControl(claim.mayContinue,claim.tools,claim.tokens,policy.wireLimit),previous.first).collect{event->
                    when(event){
                        is LocalProviderEvent.Delta->{content+=event.text;emit(ReplyRunEvent.Delta(mid,event.text))}
                        is LocalProviderEvent.Tool->{runs.addAll(event.result.furnitureRuns);ToolActivityBus.publish(event.id,event.name,event.result.ok)}
                        is LocalProviderEvent.Done->{done=event}
                    }
                }
                val finished=done?:throw CoastApiException(CoastApiErrorKind.Stream,"local_stream_incomplete","本机回复流未正常完成。")
                if(content.isBlank()&&image?.saved!=true&&session?.stickerSaved!=true)throw CoastApiException(CoastApiErrorKind.Model,"local_empty_reply","供应商未返回可显示正文。")
                val receipt=LocalReplyRunStore.Usage(mid,finished.ordinaryToolCalls,finished.metadata?.usage?.totalTokens,finished.continueRequested)
                val variant=RemoteVariant(mid,content,Instant.now().toString(),modelId=request.model,finishReason=finished.reason,generationSource="chat",
                    furnitureRuns=runs,deskSlip=(session?.receipt?:prepared.receipt).copy(replySequencePrevious=previous.second,archivedJson=null),usage=finished.metadata?.usage,modelEcho=finished.metadata?.copy(usage=null))
                val result=withContext(Dispatchers.IO){ledger.commit(cid,seq,variant,receipt)}
                    ?:throw CoastApiException(CoastApiErrorKind.Request,"reply_commit_unconfirmed","回复未确认写入；不会自动重放。")
                val canonical=result.first
                val savedVariant=canonical.turns.single{it.id==tid}.assistant.variantsByUserVariant.getValue(source.user.active.toString()).single{it.id==mid}
                saved++
                emit(ReplyRunEvent.Committed(mid,index,canonical,savedVariant))
                if(!result.second.continueRequested)break
                if(!claim.mayContinue){status="limit_reached";break}
            }
        }catch(e:CancellationException){
            withContext(NonCancellable+Dispatchers.IO){ledger.settle(cid,seq,"cancelled")}
            throw e
        }catch(e:Exception){
            status="failed"
            detail=if(e is CoastApiException)e.message else "本机连续回复未完成；已正式保存的消息保留。"
        }
        val settled=withContext(NonCancellable+Dispatchers.IO){ledger.settle(cid,seq,status)}
        if(!settled)throw CoastApiException(CoastApiErrorKind.Request,"reply_settle_unconfirmed","任务状态未确认；请重新打开窗口。")
        emit(ReplyRunEvent.End(status,saved,detail,if(status in setOf("completed","limit_reached"))null else withContext(Dispatchers.IO){com.elementeracoast.app.core.remote.RemoteCacheStore(store,strictReads=true).history(cid)}))
        }finally{LocalReplyRunStore.unmarkLive(cid,seq)}
    }

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
