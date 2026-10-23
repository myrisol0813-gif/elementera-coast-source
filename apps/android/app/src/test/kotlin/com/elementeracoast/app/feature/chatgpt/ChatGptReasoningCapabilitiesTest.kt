package com.elementeracoast.app.feature.chatgpt

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Test

class ChatGptReasoningCapabilitiesTest {
    @Test fun readsOnlyProviderDeclaredEffortsInStandardOrder() {
        val catalogItem = Json.parseToJsonElement(
            """{"slug":"test","supported_reasoning_efforts":["high","low","invented","medium"]}"""
        ).jsonObject
        assertEquals(listOf("low", "medium", "high"), decodeChatGptReasoningEfforts(catalogItem))
    }

    @Test fun unsupportedOrMissingEffortsStayUnavailable() {
        val generic = Json.parseToJsonElement(
            """{"slug":"test","supported_parameters":["reasoning"]}"""
        ).jsonObject
        assertEquals(emptyList<String>(), decodeChatGptReasoningEfforts(generic))
    }
}
