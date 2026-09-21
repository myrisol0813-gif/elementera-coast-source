package com.elementeracoast.app.core.local

import java.nio.charset.StandardCharsets
import java.util.Base64

/** Line-safe codec used by the small Native local stores. */
object LocalTextCodec {
    private val encoder = Base64.getUrlEncoder().withoutPadding()
    private val decoder = Base64.getUrlDecoder()

    fun encodeFields(vararg values: String): String = values.joinToString("|") { value ->
        encoder.encodeToString(value.toByteArray(StandardCharsets.UTF_8))
    }

    fun decodeFields(line: String): List<String> = line.split('|').map { part ->
        runCatching {
            String(decoder.decode(part), StandardCharsets.UTF_8)
        }.getOrDefault("")
    }
}
