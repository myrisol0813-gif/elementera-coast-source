package com.elementeracoast.app.core.remote

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class RemoteDeskSlip(
    val summary: String = "",
    val comfort: String = "",
    @SerialName("current_message") val currentMessage: RemoteDeskCurrentMessage = RemoteDeskCurrentMessage(),
    @SerialName("recent_context") val recentContext: RemoteDeskRecentContext = RemoteDeskRecentContext(),
    @SerialName("custom_instructions") val customInstructions: RemoteDeskCustomInstructions = RemoteDeskCustomInstructions(),
    @SerialName("global_excerpt") val globalExcerpt: RemoteDeskGlobalExcerpt = RemoteDeskGlobalExcerpt(),
    @SerialName("thinking_soil") val thinkingSoil: RemoteDeskThinkingSoil = RemoteDeskThinkingSoil(),
    @SerialName("related_memory") val relatedMemory: RemoteDeskMemory = RemoteDeskMemory(),
    val worldbook: RemoteDeskWorldbook = RemoteDeskWorldbook(),
    val dogtalk: RemoteDeskDogtalk = RemoteDeskDogtalk(),
    @SerialName("cross_window") val crossWindow: RemoteDeskCrossWindow = RemoteDeskCrossWindow(),
    val workbench: RemoteDeskWorkbench = RemoteDeskWorkbench(),
    val attachments: RemoteDeskAttachments? = null,
    @SerialName("web_search") val webSearch: RemoteDeskWebSearch? = null,
    @SerialName("external_tide") val externalTide: RemoteDeskExternalTide = RemoteDeskExternalTide(),
    @SerialName("context_budget") val contextBudget: RemoteDeskContextBudget = RemoteDeskContextBudget()
)

@Serializable
data class RemoteDeskCurrentMessage(
    val label: String = "当前消息",
    val description: String = "",
    val status: String = "未递给",
    val delivered: Boolean = false,
    val content: String = ""
)

@Serializable
data class RemoteDeskRecentContext(
    val label: String = "最近上下文",
    val description: String = "",
    val status: String = "未递给",
    @SerialName("status_detail") val statusDetail: String = "",
    val turns: Int = 0,
    val messages: List<RemoteChatMessage> = emptyList()
)

@Serializable
data class RemoteDeskCustomInstructions(
    val label: String = "核心自定义",
    val description: String = "",
    val status: String = "未递给",
    val delivered: Boolean = false,
    val length: Int = 0,
    val content: String = ""
)

@Serializable
data class RemoteDeskGlobalExcerpt(
    val label: String = "全局摘录",
    val description: String = "",
    val status: String = "未设置",
    val delivered: Boolean = false,
    val injection: String = "",
    @SerialName("estimated_tokens") val estimatedTokens: Int = 0,
    val length: Int = 0,
    val content: String = ""
)

@Serializable
data class RemoteDeskContextBudget(
    val label: String = "上下文预算",
    @SerialName("estimated_tokens") val estimatedTokens: Int = 0,
    @SerialName("comfort_ceiling") val comfortCeiling: Int = 0,
    val trimmed: Boolean = false,
    @SerialName("trimmed_count") val trimmedCount: Int = 0,
    @SerialName("exceeds_comfort_ceiling") val exceedsComfortCeiling: Boolean = false,
    @SerialName("sources_preserved") val sourcesPreserved: List<String> = emptyList(),
    @SerialName("global_excerpt") val globalExcerpt: String = ""
)

@Serializable
data class RemoteDeskThinkingSoil(
    val label: String = "整理当前对话的纸条",
    val description: String = "",
    val status: String = "未递给",
    val delivered: Boolean = false,
    val context: String = "",
    @SerialName("current_text") val currentText: String = "",
    @SerialName("hand_seeds") val handSeeds: List<String> = emptyList(),
    @SerialName("hand_seeds_count") val handSeedsCount: Int = 0,
    @SerialName("pocket_candidates_count") val pocketCandidatesCount: Int = 0,
    @SerialName("pocket_candidates_status") val pocketCandidatesStatus: String = "未递入"
)

@Serializable
data class RemoteDeskMemory(
    val label: String = "相关记忆",
    val description: String = "",
    val status: String = "未命中",
    @SerialName("confirmation_status") val confirmationStatus: String = "",
    val count: Int = 0,
    val items: List<RemoteDeskMemoryItem> = emptyList()
)

