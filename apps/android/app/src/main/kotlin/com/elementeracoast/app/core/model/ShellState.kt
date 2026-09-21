package com.elementeracoast.app.core.model

import com.elementeracoast.app.ui.theme.CoastThemePreset

data class CoastShellState(
    val authenticated: Boolean = false,
    val authBusy: Boolean = true,
    val authMessage: String? = null,
    val sessionPersistence: String = "",
    val sessionExpiresAtEpochSeconds: Long = 0L,
    val backendOffline: Boolean = false,
    val historyLoading: Boolean = false,
    val password: String = "",
    val theme: CoastThemePreset = CoastThemePreset.CoastDefault,
    val userBubbleHex: String = "",
    val accentHex: String = "",
    val activeRoomType: RoomType = RoomType.Main,
    val activeFeature: FeatureDestination? = null,
    val actionLogFocusIds: Set<String> = emptySet(),
    val conversations: List<ConversationSummary> = emptyList(),
    val activeConversationId: String = "",
    val messages: List<ChatMessage> = emptyList(),
    val pendingAttachments: List<ChatAttachment> = emptyList(),
    val attachmentUploading: Boolean = false,
    val thoughtSoil: ThoughtSoilSnapshot? = null,
    val turnDeskReceipt: TurnDeskReceipt? = null,
    val currentModel: String = "",
    val models: List<String> = emptyList(),
    val myriAvatarDataUrl: String = "",
    val xiaohanAvatarDataUrl: String = "",
    val coverDataUrl: String = "",
    val isStreaming: Boolean = false,
    val streamingMessageId: Long? = null,
    val streamingVariantIndex: Int? = null,
    val showModelPicker: Boolean = false,
    val snackbarMessage: String? = null
)
