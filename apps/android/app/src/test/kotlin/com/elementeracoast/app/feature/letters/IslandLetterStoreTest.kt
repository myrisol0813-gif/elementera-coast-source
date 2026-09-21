package com.elementeracoast.app.feature.letters

import com.elementeracoast.app.core.local.MemoryLocalPersistence
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class IslandLetterStoreTest {
    @Test
    fun defaultLetterUsesCurrentModelInToLine() {
        assertTrue(defaultIslandLetter("GPT-5.6 Sol").startsWith("To GPT-5.6 Sol："))
        assertTrue(defaultIslandLetter("o3").startsWith("To o3："))
    }

    @Test
    fun savedLettersAreIndependentByConversationAndModel() {
        val store = IslandLetterStore(MemoryLocalPersistence())
        store.save("main-1", "o3", "o3 的信")
        store.save("main-1", "GPT-5.6 Sol", "5.6 的信")
        store.save("main-2", "o3", "另一个窗口")

        assertEquals("o3 的信", store.read("main-1", "o3"))
        assertEquals("5.6 的信", store.read("main-1", "GPT-5.6 Sol"))
        assertEquals("另一个窗口", store.read("main-2", "o3"))
    }

    @Test
    fun resetReturnsModelSpecificDefaultAndSaveIsBounded() {
        val store = IslandLetterStore(MemoryLocalPersistence())
        val oversized = "x".repeat(IslandLetterStore.MAX_LENGTH + 50)
        assertEquals(IslandLetterStore.MAX_LENGTH, store.save("main-1", "o3", oversized).length)

        val reset = store.reset("main-1", "o3")
        assertTrue(reset.startsWith("To o3："))
        assertEquals(reset, store.read("main-1", "o3"))
        assertNotEquals(oversized, reset)
    }
}
