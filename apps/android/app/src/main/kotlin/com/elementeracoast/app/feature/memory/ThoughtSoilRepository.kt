package com.elementeracoast.app.feature.memory

import com.elementeracoast.app.core.model.PortraitCandidateSnapshot
import com.elementeracoast.app.core.model.ThoughtCandidateSnapshot
import com.elementeracoast.app.core.model.ThoughtSoilSnapshot
import com.elementeracoast.app.core.model.SoilHistoricSnapshot
import com.elementeracoast.app.core.network.CoastApiClient
import com.elementeracoast.app.core.network.CoastApiException
import com.elementeracoast.app.feature.chatgpt.ChatGptPlanRepository
import com.elementeracoast.app.core.remote.RemoteThoughtSoil

internal const val THOUGHT_SOIL_MAX_OUTPUT_TOKENS = 2400

internal fun selectThoughtSoilReasoningEffort(supported: List<String>): String? =
    listOf("none", "minimal", "low").firstOrNull(supported::contains)

interface ThoughtSoilRepository {
    suspend fun load(conversationId: String): ThoughtSoilSnapshot
    suspend fun setEnabled(conversationId: String, enabled: Boolean): ThoughtSoilSnapshot
    suspend fun saveManual(conversationId: String, current: String, afterthoughts: List<String>): ThoughtSoilSnapshot
    suspend fun resumeAutomatic(conversationId: String): ThoughtSoilSnapshot
    suspend fun organizeAfterReply(conversationId: String, modelId: String): ThoughtSoilSnapshot
    suspend fun organizeAfterSequence(conversationId:String,modelId:String,sequenceId:String):ThoughtSoilSnapshot = error("连续回复整理未接入")
}

class DefaultThoughtSoilRepository(
    private val api: CoastApiClient,
    private val plan: ChatGptPlanRepository? = null,
    private val localOrganizer: (suspend (String, String) -> Unit)? = null,
    private val localSequenceOrganizer:(suspend (String,String,String)->Unit)?=null
) : ThoughtSoilRepository {
    override suspend fun load(conversationId: String): ThoughtSoilSnapshot {
        val response = api.getThoughtSoilResponse(conversationId)
        return response.soil.toSnapshot(conversationId).copy(
            history = response.history.map { item ->
                SoilHistoricSnapshot(item.turnId, item.assistantMessageId,
                    item.currentText, item.afterthoughts, item.revision,
                    item.displayAuthor.ifBlank { item.modelLabel }, item.createdAt)
            },
            historyTruncated = response.historyTruncated
        )
    }

    override suspend fun setEnabled(conversationId: String, enabled: Boolean): ThoughtSoilSnapshot {
        api.setThoughtSoilEnabled(conversationId, enabled)
        return load(conversationId)
    }

    override suspend fun saveManual(conversationId: String, current: String, afterthoughts: List<String>): ThoughtSoilSnapshot {
        api.saveThoughtSoil(conversationId, current, afterthoughts)
        return load(conversationId)
    }

    override suspend fun resumeAutomatic(conversationId: String): ThoughtSoilSnapshot {
        api.resumeThoughtSoil(conversationId)
        return load(conversationId)
    }

    override suspend fun organizeAfterSequence(conversationId:String,modelId:String,sequenceId:String):ThoughtSoilSnapshot{
        if(localOrganizer!=null){
            requireNotNull(localSequenceOrganizer){"本机连续回复整理尚未接通"}.invoke(conversationId,modelId,sequenceId)
            return load(conversationId)
        }
        if(modelId.startsWith("chatgpt-plan:"))return organizePlan(conversationId,modelId,sequenceId)
        val result=api.organizeReplyRunSoil(conversationId,modelId,sequenceId)
        require(result.ok&&!result.degraded){"思维壤整理未确认"}
        return load(conversationId)
    }

    override suspend fun organizeAfterReply(conversationId: String, modelId: String): ThoughtSoilSnapshot {
        if (localOrganizer != null) {
            localOrganizer.invoke(conversationId, modelId)
            return load(conversationId)
        }
        if (modelId.startsWith("chatgpt-plan:")) return organizePlan(conversationId,modelId,null)
        return try {
            api.organizeThoughtSoil(conversationId, modelId)
            load(conversationId)
        } catch (error: CoastApiException) {
            if (error.type != "soil_locked") throw error
            load(conversationId)
        }
    }
    private suspend fun organizePlan(conversationId:String,modelId:String,sequenceId:String?):ThoughtSoilSnapshot {
            val account = requireNotNull(plan) { "请先连接 ChatGPT 套餐再整理思维壤。" }
            val prepared = api.preparePlanSoil(conversationId, modelId, sequenceId)
            if (prepared.skipped) return load(conversationId)
            require(prepared.ok && prepared.prompt.isNotBlank() && prepared.model == modelId && (sequenceId==null||prepared.expectedHistoryRevision.isNotBlank())) {
                "思维壤准备失败；未调用其他模型额度。"
            }
            val modelSlug = modelId.removePrefix("chatgpt-plan:")
            val reasoningEffort = selectThoughtSoilReasoningEffort(account.reasoningEffortsFor(modelSlug))
            val result = account.completeText(
                model = modelSlug,
                prompt = prepared.prompt,
                reasoningEffort = reasoningEffort,
                maxOutputTokens = if (reasoningEffort != null) THOUGHT_SOIL_MAX_OUTPUT_TOKENS else null
            )
            require(result.text.length <= prepared.maxResultChars) {
                "GPT 思维壤整理结果超出后端允许长度；未覆盖原资料。"
            }
            val committed = api.commitPlanSoil(
                conversationId, modelId, prepared, result.text,
                result.inputTokens, result.cachedTokens, result.outputTokens, sequenceId
            )
            require(committed.ok&&!committed.degraded&&!committed.skipped) { "思维壤结果未能保存。" }
            return load(conversationId)
    }
}

internal fun RemoteThoughtSoil.toSnapshot(fallbackConversationId: String = ""): ThoughtSoilSnapshot = ThoughtSoilSnapshot(
    conversationId = conversationId.ifBlank { fallbackConversationId },
    currentText = currentText,
    afterthoughts = afterthoughts,
    memoryCandidates = memoryCandidates.map { candidate ->
        ThoughtCandidateSnapshot(
            title = candidate.title.ifBlank { candidate.content },
            content = candidate.content,
            sourceExcerpt = candidate.sourceExcerpt
        )
    },
    seedCandidates = seedCandidates.map { candidate ->
        ThoughtCandidateSnapshot(
            title = candidate.title.ifBlank { candidate.content },
            content = candidate.content,
            sourceExcerpt = candidate.sourceExcerpt
        )
    },
    userPortraitCandidate = userPortraitCandidate?.let {
        PortraitCandidateSnapshot(it.candidateId, it.reason, it.sourceExcerpt)
    },
    selfPortraitCandidate = selfPortraitCandidate?.let {
        PortraitCandidateSnapshot(it.candidateId, it.reason, it.sourceExcerpt)
    },
    manualLocked = manualLocked,
    autoRefreshEnabled = autoRefreshEnabled,
    revision = revision.coerceAtLeast(1),
    organizer = displayAuthor.ifBlank { organizedByModel.substringAfterLast('/').ifBlank { "尚未整理" } },
    updatedAt = updatedAt.ifBlank { organizedAt }
)
