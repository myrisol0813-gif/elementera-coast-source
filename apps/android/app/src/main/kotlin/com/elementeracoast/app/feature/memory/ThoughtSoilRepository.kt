package com.elementeracoast.app.feature.memory

import com.elementeracoast.app.core.model.ThoughtCandidateSnapshot
import com.elementeracoast.app.core.model.ThoughtSoilSnapshot
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
    suspend fun organizeAfterReply(conversationId: String, modelId: String): ThoughtSoilSnapshot
}

class DefaultThoughtSoilRepository(
    private val api: CoastApiClient,
    private val plan: ChatGptPlanRepository? = null
) : ThoughtSoilRepository {
    override suspend fun load(conversationId: String): ThoughtSoilSnapshot =
        api.getThoughtSoil(conversationId).toSnapshot(conversationId)

    override suspend fun setEnabled(conversationId: String, enabled: Boolean): ThoughtSoilSnapshot =
        api.setThoughtSoilEnabled(conversationId, enabled).toSnapshot(conversationId)

    override suspend fun organizeAfterReply(conversationId: String, modelId: String): ThoughtSoilSnapshot {
        if (modelId.startsWith("chatgpt-plan:")) {
            val account = requireNotNull(plan) { "请先连接 ChatGPT 套餐再整理当前对话纸条。" }
            val prepared = api.preparePlanSoil(conversationId, modelId)
            if (prepared.skipped) return load(conversationId)
            require(prepared.ok && prepared.prompt.isNotBlank() && prepared.model == modelId) {
                "当前对话纸条准备失败；未调用其他模型额度。"
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
                "GPT 当前对话纸条整理结果超出后端允许长度；未覆盖原资料。"
            }
            val committed = api.commitPlanSoil(
                conversationId, modelId, prepared, result.text,
                result.inputTokens, result.cachedTokens, result.outputTokens
            )
            require(committed.ok) { "当前对话纸条结果未能保存。" }
            return committed.soil.toSnapshot(conversationId)
        }
        return try {
            api.organizeThoughtSoil(conversationId, modelId).soil.toSnapshot(conversationId)
        } catch (error: CoastApiException) {
            if (error.type != "soil_locked") throw error
            api.getThoughtSoil(conversationId).toSnapshot(conversationId)
        }
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
    manualLocked = manualLocked,
    autoRefreshEnabled = autoRefreshEnabled,
    revision = revision.coerceAtLeast(1),
    organizer = displayAuthor.ifBlank { organizedByModel.substringAfterLast('/').ifBlank { "尚未整理" } },
    updatedAt = updatedAt.ifBlank { organizedAt }
)
