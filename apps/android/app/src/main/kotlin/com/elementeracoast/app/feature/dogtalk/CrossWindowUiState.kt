package com.elementeracoast.app.feature.dogtalk

import com.elementeracoast.app.core.model.CrossWindowLimits
import com.elementeracoast.app.core.model.CrossWindowMessageSelection
import com.elementeracoast.app.core.model.CrossWindowMode
import com.elementeracoast.app.core.model.CrossWindowRequest
import com.elementeracoast.app.core.model.CrossWindowSource

private fun messageKey(conversationId: String, messageId: String) = "$conversationId::$messageId"
private fun turnKey(conversationId: String, turnId: String) = "$conversationId::$turnId"

data class CrossWindowUiState(
    val mode: CrossWindowMode = CrossWindowMode.Off,
    val sources: List<CrossWindowSource> = emptyList(),
    val selectedMessages: Set<String> = emptySet(),
    val expandedSources: Set<String> = emptySet(),
    val expandedTurns: Set<String> = emptySet(),
    val limits: CrossWindowLimits? = null,
    val loading: Boolean = false,
    val error: String? = null
) {
    fun request(): CrossWindowRequest = when (mode) {
        CrossWindowMode.Off -> CrossWindowRequest()
        CrossWindowMode.ModelDecides -> CrossWindowRequest(mode = CrossWindowMode.ModelDecides)
        CrossWindowMode.Keyword -> CrossWindowRequest(mode = CrossWindowMode.Keyword)
        CrossWindowMode.Manual -> CrossWindowRequest(
            mode = CrossWindowMode.Manual,
            messages = sources.asSequence()
                .filter { it.readable }
                .flatMap { source ->
                    source.turns.asSequence().flatMap { turn ->
                        turn.messages.asSequence().mapNotNull { message ->
                            if (messageKey(source.conversationId, message.messageId) !in selectedMessages) null
                            else CrossWindowMessageSelection(source.conversationId, message.messageId)
                        }
                    }
                }
                .toList()
        )
    }

    fun isMessageSelected(conversationId: String, messageId: String): Boolean =
        messageKey(conversationId, messageId) in selectedMessages

    fun toggleMessage(conversationId: String, messageId: String): CrossWindowUiState {
        val key = messageKey(conversationId, messageId)
        return copy(selectedMessages = if (key in selectedMessages) selectedMessages - key else selectedMessages + key)
    }

    fun toggleSource(conversationId: String): CrossWindowUiState =
        copy(expandedSources = if (conversationId in expandedSources) expandedSources - conversationId else expandedSources + conversationId)

    fun isSourceExpanded(conversationId: String): Boolean = conversationId in expandedSources

    fun toggleTurn(conversationId: String, turnId: String): CrossWindowUiState {
        val key = turnKey(conversationId, turnId)
        return copy(expandedTurns = if (key in expandedTurns) expandedTurns - key else expandedTurns + key)
    }

    fun isTurnExpanded(conversationId: String, turnId: String): Boolean =
        turnKey(conversationId, turnId) in expandedTurns
}

fun CrossWindowUiState.withSnapshot(
    description: String,
    limits: CrossWindowLimits,
    sources: List<CrossWindowSource>
): CrossWindowUiState {
    @Suppress("UNUSED_VARIABLE")
    val ignoredDescription = description
    val validMessages = sources.flatMap { source ->
        source.turns.flatMap { turn ->
            turn.messages.map { message -> messageKey(source.conversationId, message.messageId) }
        }
    }.toSet()
    val validTurns = sources.flatMap { source ->
        source.turns.map { turn -> turnKey(source.conversationId, turn.turnId) }
    }.toSet()
    val validSources = sources.map { it.conversationId }.toSet()
    return copy(
        sources = sources,
        selectedMessages = selectedMessages intersect validMessages,
        expandedSources = expandedSources intersect validSources,
        expandedTurns = expandedTurns intersect validTurns,
        limits = limits,
        loading = false,
        error = null
    )
}
