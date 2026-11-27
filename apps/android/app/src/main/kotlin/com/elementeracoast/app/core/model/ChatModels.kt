package com.elementeracoast.app.core.model

enum class MessageRole { User, Assistant }

data class ChatAttachment(
    val id: String,
    val type: String = "file",
    val name: String = "附件",
    val mime: String = "application/octet-stream",
    val size: Long = 0L,
    val storageKey: String = "",
    val createdAt: String = "",
    val isSticker: Boolean = false
)

data class FurnitureItem(
    val title: String,
    val kind: String = ""
)

data class FurnitureRun(
    val actionId: String,
    val actionKey: String,
    val label: String,
    val success: Boolean = true,
    val count: Int = 1,
    val items: List<FurnitureItem> = emptyList(),
    val extraCount: Int = 0,
    val errorType: String = ""
)

/** Native presentation state mapped from the remote conversation contract. */
data class ChatMessage(
    val id: Long,
    val role: MessageRole,
    val text: String,
    val turnId: String? = null,
    val remoteVariantId: String? = null,
    val modelId: String? = null,
    val generationSource: String? = null,
    val messageSource: String? = null,
    val displayAuthor: String? = null,
    val liked: Boolean = false,
    val favorite: Boolean = false,
    val errorDetail: String? = null,
    val variantIndex: Int = 0,
    val variantCount: Int = 1,
    val variants: List<String> = emptyList(),
    val createdAtLabel: String? = null,
    val attachments: List<ChatAttachment> = emptyList(),
    val furnitureRuns: List<FurnitureRun> = emptyList(),
    val deskReceipt: TurnDeskReceipt? = null,
    val replyGroupTail: Boolean = true,
    val stickerDisplaySize: Int = 144
) {
    fun normalizedVariants(): List<String> = variants.ifEmpty { listOf(text) }
}

sealed interface MessageAction {
    val messageId: Long

    data class Copy(override val messageId: Long) : MessageAction
    data class ToggleLike(override val messageId: Long) : MessageAction
    data class ToggleFavorite(override val messageId: Long) : MessageAction
    data class Regenerate(override val messageId: Long) : MessageAction
    data class Delete(override val messageId: Long) : MessageAction
    data class Edit(override val messageId: Long, val text: String) : MessageAction
    data class Retry(override val messageId: Long) : MessageAction
    data class SelectVariant(override val messageId: Long, val index: Int) : MessageAction
}

/** Presentation delimiter; the original provider text stays intact in the saved message. */
object ReplySegments {
    const val MARKER = "<!--tideloom:split-->"
    private val fence = Regex("^ {0,3}(`{3,}|~{3,})(.*)$")
    fun split(text: String, streaming: Boolean = false): List<String> {
        val parts = mutableListOf<String>()
        val buffer = mutableListOf<String>()
        var open: String? = null
        var divided = false
        val lines = text.split('\n')
        lines.forEachIndexed { index, line ->
            val clean = line.removeSuffix("\r")
            val match = fence.matchEntire(clean)
            val active = open
            if (match != null) {
                val marks = match.groupValues[1]
                if (active == null) open = marks
                else if (marks.first() == active.first() && marks.length >= active.length && match.groupValues[2].isBlank()) open = null
            }
            if (active == null && clean == MARKER) {
                divided = true
                buffer.joinToString("\n").trim('\n','\r').takeIf { it.isNotBlank() }?.let(parts::add)
                buffer.clear()
            } else if (active == null && streaming && index == lines.lastIndex && clean.isNotEmpty() && MARKER.startsWith(clean)) {
                divided = true
            } else buffer.add(line)
        }
        if (!divided) return listOf(text)
        buffer.joinToString("\n").trim('\n','\r').takeIf { it.isNotBlank() }?.let(parts::add)
        return parts.ifEmpty { listOf("") }
    }
    fun plain(text: String): String = split(text).joinToString("\n\n")
}
