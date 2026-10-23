package com.elementeracoast.app.feature.memory

import com.elementeracoast.app.core.remote.RemoteGlobalExcerptClearRequest
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test

class GlobalExcerptClearRequestTest {
    @Test fun actionAndRevisionAreEncodedWhenDefaultsAreOmitted() {
        val json = Json { encodeDefaults = false }
        val value = json.parseToJsonElement(json.encodeToString(
            RemoteGlobalExcerptClearRequest(action = "clear", expectedRevision = 7)
        )).jsonObject
        assertEquals("clear", value["action"]!!.jsonPrimitive.content)
        assertEquals(7, value["expected_revision"]!!.jsonPrimitive.content.toInt())
    }
}
