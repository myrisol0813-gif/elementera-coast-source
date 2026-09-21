package com.elementeracoast.app.core.remote

import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class RemoteMemoryEntry(
    val id: String = "",
    @SerialName("entry_type") val entryType: String = "memory",
    val title: String = "",
    @SerialName("life_core") val lifeCore: String = "",
    val content: String = "",
    @SerialName("usage_hint") val usageHint: String = "",
    @SerialName("avoid_hint") val avoidHint: String = "",
    @SerialName("memory_level") val memoryLevel: String = "ordinary",
    val status: String = "active",
    @SerialName("memory_tags") val memoryTags: List<String> = emptyList(),
    @SerialName("source_model") val sourceModel: String = "",
    @SerialName("source_window") val sourceWindow: String = "",
    @SerialName("source_date") val sourceDate: String = "",
    val tag: String = "",
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null
)

@Serializable
data class RemoteMemoryEntryWriteRequest(
    @SerialName("entry_type") val entryType: String,
    val title: String,
    @SerialName("life_core") val lifeCore: String,
    val content: String = "",
    @SerialName("usage_hint") val usageHint: String = "",
    @SerialName("avoid_hint") val avoidHint: String = "",
    @SerialName("memory_level") val memoryLevel: String = "ordinary",
    val status: String,
    val tag: String = "",
    @SerialName("memory_tags") val memoryTags: List<String> = emptyList(),
    @SerialName("source_model") val sourceModel: String = "",
    @SerialName("source_window") val sourceWindow: String = "",
    @SerialName("source_time") val sourceTime: String? = null
)

@Serializable
data class RemoteMemoryFacets(
    val models: List<String> = emptyList(),
    val windows: List<String> = emptyList(),
    val tags: List<String> = emptyList(),
    val times: List<String> = emptyList()
)

@Serializable
data class RemoteMemoryEntryListResponse(
    val ok: Boolean = false,
    val entries: List<RemoteMemoryEntry> = emptyList(),
    val facets: RemoteMemoryFacets = RemoteMemoryFacets()
)

@Serializable
data class RemoteMemoryEntryResponse(
    val ok: Boolean = false,
    val entry: RemoteMemoryEntry
)

@Serializable
data class RemoteMemoryPocket(
    val id: String = "",
    @SerialName("conversation_id") val conversationId: String = "",
    val title: String = "",
    @SerialName("life_core") val lifeCore: String = "",
    val content: String = "",
    @SerialName("usage_hint") val usageHint: String = "",
    @SerialName("avoid_hint") val avoidHint: String = "",
    @SerialName("source_excerpt") val sourceExcerpt: String = "",
    val status: String = "pending",
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null
)

@Serializable
data class RemoteMemoryPocketListResponse(
    val ok: Boolean = false,
    val pockets: List<RemoteMemoryPocket> = emptyList()
)

@Serializable
data class RemoteMemoryPocketResolveRequest(
    val action: String,
    val tag: String? = null,
    val title: String? = null,
    @SerialName("life_core") val lifeCore: String? = null,
    val content: String? = null,
    @SerialName("usage_hint") val usageHint: String? = null,
    @SerialName("avoid_hint") val avoidHint: String? = null,
    @SerialName("memory_level") val memoryLevel: String? = null
)

@Serializable
data class RemoteMemoryPocketResolveResponse(
    val ok: Boolean = false,
    val pocket: RemoteMemoryPocket,
    val entry: RemoteMemoryEntry? = null
)

@Serializable
data class RemoteCustomInstructions(
    val title: String = "当前自定义指令",
    val content: String = "",
    val status: String = "active",
    @SerialName("updated_at") val updatedAt: String? = null,
    @SerialName("updated_by") val updatedBy: String = "owner",
    val source: String = "屋主手动编辑"
)

@Serializable
data class RemoteCustomInstructionsResponse(
    val ok: Boolean = false,
    val instructions: RemoteCustomInstructions? = null
)

@Serializable
data class RemoteCustomInstructionsPutRequest(
    val content: String,
    @EncodeDefault(EncodeDefault.Mode.ALWAYS)
    @SerialName("updated_by") val updatedBy: String = "owner",
    @EncodeDefault(EncodeDefault.Mode.ALWAYS)
    val source: String = "Native 手动编辑"
)

