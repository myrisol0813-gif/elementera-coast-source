package com.elementeracoast.app.core.model

data class TurnDeskReceipt(
    val summary: String,
    val comfort: String,
    val sections: List<TurnDeskSection>
)

data class TurnDeskSection(
    val title: String,
    val status: String,
    val details: List<TurnDeskDetail> = emptyList()
)

data class TurnDeskDetail(
    val label: String = "",
    val text: String
)

data class ThoughtSoilSnapshot(
    val conversationId: String,
    val currentText: String,
    val handSeeds: List<ThoughtSeedSnapshot>,
    val doNotRepeat: String,
    val pocketCandidates: List<ThoughtPocketSnapshot>,
    val manualLocked: Boolean,
    val revision: Int,
    val organizer: String,
    val updatedAt: String
)

data class ThoughtSeedSnapshot(
    val name: String,
    val lifeCore: String,
    val usageHint: String,
    val avoidHint: String
)

data class ThoughtPocketSnapshot(
    val title: String,
    val lifeCore: String,
    val content: String,
    val usageHint: String,
    val avoidHint: String,
    val sourceExcerpt: String
)
