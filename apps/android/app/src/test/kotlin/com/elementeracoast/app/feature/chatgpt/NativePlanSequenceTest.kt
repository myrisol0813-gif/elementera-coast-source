package com.elementeracoast.app.feature.chatgpt
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test
import com.elementeracoast.app.core.remote.RemoteChatRequest
import com.elementeracoast.app.core.remote.RemoteChatMessage
import com.elementeracoast.app.core.remote.RemoteNativeChatContext
import com.elementeracoast.app.core.remote.RemoteNativeToolResult
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.flow.toList
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer

class NativePlanSequenceTest {
    @Test fun softBudgetRequiresCompleteActualUsageAndStopsAtLimit(){
        val control=NativePlanSequence(true,0,100)
        assertFalse(control.canRequest(NativeChatUsage()))
        assertTrue(control.canRequest(NativeChatUsage(input=60,output=39,reported=true)))
        assertFalse(control.canRequest(NativeChatUsage(input=60,output=40,reported=true)))
        assertFalse(control.canRequest(NativeChatUsage(input=60,output=400,reported=true)))
        assertFalse(control.canRequest(NativeChatUsage(input=-1,output=1,reported=true)))
        assertFalse(control.canRequest(NativeChatUsage(input=Long.MAX_VALUE,output=Long.MAX_VALUE,reported=true)))
    }
    @Test fun missingOrPartialUsageDoesNotAuthorizeContinuation(){
        assertFalse(nativeSequenceUsageComplete(null))
        assertFalse(nativeSequenceUsageComplete(buildJsonObject{put("input_tokens",3)}))
        assertFalse(nativeSequenceUsageComplete(buildJsonObject{put("input_tokens",3);put("output_tokens",-1)}))
        assertTrue(nativeSequenceUsageComplete(buildJsonObject{put("input_tokens",3);put("output_tokens",0)}))
        assertTrue(nativeContinueArgumentsValid("{}"))
        assertFalse(nativeContinueArgumentsValid("{\"extra\":1}"))
        assertFalse(nativeContinueArgumentsValid("[]"))
    }

    private fun request()=RemoteChatRequest("cid","turn","message","fixture",listOf(RemoteChatMessage("user","hello")),
        localDate="2026-11-27",localDateTime="2026-11-27 02:00")
    private fun completion(items:JsonArray,usage:JsonObject?)="data: "+buildJsonObject{
        put("type","response.completed")
        putJsonObject("response"){put("status","completed");put("output",items);if(usage!=null)put("usage",usage)}
    }.toString()+"\n\n"
    private fun usage(input:Int,output:Int)=buildJsonObject{put("input_tokens",input);put("output_tokens",output)}
    private fun call(id:String,name:String)=buildJsonObject{put("type","function_call");put("call_id",id);put("name",name);put("namespace","coast");put("arguments","{}")}
    private fun message(text:String)=buildJsonObject{put("type","message");putJsonArray("content"){add(buildJsonObject{put("type","output_text");put("text",text)})}}
    private fun fakeClient(responses:List<String>,requests:MutableList<JsonObject>):OkHttpClient=OkHttpClient.Builder().addInterceptor{chain->
        val buffer=Buffer();chain.request().body?.writeTo(buffer)
        requests.add(Json.parseToJsonElement(buffer.readUtf8()).jsonObject)
        val body=responses.getOrNull(requests.lastIndex)?:error("unexpected extra provider request")
        Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("OK")
            .body(body.toResponseBody("text/event-stream".toMediaType())).build()
    }.build()
    @Test fun nativeResponseControlIsNotAnOrdinaryToolAndZeroBudgetStillAllowsIt()=runBlocking{
        val requests=mutableListOf<JsonObject>()
        val client=fakeClient(listOf(
            completion(JsonArray(listOf(call("control","continue_reply"))),usage(10,5)),
            completion(JsonArray(listOf(message("first reply"))),usage(12,3))),requests)
        val inference=ChatGptNativeInference({"fixture-token"},null,client)
        val events=withTimeout(10000){inference.stream("fixture",request(),RemoteNativeChatContext(),
            sequence=NativePlanSequence(true,0,100),localTool={_,_,_->error("ordinary tool called")}).toList()}
        val done=events.filterIsInstance<NativeChatEvent.Completed>().single()
        assertEquals("first reply",done.text)
        assertEquals(0,done.ordinaryToolCalls)
        assertTrue(done.continueRequested)
        assertEquals(30L,done.usage.input+done.usage.output)
        assertEquals(2,requests.size)
        assertTrue(requests[0].getValue("tools").toString().contains("continue_reply"))
        assertFalse(requests[1].containsKey("tools"))
        assertTrue(requests[1].getValue("input").toString().contains("continue_requested"))
        assertTrue(requests.none{it.containsKey("max_output_tokens")})
    }
    @Test fun nativeResponseMissingUsageSavesActualTextWithoutAnotherCall()=runBlocking{
        val requests=mutableListOf<JsonObject>()
        val inference=ChatGptNativeInference({"fixture-token"},null,fakeClient(listOf(
            completion(JsonArray(listOf(message("saved"),call("control","continue_reply"))),null)),requests))
        val events=withTimeout(10000){inference.stream("fixture",request(),RemoteNativeChatContext(),
            sequence=NativePlanSequence(true,4,100),localTool={_,_,_->error("no more calls")}).toList()}
        val done=events.filterIsInstance<NativeChatEvent.Completed>().single()
        assertEquals("saved",done.text)
        assertFalse(done.usage.reported)
        assertFalse(done.continueRequested)
        assertNotNull(done.sequenceStopReason)
        assertEquals(1,requests.size)
    }
    @Test fun cumulativeUsageOverflowDoesNotProduceFalseReceipt(){
        val before=NativeChatUsage(input=1,reported=true)
        val overflow=addNativeSequenceUsage(before,buildJsonObject{put("input_tokens",Long.MAX_VALUE);put("output_tokens",0)})
        assertFalse(overflow.reported)
        assertFalse(nativeSequenceUsageComplete(buildJsonObject{put("input_tokens","3");put("output_tokens",0)}))
    }
}