@Serializable
data class RemoteDeskMemoryItem(
    val title: String = "",
    @SerialName("entry_type") val entryType: String = "memory",
    val tag: String = "",
    @SerialName("source_model") val sourceModel: String = "",
    @SerialName("source_window") val sourceWindow: String = "",
    @SerialName("source_time") val sourceTime: String = "",
    @SerialName("source_date") val sourceDate: String = "",
    val reason: String = "",
    @SerialName("life_core") val lifeCore: String = "",
    @SerialName("usage_hint") val usageHint: String = "",
    @SerialName("avoid_hint") val avoidHint: String = "",
    val content: String = "",
    @SerialName("delivered_text") val deliveredText: String = ""
)

@Serializable
data class RemoteDeskWorldbook(
    val label: String = "世界书",
    val description: String = "",
    val status: String = "未命中",
    @SerialName("matched_count") val matchedCount: Int = 0,
    @SerialName("delivered_count") val deliveredCount: Int = 0,
    val entries: List<RemoteDeskWorldbookItem> = emptyList()
)

@Serializable
data class RemoteDeskWorldbookItem(
    val title: String = "",
    val content: String = "",
    val scope: String = "",
    @SerialName("matched_by") val matchedBy: String = "",
    val delivered: Boolean = false,
    @SerialName("delivered_text") val deliveredText: String = ""
)

@Serializable
data class RemoteDeskDogtalk(
    val label: String = "私人草稿",
    val description: String = "",
    val status: String = "未递给",
    val delivered: Boolean = false,
    val context: String = ""
)

@Serializable
data class RemoteDeskCrossWindow(
    val label: String = "跨窗口读取",
    val description: String = "",
    val status: String = "未递给",
    val mode: String = "off",
    val delivered: Boolean = false,
    @SerialName("requested_windows") val requestedWindows: Int = 0,
    @SerialName("loaded_windows") val loadedWindows: Int = 0,
    @SerialName("window_count") val windowCount: Int = 0,
    @SerialName("requested_turns") val requestedTurns: Int = 0,
    @SerialName("loaded_turns") val loadedTurns: Int = 0,
    @SerialName("delivered_to_model_turns") val deliveredToModelTurns: Int = 0,
    @SerialName("requested_messages") val requestedMessages: Int = 0,
    @SerialName("loaded_messages") val loadedMessages: Int = 0,
    @SerialName("delivered_to_model_messages") val deliveredToModelMessages: Int = 0,
    @SerialName("attempted_delivered_turns") val attemptedDeliveredTurns: Int = 0,
    @SerialName("loaded_chars") val loadedChars: Int = 0,
    @SerialName("delivered_to_model_chars") val deliveredToModelChars: Int = 0,
    @SerialName("attempted_chars") val attemptedChars: Int = 0,
    @SerialName("attempted_estimated_tokens") val attemptedEstimatedTokens: Int = 0,
    @SerialName("total_requested_turns") val totalRequestedTurns: Int = 0,
    @SerialName("total_loaded_turns") val totalLoadedTurns: Int = 0,
    @SerialName("total_delivered_turns") val totalDeliveredTurns: Int = 0,
    val trimmed: Boolean = false,
    @SerialName("trim_reason") val trimReason: String = "",
    @SerialName("failure_reason") val failureReason: String? = null,
    @SerialName("provider_error_type") val providerErrorType: String = "",
    @SerialName("provider_error_message") val providerErrorMessage: String = "",
    val sources: List<RemoteDeskCrossWindowSource> = emptyList(),
    val messages: List<RemoteDeskCrossWindowMessages> = emptyList(),
    val error: String = ""
)

@Serializable
data class RemoteDeskCrossWindowSource(
    @SerialName("conversation_id") val conversationId: String = "",
    val title: String = "",
    @SerialName("room_type") val roomType: String = "main",
    val source: String = "coast",
    @SerialName("source_window_id") val sourceWindowId: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null,
    @SerialName("requested_turns") val requestedTurns: Int = 0,
    @SerialName("loaded_turns") val loadedTurns: Int = 0,
    @SerialName("delivered_to_model_turns") val deliveredToModelTurns: Int = 0,
    @SerialName("delivered_turns") val deliveredTurns: Int = 0
)

@Serializable
data class RemoteDeskCrossWindowMessages(
    @SerialName("conversation_id") val conversationId: String = "",
    val messages: List<RemoteChatMessage> = emptyList()
)

@Serializable
data class RemoteDeskWorkbench(
    val label: String = "工作台 / 工具回执",
    val description: String = "",
    val status: String = "未递给",
    @SerialName("prompt_delivered") val promptDelivered: Boolean = false,
    val prompt: String = "",
    val labels: Map<String, String> = emptyMap(),
    @SerialName("model_visible_tools") val modelVisibleTools: List<RemoteDeskTool> = emptyList(),
    @SerialName("backend_tools") val backendTools: List<RemoteDeskTool> = emptyList(),
    @SerialName("core_tools") val coreTools: List<RemoteDeskTool> = emptyList(),
    @SerialName("side_tools") val sideTools: List<RemoteDeskTool> = emptyList(),
    val furniture: List<String> = emptyList(),
    @SerialName("tool_results") val toolResults: List<RemoteDeskToolResult> = emptyList()
)

