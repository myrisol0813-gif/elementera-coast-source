package com.elementeracoast.app.feature.chat

import com.elementeracoast.app.core.model.ChatAttachment
import com.elementeracoast.app.core.model.ChatMessage
import com.elementeracoast.app.core.model.FurnitureItem
import com.elementeracoast.app.core.model.FurnitureRun
import com.elementeracoast.app.core.model.MessageRole
import com.elementeracoast.app.core.remote.RemoteAssistantBranches
import com.elementeracoast.app.core.remote.RemoteAttachment
import com.elementeracoast.app.core.remote.RemoteChatMessage
import com.elementeracoast.app.core.remote.RemoteDeskSlip
import com.elementeracoast.app.core.remote.RemoteFurnitureRun
import com.elementeracoast.app.core.remote.RemoteHistory
import com.elementeracoast.app.core.remote.RemoteTurn
import com.elementeracoast.app.core.remote.RemoteUserBranch
import com.elementeracoast.app.core.remote.RemoteVariant
import java.security.MessageDigest
import java.time.Instant
import java.util.UUID

object ChatSyncMapper {
    data class AppendedUser(val history: RemoteHistory, val turnId: String)

    fun appendUser(history: RemoteHistory, text: String, attachments: List<ChatAttachment> = emptyList()): AppendedUser {
        val now = Instant.now().toString()
        val turnId = "turn_${UUID.randomUUID()}"
        val variant = RemoteVariant(
            id = "user_variant_${UUID.randomUUID()}",
            content = text,
            createdAt = now,
            attachments = attachments.map(::toRemoteAttachment),
            displayAuthor = "屋主"
        )
        val turn = RemoteTurn(
            id = turnId,
            user = RemoteUserBranch(active = 0, variants = listOf(variant)),
            assistant = RemoteAssistantBranches(
                activeByUserVariant = mapOf("0" to 0),
                variantsByUserVariant = mapOf("0" to emptyList())
            )
        )
        return AppendedUser(
            history.copy(version = 4, updatedAt = now, turns = history.turns + turn),
            turnId
        )
    }

    fun clearUserFailure(history: RemoteHistory, turnId: String): RemoteHistory = patchActiveUser(history, turnId) {
        it.copy(errorDetail = null)
    }

    fun markUserFailure(history: RemoteHistory, turnId: String, errorDetail: String): RemoteHistory = patchActiveUser(history, turnId) {
        it.copy(errorDetail = errorDetail.take(12000))
    }

    private fun patchActiveUser(
        history: RemoteHistory,
        turnId: String,
        transform: (RemoteVariant) -> RemoteVariant
    ): RemoteHistory {
        val turns = history.turns.map { turn ->
            if (turn.id != turnId || turn.user.variants.isEmpty()) return@map turn
            val active = turn.user.active.coerceIn(0, turn.user.variants.lastIndex)
            val variants = turn.user.variants.mapIndexed { index, variant ->
                if (index == active) transform(variant) else variant
            }
            turn.copy(user = turn.user.copy(variants = variants))
        }
        return history.copy(updatedAt = Instant.now().toString(), turns = turns)
    }

    /** Stable for one pending generation; changes when the branch already contains another assistant variant. */
    fun nextAssistantVariantId(history: RemoteHistory, turnId: String): String {
        val turn = history.turns.firstOrNull { it.id == turnId }
        val userIndex = turn?.user?.active?.coerceIn(0, (turn.user.variants.size - 1).coerceAtLeast(0)) ?: 0
        val existingCount = turn?.assistant?.variantsByUserVariant?.get(userIndex.toString()).orEmpty().size
        val digest = MessageDigest.getInstance("SHA-256")
            .digest("$turnId:$userIndex:$existingCount".toByteArray())
            .take(12)
            .joinToString("") { "%02x".format(it) }
        return "assistant_variant_native_$digest"
    }

    fun appendAssistant(
        history: RemoteHistory,
        turnId: String,
        content: String,
        modelId: String,
        finishReason: String,
        errorDetail: String = "",
        furnitureRuns: List<RemoteFurnitureRun> = emptyList(),
        deskSlip: RemoteDeskSlip? = null,
        assistantVariantId: String = nextAssistantVariantId(history, turnId)
    ): RemoteHistory {
        val turns = history.turns.map { turn ->
            if (turn.id != turnId) return@map turn
            val userIndex = turn.user.active.coerceIn(0, (turn.user.variants.size - 1).coerceAtLeast(0))
            val key = userIndex.toString()
            val list = turn.assistant.variantsByUserVariant[key].orEmpty() + RemoteVariant(
                id = assistantVariantId,
                content = content,
                createdAt = Instant.now().toString(),
                modelId = modelId,
                finishReason = finishReason,
                generationSource = "chat",
                errorDetail = errorDetail.ifBlank { null },
                furnitureRuns = furnitureRuns,
                deskSlip = deskSlip
            )
            turn.copy(
                assistant = turn.assistant.copy(
                    activeByUserVariant = turn.assistant.activeByUserVariant + (key to list.lastIndex),
                    variantsByUserVariant = turn.assistant.variantsByUserVariant + (key to list)
                )
            )
        }
        return history.copy(updatedAt = Instant.now().toString(), turns = turns)
    }

