package com.elementeracoast.app.feature.chat

import com.elementeracoast.app.core.remote.RemoteModelUsage
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PromptCacheUsageTest {
    @Test fun ratiosMatchInputTokenShareNotMoneySaved() {
        assertEquals("75%", promptCacheHitRate(10000, 7500))
        assertEquals("33.3%", promptCacheHitRate(300, 100))
        assertEquals("0%", promptCacheHitRate(100, 0))
        assertEquals("100%", promptCacheHitRate(100, 100))
    }

    @Test fun missingAndImpossibleUsageNeverPretendsToBeZero() {
        assertNull(promptCacheHitRate(100, null))
        assertNull(promptCacheHitRate(null, 10))
        assertNull(promptCacheHitRate(0, 0))
        assertNull(promptCacheHitRate(100, 101))
        assertNull(promptCacheHitRate(100, -1))
    }

    @Test fun remoteProviderCacheDetailsAreOptionalAndDecodedWithoutLosingZeros() {
        val withCache = Json.decodeFromString<RemoteModelUsage>(
            """{"prompt_tokens":100,"completion_tokens":5,"cached_tokens":0,"cache_write_tokens":70,"cache_discount":-0.003,"total_tokens":105}"""
        )
        assertEquals(0L, withCache.cachedTokens)
        assertEquals(70L, withCache.cacheWriteTokens)
        assertEquals(-0.003, withCache.cacheDiscount!!, 0.00000001)
        val old = Json.decodeFromString<RemoteModelUsage>(
            """{"prompt_tokens":100,"completion_tokens":5,"total_tokens":105}"""
        )
        assertNull(old.cachedTokens)
        assertNull(old.cacheWriteTokens)
        assertNull(old.cacheDiscount)
    }
}
