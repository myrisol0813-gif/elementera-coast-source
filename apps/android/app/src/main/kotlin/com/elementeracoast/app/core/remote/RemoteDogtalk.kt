package com.elementeracoast.app.core.remote

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class RemoteDogtalk(
    val id: String? = null,
    @SerialName("room_scope") val roomScope: String = "conversation",
    @SerialName("conversation_id") val conversationId: String? = null,
    val body: String = "",
    @SerialName("true_core") val trueCore: String = "",
    val weather: String = "",
    @SerialName("read_mode") val readMode: String = "keep_private",
    val status: String = "saved"
)

@Serializable
data class RemoteDogtalkResponse(
    val ok: Boolean = false,
    val dogtalk: RemoteDogtalk = RemoteDogtalk()
)

@Serializable
data class RemoteDogtalkSaveRequest(
    val id: String? = null,
    @SerialName("room_scope") val roomScope: String,
    @SerialName("conversation_id") val conversationId: String? = null,
    val body: String,
    @SerialName("true_core") val trueCore: String = "",
    val weather: String = "",
    @SerialName("read_mode") val readMode: String = "keep_private"
)
