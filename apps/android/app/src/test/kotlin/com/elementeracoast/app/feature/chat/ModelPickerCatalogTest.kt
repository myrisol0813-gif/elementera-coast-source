package com.elementeracoast.app.feature.chat

import com.elementeracoast.app.feature.chatgpt.ChatGptAccountModel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ModelPickerCatalogTest {
    private val coast = listOf("openai/gpt-6", "nvidia/nemotron-3-super-120b-a12b:free")
    private val official = listOf(
        ChatGptAccountModel("gpt-6.1-sol", "GPT-6.1-Sol"),
        ChatGptAccountModel("gpt-5.6-terra", "GPT-5.6-Terra")
    )

    @Test fun emptyQueryKeepsBothProviderCatalogsSeparate() {
        val filtered = filterProviderCatalog(coast, official, "")
        assertEquals(coast, filtered.coast)
        assertEquals(official, filtered.official)
    }

    @Test fun searchFiltersWithinEachProviderWithoutInventingOtherModels() {
        val filtered = filterProviderCatalog(coast, official, "sol")
        assertTrue(filtered.coast.isEmpty())
        assertEquals(listOf("gpt-6.1-sol"), filtered.official.map { it.slug })
        assertTrue(filterProviderCatalog(coast, official, "5.5").official.isEmpty())
    }

    @Test fun searchCanMatchSlugOrDisplayLabel() {
        assertEquals(listOf("openai/gpt-6"), filterProviderCatalog(coast, official, "openai/").coast)
        assertEquals(listOf("gpt-5.6-terra"), filterProviderCatalog(coast, official, "TERRA").official.map { it.slug })
    }
}
