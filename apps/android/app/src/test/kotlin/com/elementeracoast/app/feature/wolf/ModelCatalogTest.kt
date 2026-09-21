package com.elementeracoast.app.feature.wolf

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ModelCatalogTest {
    @Test
    fun classifierMatchesCurrentPwaSeries() {
        assertEquals(ModelSeries.O, classifyModelSeries("o3"))
        assertEquals(ModelSeries.Gpt4, classifyModelSeries("openai/gpt-4.1"))
        assertEquals(ModelSeries.Gpt5, classifyModelSeries("GPT-5.6 Sol"))
        assertEquals(ModelSeries.Free, classifyModelSeries("Free: North Mini"))
        assertEquals(ModelSeries.Free, classifyModelSeries("openai/gpt-oss:free"))
        assertEquals(ModelSeries.Image, classifyModelSeries("openai/gpt-image-1"))
        assertEquals(ModelSeries.OtherOpenAi, classifyModelSeries("openai/chat-model"))
    }

    @Test
    fun groupedCatalogExcludesCurrentModelAndKeepsSeriesOrder() {
        val models = listOf("Free: North Mini", "GPT-5.6 Sol", "GPT-5.5 Thinking", "o3")
        val grouped = groupedUnselectedModels(models, "GPT-5.6 Sol")

        assertEquals(ModelSeries.entries, grouped.keys.toList())
        assertFalse(grouped.values.flatten().any { it.id == "GPT-5.6 Sol" })
        assertTrue(grouped.getValue(ModelSeries.Gpt5).any { it.id == "GPT-5.5 Thinking" })
        assertTrue(grouped.getValue(ModelSeries.O).any { it.id == "o3" })
        assertTrue(grouped.getValue(ModelSeries.Free).any { it.id == "Free: North Mini" })
    }
}
