package com.elementeracoast.app.feature.chat

import com.elementeracoast.app.core.remote.RemoteAssistantBranches
import com.elementeracoast.app.core.remote.RemoteHistory
import com.elementeracoast.app.core.remote.RemoteUserBranch
import com.elementeracoast.app.core.remote.RemoteVariant
import java.time.Instant
import java.util.UUID

/**
 * Pure canonical history mutations shared by Native message actions.
 * This object changes only the v4 conversation tree; persistence remains the
 * repository/ViewModel responsibility.
 */
object ChatHistoryMutations {
    private const val MAX_VARIANTS = 20

    fun editActiveUser(history: RemoteHistory, turnId: String, content: String): RemoteHistory {
        val clean = content.trim()
        if (clean.isBlank()) return history
        val now = Instant.now().toString()
        val turns = history.turns.map { turn ->
            if (turn.id != turnId) return@map turn

            val appended = turn.user.variants + RemoteVariant(
                id = "user_variant_${UUID.randomUUID()}",
                content = clean,
                createdAt = now,
                displayAuthor = "屋主"
            )
            val dropCount = (appended.size - MAX_VARIANTS).coerceAtLeast(0)
            val keptUsers = appended.drop(dropCount)
            val branches = linkedMapOf<String, List<RemoteVariant>>()
            val active = linkedMapOf<String, Int>()

            keptUsers.indices.forEach { newIndex ->
                val oldIndex = newIndex + dropCount
                val key = newIndex.toString()
                if (oldIndex < turn.user.variants.size) {
                    val oldKey = oldIndex.toString()
                    val assistants = turn.assistant.variantsByUserVariant[oldKey].orEmpty()
                    branches[key] = assistants
                    active[key] = (turn.assistant.activeByUserVariant[oldKey] ?: 0)
                        .coerceIn(0, (assistants.size - 1).coerceAtLeast(0))
                } else {
                    branches[key] = emptyList()
                    active[key] = 0
                }
            }

            turn.copy(
                user = RemoteUserBranch(active = keptUsers.lastIndex, variants = keptUsers),
                assistant = RemoteAssistantBranches(
                    activeByUserVariant = active,
                    variantsByUserVariant = branches
                )
            )
        }
        return history.copy(version = 4, updatedAt = now, turns = turns)
    }

    fun deleteActiveUser(history: RemoteHistory, turnId: String): RemoteHistory {
        val turnIndex = history.turns.indexOfFirst { it.id == turnId }
        if (turnIndex < 0) return history
        val turn = history.turns[turnIndex]
        if (turn.user.variants.isEmpty()) return history

        val removedIndex = turn.user.active.coerceIn(0, turn.user.variants.lastIndex)
        val remainingUsers = turn.user.variants.toMutableList().also { it.removeAt(removedIndex) }
        val turns = history.turns.toMutableList()
        val now = Instant.now().toString()

        if (remainingUsers.isEmpty()) {
            turns.removeAt(turnIndex)
            return history.copy(version = 4, updatedAt = now, turns = turns)
        }

        val branches = linkedMapOf<String, List<RemoteVariant>>()
        val active = linkedMapOf<String, Int>()
        remainingUsers.indices.forEach { newIndex ->
            val oldIndex = if (newIndex >= removedIndex) newIndex + 1 else newIndex
            val oldKey = oldIndex.toString()
            val key = newIndex.toString()
            val assistants = turn.assistant.variantsByUserVariant[oldKey].orEmpty()
            branches[key] = assistants
            active[key] = (turn.assistant.activeByUserVariant[oldKey] ?: 0)
                .coerceIn(0, (assistants.size - 1).coerceAtLeast(0))
        }

        turns[turnIndex] = turn.copy(
            user = RemoteUserBranch(
                active = removedIndex.coerceAtMost(remainingUsers.lastIndex),
                variants = remainingUsers
            ),
            assistant = RemoteAssistantBranches(
                activeByUserVariant = active,
                variantsByUserVariant = branches
            )
        )
        return history.copy(version = 4, updatedAt = now, turns = turns)
    }

    fun deleteActiveAssistant(history: RemoteHistory, turnId: String): RemoteHistory =
        patchAssistantBranch(history, turnId) { assistants, activeIndex ->
            if (assistants.isEmpty()) return@patchAssistantBranch assistants to 0
            val remaining = assistants.toMutableList().also { it.removeAt(activeIndex) }
            remaining to activeIndex.coerceAtMost((remaining.size - 1).coerceAtLeast(0))
        }

    fun toggleActiveAssistantLike(history: RemoteHistory, turnId: String): RemoteHistory =
        patchActiveAssistant(history, turnId) { it.copy(liked = !it.liked) }

    fun toggleActiveAssistantFavorite(history: RemoteHistory, turnId: String): RemoteHistory =
        patchActiveAssistant(history, turnId) { it.copy(favorite = !it.favorite) }

    private fun patchActiveAssistant(
        history: RemoteHistory,
        turnId: String,
        transform: (RemoteVariant) -> RemoteVariant
    ): RemoteHistory = patchAssistantBranch(history, turnId) { assistants, activeIndex ->
        if (assistants.isEmpty()) return@patchAssistantBranch assistants to 0
        assistants.mapIndexed { index, variant ->
            if (index == activeIndex) transform(variant) else variant
        } to activeIndex
    }

    private fun patchAssistantBranch(
        history: RemoteHistory,
        turnId: String,
        transform: (List<RemoteVariant>, Int) -> Pair<List<RemoteVariant>, Int>
    ): RemoteHistory {
        val now = Instant.now().toString()
        val turns = history.turns.map { turn ->
            if (turn.id != turnId || turn.user.variants.isEmpty()) return@map turn
            val userIndex = turn.user.active.coerceIn(0, turn.user.variants.lastIndex)
            val key = userIndex.toString()
            val assistants = turn.assistant.variantsByUserVariant[key].orEmpty()
            val activeIndex = (turn.assistant.activeByUserVariant[key] ?: 0)
                .coerceIn(0, (assistants.size - 1).coerceAtLeast(0))
            val (updated, nextActive) = transform(assistants, activeIndex)
            turn.copy(
                assistant = turn.assistant.copy(
                    activeByUserVariant = turn.assistant.activeByUserVariant + (
                        key to nextActive.coerceIn(0, (updated.size - 1).coerceAtLeast(0))
                    ),
                    variantsByUserVariant = turn.assistant.variantsByUserVariant + (key to updated)
                )
            )
        }
        return history.copy(version = 4, updatedAt = now, turns = turns)
    }
}
