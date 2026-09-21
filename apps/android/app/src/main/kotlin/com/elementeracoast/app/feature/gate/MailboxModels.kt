package com.elementeracoast.app.feature.gate

import kotlinx.serialization.Serializable

@Serializable
data class MailboxVisitor(
    val visitor_id: String,
    val display_name: String,
    val preferred_name: String? = null,
    val allow_memory: Boolean = true,
    val privacy_level: String = "sealed"
)

@Serializable
data class MailboxVisitorEnvelope(
    val ok: Boolean = true,
    val visitor_id: String,
    val display_name: String,
    val preferred_name: String? = null,
    val allow_memory: Boolean = true,
    val privacy_level: String = "sealed",
    val session: String? = null
) {
    fun visitor() = MailboxVisitor(
        visitor_id = visitor_id,
        display_name = display_name,
        preferred_name = preferred_name,
        allow_memory = allow_memory,
        privacy_level = privacy_level
    )
}

@Serializable
data class MailboxMessage(
    val id: String,
    val visitor_id: String = "",
    val role: String,
    val content: String,
    val created_at: String,
    val updated_at: String = created_at,
    val status: String = "",
    val reply_batch_id: String? = null
)

@Serializable
data class MailboxMessagesEnvelope(
    val ok: Boolean = true,
    val messages: List<MailboxMessage> = emptyList()
)

@Serializable
data class MailboxMessageEnvelope(
    val ok: Boolean = true,
    val message: MailboxMessage
)

@Serializable
data class MailboxStatus(
    val ok: Boolean = true,
    val pending_count: Int = 0,
    val last_model_partner_reply_at: String? = null,
    val last_visitor_message_at: String? = null,
    val queue_status: String = "idle"
)

@Serializable
data class MailboxSeed(
    val name: String = "",
    val life_core: String = "",
    val usage_hint: String = "",
    val avoid_hint: String = ""
)

@Serializable
data class MailboxPocket(
    val id: String = "",
    val visitor_id: String = "",
    val title: String = "",
    val life_core: String = "",
    val content: String = "",
    val usage_hint: String = "",
    val avoid_hint: String = "",
    val source_excerpt: String = "",
    val status: String = "pending",
    val generated_by_model: String? = null,
    val model_nickname: String? = null,
    val created_at: String = "",
    val updated_at: String = ""
)

@Serializable
data class MailboxNotebookEntry(
    val id: String,
    val visitor_id: String = "",
    val title: String = "",
    val life_core: String = "",
    val content: String = "",
    val usage_hint: String = "",
    val avoid_hint: String = "",
    val created_at: String = "",
    val updated_at: String = "",
    val visibility: String = "visitor_visible",
    val status: String = "active",
    val generated_by_model: String? = null,
    val model_nickname: String? = null
)

@Serializable
data class MailboxThoughtSoil(
    val visitor_id: String = "",
    val current_text: String = "",
    val hand_seeds: List<MailboxSeed> = emptyList(),
    val do_not_repeat: String = "",
    val pocket_candidates: List<MailboxPocket> = emptyList(),
    val revision: Int = 1,
    val model_label: String? = null,
    val model_nickname: String? = null,
    val updated_at: String? = null
)

@Serializable
data class MailboxMemory(
    val thought_soil: MailboxThoughtSoil = MailboxThoughtSoil(),
    val pending_pockets: List<MailboxPocket> = emptyList(),
    val entries: List<MailboxNotebookEntry> = emptyList()
)

@Serializable
data class MailboxMemoryEnvelope(
    val ok: Boolean = true,
    val memory: MailboxMemory = MailboxMemory()
)

@Serializable
data class MailboxOkEnvelope(val ok: Boolean = true)

data class MailboxRoomSnapshot(
    val messages: List<MailboxMessage>,
    val status: MailboxStatus,
    val memory: MailboxMemory
)