@Serializable
data class RemoteDeskAttachmentItem(
    val id: String = "",
    val name: String = "",
    val type: String = "file",
    val mode: String = "",
    val reason: String = ""
)

@Serializable
data class RemoteDeskAttachmentVision(
    val supported: Boolean = false,
    @SerialName("images_delivered") val imagesDelivered: Int = 0
)

@Serializable
data class RemoteDeskAttachments(
    val uploaded: Int = 0,
    @SerialName("delivered_to_model") val deliveredToModel: Int = 0,
    val delivered: List<RemoteDeskAttachmentItem> = emptyList(),
    @SerialName("not_delivered") val notDelivered: List<RemoteDeskAttachmentItem> = emptyList(),
    val vision: RemoteDeskAttachmentVision = RemoteDeskAttachmentVision()
)

@Serializable
data class RemoteDeskWebSearchResult(
    val title: String = "",
    val url: String = "",
    val content: String = ""
)

@Serializable
data class RemoteDeskWebSearch(
    val available: Boolean = false,
    val used: Boolean = false,
    @SerialName("requested_query") val requestedQuery: String = "",
    @SerialName("query_source") val querySource: String = "",
    @SerialName("provider_query_returned") val providerQueryReturned: Boolean = false,
    val requests: Int = 0,
    @SerialName("results_count") val resultsCount: Int = 0,
    val results: List<RemoteDeskWebSearchResult> = emptyList(),
    val reason: String? = null
)

@Serializable
data class RemoteDeskExternalTide(
    val label: String = "外部入口消息",
    val description: String = "",
    val status: String = "未递给",
    val delivered: Boolean = false,
    val content: String = "本轮没有递入外部材料。"
)

@Serializable
data class RemoteDeskTool(
    val name: String = "",
    @SerialName("display_name") val displayName: String = "",
    @SerialName("tool_key") val toolKey: String = ""
)

@Serializable
data class RemoteDeskToolResult(
    val name: String = "",
    val delivered: Boolean = false,
    val content: String = ""
)

@Serializable
data class RemoteThoughtSoilResponse(
    val ok: Boolean = false,
    val soil: RemoteThoughtSoil = RemoteThoughtSoil()
)

@OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)
@Serializable
data class RemoteSoilOrganizeRequest(
    @SerialName("conversation_id") val conversationId: String,
    val model: String,
    @kotlinx.serialization.EncodeDefault(kotlinx.serialization.EncodeDefault.Mode.ALWAYS)
    val force: Boolean = true,
    @kotlinx.serialization.EncodeDefault(kotlinx.serialization.EncodeDefault.Mode.ALWAYS)
    val trigger: String = "reply"
)

@Serializable
data class RemoteSoilOrganizeResponse(
    val ok: Boolean = true,
    val degraded: Boolean = false,
    val skipped: Boolean = false,
    val reason: String = "",
    val soil: RemoteThoughtSoil = RemoteThoughtSoil()
)

@Serializable
data class RemoteThoughtSoil(
    @SerialName("conversation_id") val conversationId: String = "",
    @SerialName("current_text") val currentText: String = "",
    @SerialName("hand_seeds") val handSeeds: List<RemoteThoughtSeed> = emptyList(),
    @SerialName("do_not_repeat") val doNotRepeat: String = "",
    @SerialName("pocket_candidates") val pocketCandidates: List<RemoteThoughtPocket> = emptyList(),
    @SerialName("manual_locked") val manualLocked: Boolean = false,
    @SerialName("auto_refresh_enabled") val autoRefreshEnabled: Boolean = true,
    val revision: Int = 1,
    @SerialName("organized_by_model") val organizedByModel: String = "",
    @SerialName("display_author") val displayAuthor: String = "",
    @SerialName("updated_at") val updatedAt: String = "",
    @SerialName("organized_at") val organizedAt: String = ""
)

@Serializable
data class RemoteThoughtSeed(
    val name: String = "",
    @SerialName("life_core") val lifeCore: String = "",
    @SerialName("usage_hint") val usageHint: String = "",
    @SerialName("avoid_hint") val avoidHint: String = ""
)

@Serializable
data class RemoteThoughtPocket(
    val title: String = "",
    @SerialName("life_core") val lifeCore: String = "",
    val content: String = "",
    @SerialName("usage_hint") val usageHint: String = "",
    @SerialName("avoid_hint") val avoidHint: String = "",
    @SerialName("source_excerpt") val sourceExcerpt: String = ""
)