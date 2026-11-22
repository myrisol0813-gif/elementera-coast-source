package com.elementeracoast.app.core.model

import com.elementeracoast.app.core.remote.RemoteHistory
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive

/** Exact search provenance. A result may be an old user or assistant variant. */
data class ChatSearchHit(
    val kind: String,
    val conversationId: String,
    val conversationTitle: String,
    val turnId: String,
    val messageId: String,
    val role: MessageRole?,
    val snippet: String
) {
    companion object {
        fun fromJson(value: JsonObject): ChatSearchHit? {
            fun field(name: String): String =
                value[name]?.runCatching { jsonPrimitive.contentOrNull }?.getOrNull().orEmpty()
            val kind = field("kind")
            val conversation = field("conversation_id")
            if (kind !in setOf("conversation", "message") || conversation.isBlank()) return null
            val role = when (field("role")) {
                "user" -> MessageRole.User
                "assistant" -> MessageRole.Assistant
                else -> null
            }
            val turn = field("turn_id")
            val message = field("message_id")
            if (kind == "message" && (turn.isBlank() || message.isBlank() || role == null)) return null
            return ChatSearchHit(kind, conversation, field("conversation_title"),
                turn, message, role, field("snippet"))
        }
    }
}

data class ChatSearchFocus(
    val conversationId: String,
    val messageId: String,
    val requestId: Long
)

/**
 * Read-only preview of the exact variant found by search. Does not mutate
 * historical data or persist a branch choice to the server.
 */
fun previewSearchVariant(history: RemoteHistory, hit: ChatSearchHit): RemoteHistory? {
    if (hit.kind != "message" || hit.role == null) return history
    var found = false
    val turns = history.turns.map { turn ->
        if (turn.id != hit.turnId) return@map turn
        when (hit.role) {
            MessageRole.User -> {
                val index = turn.user.variants.indexOfFirst { it.id == hit.messageId && !it.hidden }
                if (index < 0) return@map turn
                found = true
                turn.copy(user = turn.user.copy(active = index))
            }
            MessageRole.Assistant -> {
                val matched = turn.assistant.variantsByUserVariant.entries.firstNotNullOfOrNull { (key, variants) ->
                    val index = variants.indexOfFirst { it.id == hit.messageId }
                    val userIndex = key.toIntOrNull()
                    if (index >= 0 && userIndex != null &&
                        userIndex in turn.user.variants.indices &&
                        !turn.user.variants[userIndex].hidden) userIndex to index else null
                } ?: return@map turn
                found = true
                val (userIndex, assistantIndex) = matched
                turn.copy(
                    user = turn.user.copy(active = userIndex),
                    assistant = turn.assistant.copy(activeByUserVariant =
                        turn.assistant.activeByUserVariant + (userIndex.toString() to assistantIndex))
                )
            }
        }
    }
    return if (found) history.copy(turns = turns) else null
}
