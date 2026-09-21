package com.elementeracoast.app.feature.memory

import com.elementeracoast.app.core.model.ThoughtPocketSnapshot
import com.elementeracoast.app.core.model.ThoughtSeedSnapshot
import com.elementeracoast.app.core.model.ThoughtSoilSnapshot
import com.elementeracoast.app.core.network.CoastApiClient
import com.elementeracoast.app.core.network.CoastApiException
import com.elementeracoast.app.core.remote.RemoteThoughtSoil

interface ThoughtSoilRepository {
    suspend fun load(conversationId: String): ThoughtSoilSnapshot
    suspend fun organizeAfterReply(conversationId: String, modelId: String): ThoughtSoilSnapshot
}

class DefaultThoughtSoilRepository(
    private val api: CoastApiClient
) : ThoughtSoilRepository {
    override suspend fun load(conversationId: String): ThoughtSoilSnapshot =
        api.getThoughtSoil(conversationId).toSnapshot(conversationId)

    override suspend fun organizeAfterReply(conversationId: String, modelId: String): ThoughtSoilSnapshot {
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
    handSeeds = handSeeds.map { seed ->
        ThoughtSeedSnapshot(
            name = seed.name.ifBlank { seed.lifeCore },
            lifeCore = seed.lifeCore,
            usageHint = seed.usageHint,
            avoidHint = seed.avoidHint
        )
    },
    doNotRepeat = doNotRepeat,
    pocketCandidates = pocketCandidates.map { candidate ->
        ThoughtPocketSnapshot(
            title = candidate.title.ifBlank { candidate.lifeCore },
            lifeCore = candidate.lifeCore,
            content = candidate.content,
            usageHint = candidate.usageHint,
            avoidHint = candidate.avoidHint,
            sourceExcerpt = candidate.sourceExcerpt
        )
    },
    manualLocked = manualLocked,
    revision = revision.coerceAtLeast(1),
    organizer = displayAuthor.ifBlank { organizedByModel.substringAfterLast('/').ifBlank { "尚未整理" } },
    updatedAt = updatedAt.ifBlank { organizedAt }
)
