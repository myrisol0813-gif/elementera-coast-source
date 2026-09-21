package com.elementeracoast.app.core.model

import org.junit.Assert.assertEquals
import org.junit.Test

class ModelDisplayNameTest {
    @Test
    fun stripsProviderAndGptPrefixWithoutChangingOtherModelNames() {
        assertEquals("5.6", modelDisplayName("openai/gpt-5.6"))
        assertEquals("5.5-thinking", modelDisplayName("openai/gpt-5.5-thinking"))
        assertEquals("o3", modelDisplayName("openai/o3"))
        assertEquals("claude-sonnet", modelDisplayName("anthropic/claude-sonnet"))
        assertEquals("", modelDisplayName("   "))
    }
}