@Serializable
data class RemoteWorldbookEntry(
    val id: String = "",
    val title: String = "",
    val content: String = "",
    val keywords: List<String> = emptyList(),
    @SerialName("use_regex") val useRegex: Boolean = false,
    @SerialName("case_sensitive") val caseSensitive: Boolean = false,
    @SerialName("constant_active") val constantActive: Boolean = false,
    val priority: Int = 0,
    @SerialName("scan_depth") val scanDepth: Int = 4,
    val enabled: Boolean = true,
    val scope: String = "owner",
    @SerialName("visitor_safe") val visitorSafe: Boolean = false,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null
)

@Serializable
data class RemoteWorldbookEntryWriteRequest(
    val title: String,
    val content: String,
    val keywords: List<String> = emptyList(),
    @SerialName("use_regex") val useRegex: Boolean = false,
    @SerialName("case_sensitive") val caseSensitive: Boolean = false,
    @SerialName("constant_active") val constantActive: Boolean = false,
    val priority: Int = 0,
    @SerialName("scan_depth") val scanDepth: Int = 4,
    val enabled: Boolean = true,
    val scope: String = "owner",
    @SerialName("visitor_safe") val visitorSafe: Boolean = false
)

@Serializable
data class RemoteWorldbookListResponse(
    val ok: Boolean = false,
    val entries: List<RemoteWorldbookEntry> = emptyList()
)

@Serializable
data class RemoteWorldbookEntryResponse(
    val ok: Boolean = false,
    val entry: RemoteWorldbookEntry
)

@Serializable
data class RemoteWorldbookMatchRequest(
    val input: String,
    @EncodeDefault(EncodeDefault.Mode.ALWAYS)
    val surface: String = "main_chat",
    @EncodeDefault(EncodeDefault.Mode.ALWAYS)
    @SerialName("allowed_scopes") val allowedScopes: List<String> = listOf("owner", "both"),
    @EncodeDefault(EncodeDefault.Mode.ALWAYS)
    val limit: Int = 6
)

@Serializable
data class RemoteWorldbookMatchResponse(
    val ok: Boolean = false,
    val matches: List<RemoteWorldbookEntry> = emptyList()
)


@Serializable
data class RemoteGlobalExcerpt(
    @SerialName("write_guidance") val writeGuidance: String = "",
    val body: String = "",
    @SerialName("write_enabled") val writeEnabled: Boolean = false,
    val revision: Int = 1,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null
)

@Serializable
data class RemoteGlobalExcerptCandidate(
    val id: String,
    @SerialName("proposed_body") val proposedBody: String = "",
    @SerialName("change_kind") val changeKind: String = "rewrite",
    val reason: String = "",
    @SerialName("source_conversation_id") val sourceConversationId: String? = null,
    @SerialName("source_message_id") val sourceMessageId: String? = null,
    @SerialName("source_model") val sourceModel: String = "",
    @SerialName("created_at") val createdAt: String? = null
)

@Serializable
data class RemoteGlobalExcerptRevision(
    val id: String,
    val revision: Int = 0,
    @SerialName("before_body") val beforeBody: String = "",
    @SerialName("after_body") val afterBody: String = "",
    @SerialName("source_conversation_id") val sourceConversationId: String? = null,
    @SerialName("source_message_id") val sourceMessageId: String? = null,
    @SerialName("model_reason") val modelReason: String = "",
    @SerialName("confirmation_mode") val confirmationMode: String = "",
    val operator: String = "",
    @SerialName("created_at") val createdAt: String? = null
)

@Serializable
data class RemoteGlobalExcerptResponse(
    val ok: Boolean = false,
    val excerpt: RemoteGlobalExcerpt = RemoteGlobalExcerpt(),
    val candidates: List<RemoteGlobalExcerptCandidate> = emptyList(),
    val revisions: List<RemoteGlobalExcerptRevision> = emptyList()
)

@Serializable
data class RemoteGlobalExcerptPatchRequest(
    @SerialName("write_enabled") val writeEnabled: Boolean
)

@Serializable
data class RemoteGlobalExcerptConfirmRequest(
    val action: String,
    @SerialName("edited_body") val editedBody: String? = null,
    val operator: String
)
