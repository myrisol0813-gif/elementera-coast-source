package com.elementeracoast.app.feature.chatgpt

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class ChatGptOAuthProtocolTest {
    @Test fun pkceS256FollowsRfc7636Example() {
        val verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
        assertEquals(
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
            ChatGptOAuthProtocol.challenge(verifier)
        )
    }

    @Test fun freshLoginUsesDynamicRegistrationAndLocalCallback() {
        val url = ChatGptOAuthProtocol.authorizationUrl(
            hostId = "urn:uuid:device-01",
            redirectUri = "http://127.0.0.1:1455/auth/callback",
            state = "unpredictable-state",
            nonce = "nonce",
            challenge = "challenge",
            existing = null
        )
        assertTrue(url.startsWith("https://auth.openai.com/api/accounts/authorize?"))
        assertTrue(url.contains("client_id=dynamic_agent_client"))
        assertTrue(url.contains("agent_name_hint=Elementera+Coast"))
        assertTrue(url.contains("chatgpt.tokens.use.direct"))
        assertTrue(url.contains("redirect_uri=http%3A%2F%2F127.0.0.1"))
        assertFalse(url.contains("client_secret"))
    }

    @Test fun callbackRequiresSameStateAndIssuedClientId() {
        val path = "/auth/callback?code=opaque-code&state=random-state&client_id=oaiapp_example"
        val callback = ChatGptOAuthProtocol.verifyCallback(path, "random-state", null)
        assertEquals("opaque-code", callback.code)
        assertEquals("oaiapp_example", callback.clientId)
        rejects { ChatGptOAuthProtocol.verifyCallback(path, "wrong-state", null) }
        rejects { ChatGptOAuthProtocol.verifyCallback(path.replace("oaiapp_example", "dynamic_agent_client"), "random-state", null) }
        rejects { ChatGptOAuthProtocol.verifyCallback(path.replace("/auth/callback", "/callback"), "random-state", null) }
        rejects { ChatGptOAuthProtocol.verifyCallback(path + "&state=duplicate", "random-state", null) }
        rejects { ChatGptOAuthProtocol.verifyCallback(path, "random-state", "oaiapp_other") }
    }

    private fun rejects(block: () -> Unit) {
        try { block(); fail("Expected OAuth validation to reject the callback.") }
        catch (_: IllegalArgumentException) { /* expected */ }
    }
}
