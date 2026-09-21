package com.elementeracoast.app.feature.chat

import com.elementeracoast.app.core.model.MessageRole
import com.elementeracoast.app.core.remote.RemoteHistory

object ChatBranchNavigator {
    fun select(history: RemoteHistory, turnId: String, role: MessageRole, requestedIndex: Int): RemoteHistory {
        val turns = history.turns.map { turn ->
            if (turn.id != turnId) return@map turn
            when (role) {
                MessageRole.User -> {
                    if (turn.user.variants.isEmpty()) return@map turn
                    val index = requestedIndex.coerceIn(0, turn.user.variants.lastIndex)
                    turn.copy(user = turn.user.copy(active = index))
                }
                MessageRole.Assistant -> {
                    val userIndex = turn.user.active.coerceIn(0, (turn.user.variants.size - 1).coerceAtLeast(0))
                    val key = userIndex.toString()
                    val variants = turn.assistant.variantsByUserVariant[key].orEmpty()
                    if (variants.isEmpty()) return@map turn
                    val index = requestedIndex.coerceIn(0, variants.lastIndex)
                    turn.copy(
                        assistant = turn.assistant.copy(
                            activeByUserVariant = turn.assistant.activeByUserVariant + (key to index)
                        )
                    )
                }
            }
        }
        return history.copy(turns = turns)
    }
}
