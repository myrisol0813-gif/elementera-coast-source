package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.network.CoastApiException
import com.elementeracoast.app.feature.chatgpt.NativeDreamPlanFailure
import java.io.IOException
import java.io.InterruptedIOException
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.*

/** Operational diagnostics only. Never persist exception messages, request bodies,
 * credentials, tool arguments, or raw provider responses. */
internal object WakeDiagnostic {
    fun code(value:String)=value.takeIf{it.matches(Regex("[A-Za-z0-9_-]{1,100}"))}?:"unknown"
    fun reason(error:Throwable):String=when(error){
        is NativeDreamPlanFailure->code(error.reason)
        is CoastApiException->if(error.cause is InterruptedIOException)"coast_timeout" else "coast_"+error.kind.name.lowercase()
        is InterruptedIOException->"request_timeout"
        is IOException->"network_error"
        is SerializationException->"response_decode_error"
        is IllegalArgumentException->"invalid_protocol_data"
        is IllegalStateException->"invalid_execution_state"
        else->"execution_failed"
    }
    fun http(error:Throwable):Int?=when(error){
        is NativeDreamPlanFailure->error.httpStatus
        is CoastApiException->error.status
        else->null
    }?.takeIf{it in 100..599}
    fun entry(phase:String,at:Long,reason:String?=null,step:Int?=null,claim:String?=null,http:Int?=null)=buildJsonObject{
        put("phase",code(phase));put("at",at)
        reason?.let{put("reason",code(it))}
        step?.takeIf{it>=0}?.let{put("step",it)}
        claim?.takeIf{it.matches(Regex("[A-Za-z0-9_.:-]{1,160}"))}?.let{put("claim_id",it)}
        http?.takeIf{it in 100..599}?.let{put("http_status",it)}
    }
}
