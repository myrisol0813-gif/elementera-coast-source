package com.elementeracoast.app.feature.memory

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ThoughtSoilReasoningPolicyTest {
    @Test
    fun prefersLightestAdvertisedReasoningEffort() {
        assertEquals("none", selectThoughtSoilReasoningEffort(listOf("minimal", "none", "low")))
        assertEquals("minimal", selectThoughtSoilReasoningEffort(listOf("medium", "minimal", "low")))
        assertEquals("low", selectThoughtSoilReasoningEffort(listOf("medium", "low", "high")))
    }

    @Test
    fun leavesReasoningUnsetWhenCatalogHasNoLightEffort() {
        assertNull(selectThoughtSoilReasoningEffort(emptyList()))
        assertNull(selectThoughtSoilReasoningEffort(listOf("medium", "high")))
    }

    @Test
    fun keepsThoughtSoilOutputBounded() {
        assertEquals(2400, THOUGHT_SOIL_MAX_OUTPUT_TOKENS)
    }
}
