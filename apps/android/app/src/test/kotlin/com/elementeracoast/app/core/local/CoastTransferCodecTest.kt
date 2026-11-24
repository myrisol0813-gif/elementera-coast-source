package com.elementeracoast.app.core.local

import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class CoastTransferCodecTest {
    @Test fun backendEnvelopeCanBeReadWithoutApplicationGate() {
        val payload = Json.parseToJsonElement("{\"source\":{\"application\":\"fixture\",\"mode\":\"backend\"},\"exported_at\":\"2026-11-24T12:00:00Z\",\"modules\":{\"chat\":{\"conversations\":[]}},\"excluded_modules\":[\"media\"]}").jsonObject
        val bytes = CoastTransferCodec.encode(payload)
        assertEquals(payload, CoastTransferCodec.decode(bytes))
        val envelope = Json.parseToJsonElement(bytes.decodeToString()).jsonObject
        assertEquals("elementera-coast-transfer", envelope["format"]!!.jsonPrimitive.content)
        assertEquals(payload.toString(), envelope["payload_json"]!!.jsonPrimitive.content)
        assertTrue(runCatching { CoastTransferCodec.decode(bytes.decodeToString().replace("fixture", "tampered").encodeToByteArray()) }.isFailure)
    }
}
