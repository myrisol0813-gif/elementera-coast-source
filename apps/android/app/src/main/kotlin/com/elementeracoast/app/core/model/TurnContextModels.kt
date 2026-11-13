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
    val afterthoughts: List<String>,
    val memoryCandidates: List<ThoughtCandidateSnapshot>,
    val seedCandidates: List<ThoughtCandidateSnapshot>,
    val manualLocked: Boolean,
    val autoRefreshEnabled: Boolean = true,
    val revision: Int,
    val organizer: String,
    val updatedAt: String
)

data class ThoughtCandidateSnapshot(
    val title: String,
    val content: String,
    val sourceExcerpt: String
)
