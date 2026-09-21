package com.elementeracoast.app.feature.memory

data class MemoryEntry(
    val id: String = "",
    val entryType: String = "memory",
    val title: String = "",
    val lifeCore: String = "",
    val content: String = "",
    val usageHint: String = "",
    val avoidHint: String = "",
    val memoryLevel: String = "ordinary",
    val status: String = "active",
    val tags: List<String> = emptyList(),
    val sourceModel: String = "",
    val sourceWindow: String = "",
    val sourceDate: String = "",
    val tag: String = ""
)

data class MemoryPocket(
    val id: String,
    val conversationId: String,
    val title: String,
    val lifeCore: String,
    val content: String,
    val usageHint: String,
    val avoidHint: String,
    val sourceExcerpt: String,
    val status: String
)

data class WorldbookEntry(
    val id: String = "",
    val title: String = "",
    val content: String = "",
    val keywords: List<String> = emptyList(),
    val useRegex: Boolean = false,
    val caseSensitive: Boolean = false,
    val constantActive: Boolean = false,
    val priority: Int = 0,
    val scanDepth: Int = 4,
    val enabled: Boolean = true,
    val scope: String = "owner",
    val visitorSafe: Boolean = false
)

data class CustomInstructions(
    val content: String = "",
    val status: String = "active",
    val updatedAt: String? = null,
    val updatedBy: String = "xiaohan",
    val source: String = "屋主手动编辑"
)


data class GlobalExcerptCandidate(
    val id: String,
    val proposedBody: String = "",
    val changeKind: String = "rewrite",
    val reason: String = "",
    val sourceConversationId: String? = null,
    val sourceMessageId: String? = null,
    val sourceModel: String = "",
    val createdAt: String? = null
)

data class GlobalExcerptRevision(
    val id: String,
    val revision: Int = 0,
    val beforeBody: String = "",
    val afterBody: String = "",
    val sourceConversationId: String? = null,
    val sourceMessageId: String? = null,
    val modelReason: String = "",
    val confirmationMode: String = "",
    val operator: String = "",
    val createdAt: String? = null
)

data class GlobalExcerpt(
    val writeGuidance: String = "",
    val body: String = "",
    val writeEnabled: Boolean = false,
    val revision: Int = 1,
    val createdAt: String? = null,
    val updatedAt: String? = null,
    val candidates: List<GlobalExcerptCandidate> = emptyList(),
    val revisions: List<GlobalExcerptRevision> = emptyList()
)

data class MemorySnapshot(
    val memories: List<MemoryEntry> = emptyList(),
    val seeds: List<MemoryEntry> = emptyList(),
    val pockets: List<MemoryPocket> = emptyList(),
    val pocketConversationId: String? = null,
    val worldbook: List<WorldbookEntry> = emptyList(),
    val customInstructions: CustomInstructions = CustomInstructions(),
    val globalExcerpt: GlobalExcerpt = GlobalExcerpt()
)

internal val canonicalMemoryTags = listOf(
    "关系",
    "历史锚点",
    "偏好",
    "人物档案",
    "世界观",
    "工程技术"
)