    fun contextMessages(history: RemoteHistory, targetTurnId: String, recentTurns: Int): List<RemoteChatMessage> {
        val messages = buildList {
            for (turn in history.turns) {
                val userIndex = turn.user.active.coerceIn(0, (turn.user.variants.size - 1).coerceAtLeast(0))
                val user = turn.user.variants.getOrNull(userIndex)
                if (user != null && !user.hidden && (user.content.isNotBlank() || user.attachments.isNotEmpty())) {
                    val body = user.content.ifBlank { "请查看本轮附件。" }
                    add(RemoteChatMessage(
                        "user",
                        if (user.messageSource == "official_mcp") "[来源：官端 ChatGPT / official_mcp]\n$body" else body
                    ))
                }
                if (turn.id == targetTurnId) break

                val key = userIndex.toString()
                val assistants = turn.assistant.variantsByUserVariant[key].orEmpty()
                val assistantIndex = (turn.assistant.activeByUserVariant[key] ?: 0)
                    .coerceIn(0, (assistants.size - 1).coerceAtLeast(0))
                val assistant = assistants.getOrNull(assistantIndex)
                if (assistant != null && assistant.content.isNotBlank()) {
                    add(RemoteChatMessage("assistant", assistant.content))
                }
            }
        }
        val requestedMessages = recentTurns.coerceAtLeast(1).toLong() * 2L
        val recent = if (requestedMessages >= messages.size.toLong()) {
            messages.toMutableList()
        } else {
            messages.takeLast(requestedMessages.toInt()).toMutableList()
        }
        while (recent.firstOrNull()?.role == "assistant") recent.removeAt(0)
        return recent
    }

    fun toUi(history: RemoteHistory): List<ChatMessage> = buildList {
        history.turns.forEach { turn ->
            val userVariants = turn.user.variants
            val userIndex = turn.user.active.coerceIn(0, (userVariants.size - 1).coerceAtLeast(0))
            val user = userVariants.getOrNull(userIndex)
            if (user != null && !user.hidden) {
                add(
                    ChatMessage(
                        id = stableLong("user:${turn.id}"),
                        role = MessageRole.User,
                        text = user.content,
                        turnId = turn.id,
                        remoteVariantId = user.id,
                        messageSource = user.messageSource,
                        displayAuthor = user.displayAuthor,
                        errorDetail = user.errorDetail,
                        variantIndex = userIndex,
                        variantCount = userVariants.size.coerceAtLeast(1),
                        variants = userVariants.map { it.content },
                        createdAtLabel = user.createdAt,
                        attachments = user.attachments.map(::toChatAttachment)
                    )
                )
            }
            val key = userIndex.toString()
            val assistants = turn.assistant.variantsByUserVariant[key].orEmpty()
            val assistantIndex = (turn.assistant.activeByUserVariant[key] ?: 0)
                .coerceIn(0, (assistants.size - 1).coerceAtLeast(0))
            val assistant = assistants.getOrNull(assistantIndex)
            if (assistant != null) {
                add(
                    ChatMessage(
                        id = stableLong("assistant:${turn.id}:$key"),
                        role = MessageRole.Assistant,
                        text = assistant.content,
                        turnId = turn.id,
                        remoteVariantId = assistant.id,
                        modelId = assistant.modelId,
                        generationSource = assistant.generationSource,
                        messageSource = assistant.messageSource,
                        displayAuthor = assistant.displayAuthor,
                        liked = assistant.liked,
                        favorite = assistant.favorite,
                        errorDetail = assistant.errorDetail,
                        variantIndex = assistantIndex,
                        variantCount = assistants.size.coerceAtLeast(1),
                        variants = assistants.map { it.content },
                        createdAtLabel = assistant.createdAt,
                        furnitureRuns = assistant.furnitureRuns.map(::toFurnitureRun),
                        deskReceipt = assistant.deskSlip?.let(TurnDeskMapper::toUi)
                    )
                )
            }
        }
    }

    fun activeAttachmentIds(history: RemoteHistory, turnId: String): List<String> {
        val turn = history.turns.firstOrNull { it.id == turnId } ?: return emptyList()
        val userIndex = turn.user.active.coerceIn(0, (turn.user.variants.size - 1).coerceAtLeast(0))
        return turn.user.variants.getOrNull(userIndex)?.attachments.orEmpty().map { it.id }.filter(String::isNotBlank)
    }

    private fun toRemoteAttachment(value: ChatAttachment): RemoteAttachment = RemoteAttachment(
        id = value.id,
        type = value.type,
        name = value.name,
        mime = value.mime,
        size = value.size,
        storageKey = value.storageKey,
        createdAt = value.createdAt
    )

    private fun toChatAttachment(value: RemoteAttachment): ChatAttachment = ChatAttachment(
        id = value.id,
        type = value.type,
        name = value.name,
        mime = value.mime,
        size = value.size,
        storageKey = value.storageKey,
        createdAt = value.createdAt
    )

    fun streamingAssistant(turnId: String, modelId: String, partialContent: String): ChatMessage = ChatMessage(
        id = streamingMessageId(turnId),
        role = MessageRole.Assistant,
        text = partialContent,
        turnId = turnId,
        modelId = modelId,
        generationSource = "chat"
    )

    fun streamingMessageId(turnId: String): Long = stableLong("stream:$turnId")

    private fun toFurnitureRun(value: RemoteFurnitureRun): FurnitureRun = FurnitureRun(
        actionId = value.id,
        actionKey = value.toolKey,
        label = value.label,
        success = value.status != "error",
        count = value.count,
        items = value.items.map { FurnitureItem(it.title, it.kind) },
        extraCount = value.extraCount,
        errorType = value.errorType.orEmpty()
    )

    private fun stableLong(value: String): Long {
        val bytes = MessageDigest.getInstance("SHA-256").digest(value.toByteArray())
        var result = 0L
        repeat(8) { index -> result = (result shl 8) or (bytes[index].toLong() and 0xffL) }
        return result and Long.MAX_VALUE
    }
}
