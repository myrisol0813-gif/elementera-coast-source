package com.elementeracoast.app.core.remote

import kotlinx.serialization.Serializable
import kotlinx.serialization.SerialName
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonElement

@Serializable
data class DreamQuietHours(val start:String,val end:String)

@Serializable
data class DreamExecutionConfig(
    val tokenBudget:Int=8000,val outputLimit:Int=1000,val toolBudget:Int=4,val readTurns:Int=10,
    val extraPerDay:Int=0,val invitation:String="",
    val includeTime:Boolean=false,val includePrevious:Boolean=false,val includeReplies:Boolean=false,
    val readHistory:Boolean=false,val writeNote:Boolean=false
)

@Serializable
data class DreamConfig(
    val timeZone:String="UTC",val dailyTime:String="09:00",val quietHours:DreamQuietHours?=null,
    val allowExtra:Boolean=false,val execution:DreamExecutionConfig?=null
)

@Serializable
data class DreamSettings(
    val revision:String?=null,val enabled:Boolean=false,val config:DreamConfig?=null,
    val modelId:String?=null,val armedAt:Long?=null,val extraAt:Long?=null,val running:Boolean=false,val extraId:String?=null
)

@Serializable
data class DreamSettingsResponse(
    val ok:Boolean=false,val settings:DreamSettings=DreamSettings(),
    val executionAvailable:Boolean=false,val schedulerConfigured:Boolean=false
)

@Serializable
data class DreamSettingsRequest(
    @SerialName("conversation_id") val conversationId:String,
    val revision:String?=null,val action:String,val config:DreamConfig?=null,
    val modelId:String?=null,val confirmExecution:Boolean=false
)

@Serializable
data class DreamReply(
    val id:String,val body:String,@SerialName("created_at") val createdAt:Long
)

@Serializable
data class DreamNote(
    @SerialName("claim_id") val claimId:String,@SerialName("model_id") val modelId:String,
    val body:String,@SerialName("created_at") val createdAt:Long,val replies:List<DreamReply> = emptyList()
)
@Serializable
data class DreamActivity(
    @SerialName("claim_id") val claimId:String,@SerialName("model_id") val modelId:String,
    val kind:String,val status:String,@SerialName("started_at") val startedAt:Long,
    val result:JsonElement=JsonNull,val tools:List<JsonElement> = emptyList(),val steps:List<JsonElement> = emptyList()
)
@Serializable
data class DreamNotesResponse(val ok:Boolean=false,val items:List<DreamNote> = emptyList(),val nextOffset:Int?=null)
@Serializable
data class DreamActivityResponse(val ok:Boolean=false,val items:List<DreamActivity> = emptyList(),val nextOffset:Int?=null)
