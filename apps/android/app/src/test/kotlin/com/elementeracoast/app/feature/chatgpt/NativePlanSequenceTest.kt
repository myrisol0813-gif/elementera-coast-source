package com.elementeracoast.app.feature.chatgpt
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

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
}
