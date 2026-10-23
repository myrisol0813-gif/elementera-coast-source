package com.elementeracoast.app.feature.chat

import kotlin.math.roundToInt

/** Cached reads / all provider-reported input tokens, never a cost-saving percentage. */
internal fun promptCacheHitRate(promptTokens: Long?, cachedTokens: Long?): String? {
    val prompt = promptTokens ?: return null
    val cached = cachedTokens ?: return null
    if (prompt <= 0L || cached < 0L || cached > prompt) return null
    val tenths = (cached.toDouble() * 1000.0 / prompt.toDouble()).roundToInt()
    return if (tenths % 10 == 0) "${tenths / 10}%"
        else "${tenths / 10}.${tenths % 10}%"
}
