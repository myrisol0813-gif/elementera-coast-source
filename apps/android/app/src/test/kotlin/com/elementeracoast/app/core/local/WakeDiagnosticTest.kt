package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.network.CoastApiException
import com.elementeracoast.app.core.network.CoastApiErrorKind
import com.elementeracoast.app.feature.chatgpt.NativeDreamPlanFailure
import java.net.SocketTimeoutException
import org.junit.Assert.*
import org.junit.Test

class WakeDiagnosticTest {
    @Test fun diagnosticsDoNotIncludeExceptionMessagesOrCredentials(){
        val failure=CoastApiException(CoastApiErrorKind.Network,"untrusted_code","secret message",cause=SocketTimeoutException("secret url"))
        val entry=WakeDiagnostic.entry("claim_response_unconfirmed",100,WakeDiagnostic.reason(failure),http=WakeDiagnostic.http(failure))
        assertTrue(entry.toString().contains("coast_timeout"))
        assertFalse(entry.toString().contains("secret"))
        assertFalse(entry.toString().contains("untrusted_code"))
        assertEquals("unknown",WakeDiagnostic.code("some secret token"))
    }
    @Test fun safeHttpAndPhaseCanBeRecorded(){
        val failure=NativeDreamPlanFailure("plan_usage_limit",429)
        val entry=WakeDiagnostic.entry("provider_wait",100,WakeDiagnostic.reason(failure),0,"fixture",WakeDiagnostic.http(failure))
        assertTrue(entry.toString().contains("plan_usage_limit"))
        assertTrue(entry.toString().contains("429"))
        assertFalse(WakeDiagnostic.entry("provider_wait",100,http=999).toString().contains("http_status"))
    }
}
