package com.elementeracoast.app.core.local

import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class CoastTransferCodecTest {
    @Test fun backendEnvelopeCanBeReadWithoutApplicationGate() {
        val payload = buildJsonObject {
            put("applicationId", "fixture"); put("workspace", "backend"); put("exportedAt", "2026-11-24T12:00:00Z")
            putJsonArray("includedModules") { add("chat") }
            for (key in listOf("conversations", "calendar", "moments", "diaries")) put(key, JsonArray(emptyList()))
            put("profile", JsonNull); put("dailyProfile", JsonNull)
        }
        val bytes = CoastTransferCodec.encode(payload)
        assertEquals(payload, CoastTransferCodec.decode(bytes))
        val envelope = Json.parseToJsonElement(bytes.decodeToString()).jsonObject
        assertEquals("elementera-coast-transfer", envelope["format"]!!.jsonPrimitive.content)
        assertEquals(payload.toString(), envelope["payload_json"]!!.jsonPrimitive.content)
        assertTrue(runCatching { CoastTransferCodec.decode(bytes.decodeToString().replace("fixture", "tampered").encodeToByteArray()) }.isFailure)
    }
}
