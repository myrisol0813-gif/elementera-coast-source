package com.elementeracoast.app.core.tour

import com.elementeracoast.app.core.auth.MemoryAuthStore
import com.elementeracoast.app.core.network.CoastApiConfig
import com.elementeracoast.app.core.network.CoastHttpClient
import java.io.IOException
import okhttp3.Request
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class SourceVisitGateTest {
    @Test fun onlyPublicVisitCodeOpensAndLeavingDisablesGate() {
        SourceVisitGate.leave()
        try {
            assertTrue(SourceVisitGate.enabled)
            assertFalse(SourceVisitGate.open("12345"))
            assertFalse(SourceVisitGate.isActive)
            assertTrue(SourceVisitGate.open("123456"))
            assertTrue(SourceVisitGate.isActive)
        } finally {
            SourceVisitGate.leave()
        }
        assertFalse(SourceVisitGate.shouldBlockRemoteRequest())
    }

    @Test fun visitorModeNeverSendsHTTPOrCookiesToServer() {
        val server = MockWebServer()
        server.start()
        SourceVisitGate.leave()
        try {
            assertTrue(SourceVisitGate.open(SourceVisitGate.PUBLIC_PASSCODE))
            val config = CoastApiConfig(server.url("/").toString())
            val client = CoastHttpClient(config, MemoryAuthStore()).client
            try {
                client.newCall(Request.Builder().url(server.url("/api/session")).build()).execute().use {}
                fail("Public visitor requests must be denied before network I/O")
            } catch (expected: IOException) {
                assertTrue(expected.message.orEmpty().contains("参观模式"))
            }
            assertTrue("The server must receive zero requests", server.requestCount == 0)
        } finally {
            SourceVisitGate.leave()
            server.shutdown()
        }
    }
}
