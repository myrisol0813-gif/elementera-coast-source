package com.elementeracoast.app.feature.chat

import com.elementeracoast.app.core.model.modelDisplayName
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeChatGptModelRouteTest {
    @Test fun officialModelsAreDistinctFromOpenRouterModels() {
        assertTrue(isChatGptPlanModel("chatgpt-plan:gpt-6-sol"))
        assertTrue(isChatGptPlanModel("chatgpt-plan:gpt-5.6-terra"))
        assertFalse(isChatGptPlanModel("chatgpt-plan:"))
        assertFalse(isChatGptPlanModel("openai/gpt-6"))
        assertFalse(isChatGptPlanModel("gpt-6-sol"))
    }

    @Test fun officialModelsKeepReadableProviderLabel() {
        assertEquals("官端 GPT · gpt-6-sol", modelDisplayName("chatgpt-plan:gpt-6-sol"))
        assertEquals("6", modelDisplayName("openai/gpt-6"))
    }
}
