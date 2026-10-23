package com.elementeracoast.app.core.remote

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray

@Serializable
data class RemoteNativeChatContext(
    val ok: Boolean = false,
    @SerialName("model_messages") val modelMessages: JsonArray = JsonArray(emptyList()),
    val tools: JsonArray = JsonArray(emptyList()),
    @SerialName("desk_slip") val deskSlip: RemoteDeskSlip = RemoteDeskSlip()
)

@Serializable
data class RemoteNativeToolResult(
    val ok: Boolean = false,
    val output: String = "",
    @SerialName("furniture_runs") val furnitureRuns: List<RemoteFurnitureRun> = emptyList(),
    @SerialName("desk_slip") val deskSlip: RemoteDeskSlip = RemoteDeskSlip()
)
