package com.elementeracoast.app.core.network

import com.elementeracoast.app.core.remote.RemoteHistory
import com.elementeracoast.app.core.remote.RemoteRealityContext
import com.elementeracoast.app.core.remote.RemoteVariant
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerialName
import kotlinx.serialization.json.*

@Serializable
data class RemoteReplyRunBudget(val maxMessages:Int,val toolBudget:Int,val tokenBudget:Int){
    init { require(maxMessages in 1..20 && toolBudget in 0..128 && tokenBudget in 1..1000000) }
}

@Serializable
data class RemoteReplyRunRequest(
    @SerialName("conversation_id") val conversationId:String,
    @SerialName("source_turn_id") val turnId:String,
    @SerialName("user_variant_id") val userVariantId:String,
    @SerialName("sequence_id") val sequenceId:String,
    val model:String,
    val budget:RemoteReplyRunBudget,
    @SerialName("local_date") val localDate:String,
    @SerialName("local_datetime") val localDateTime:String,
    val settings:JsonObject,
    @SerialName("reality_context") val realityContext:RemoteRealityContext?=null
)

sealed interface ReplyRunEvent {
    data class Start(val maxMessages:Int):ReplyRunEvent
    data class Begin(val messageId:String,val index:Int):ReplyRunEvent
    data class Delta(val messageId:String,val content:String):ReplyRunEvent
    data class Committed(val messageId:String,val index:Int,val history:RemoteHistory,val variant:RemoteVariant):ReplyRunEvent
    data class End(val status:String,val saved:Int,val message:String?):ReplyRunEvent
}

/** Stateful decoder for a single server-owned group. No local placeholder is
 * authoritative and no event from another group may advance this run. */
internal class ReplyRunWire(private val request:RemoteReplyRunRequest,private val json:Json){
    private val id=Regex("[A-Za-z0-9_.:-]{1,160}")
    private var max=0
    private var pending:String?=null
    private val saved=mutableListOf<RemoteVariant>()
    private var ended=false
    private fun invalid():Nothing=throw CoastApiException(CoastApiErrorKind.Stream,"invalid_reply_sequence_event","连续回复事件身份或次序无效；不会自动重试。")
    fun accept(event:CoastSseEvent):ReplyRunEvent{
        if(ended)invalid()
        val obj=event.data as? JsonObject?:invalid()
        fun str(key:String)=(obj[key] as? JsonPrimitive)?.takeIf{it.isString}?.contentOrNull?:invalid()
        fun number(key:String)=(obj[key] as? JsonPrimitive)?.takeUnless{it.isString}?.intOrNull?:invalid()
        if(event.event=="reply_group_error")throw CoastApiException(CoastApiErrorKind.Stream,
            str("type"),str("message"))
        if(event.event=="reply_group_start"){
            if(max!=0||str("sequence_id")!=request.sequenceId)invalid()
            max=number("max_messages")
            if(max !in 1..request.budget.maxMessages)invalid()
            return ReplyRunEvent.Start(max)
        }
        if(max==0)invalid()
        return when(event.event){
            "reply_begin"->{
                val mid=str("message_id");val index=number("index")
                if(pending!=null||index!=saved.size||index>=max||!id.matches(mid)||saved.any{it.id==mid})invalid()
                pending=mid;ReplyRunEvent.Begin(mid,index)
            }
            "reply_delta"->{
                val mid=str("message_id")
                if(mid!=pending)invalid()
                ReplyRunEvent.Delta(mid,str("content"))
            }
            "reply_committed"->{
                val mid=str("message_id");val index=number("index")
                if(mid!=pending||index!=saved.size)invalid()
                val history=try{json.decodeFromJsonElement(RemoteHistory.serializer(),obj["history"]?:invalid())}catch(_:Exception){invalid()}
                if(history.conversationId!=null&&history.conversationId!=request.conversationId)invalid()
                val turn=history.turns.singleOrNull{it.id==request.turnId}?:invalid()
                val key=turn.user.active.toString()
                if(turn.user.variants.getOrNull(turn.user.active)?.id!=request.userVariantId)invalid()
                val list=turn.assistant.variantsByUserVariant[key].orEmpty()
                val group=list.filter{it.replySequence?.id==request.sequenceId}
                if(group.size!=index+1||group.withIndex().any{(i,v)->v.replySequence?.index!=i})invalid()
                if(group.last().id!=mid||group.last().content.isBlank()||group.dropLast(1)!=saved||
                    list.getOrNull(turn.assistant.activeByUserVariant[key]?:-1)?.id!=mid)invalid()
                val variant=group.last()
                saved.add(variant);pending=null
                ReplyRunEvent.Committed(mid,index,history,variant)
            }
            "reply_group_end"->{
                val status=str("status");val count=number("saved")
                if(count!=saved.size||status !in setOf("completed","limit_reached","permission_or_budget","reservation_lost","failed","cancelled","interrupted"))invalid()
                if(pending!=null&&status in setOf("completed","limit_reached"))invalid()
                ended=true
                ReplyRunEvent.End(status,count,(obj["message"] as? JsonPrimitive)?.contentOrNull)
            }
            else->invalid()
        }
    }
    fun finish(){if(!ended)throw CoastApiException(CoastApiErrorKind.Stream,"reply_group_incomplete","连续回复组未确认结束；请刷新原窗口，不会自动重试。")}
}
