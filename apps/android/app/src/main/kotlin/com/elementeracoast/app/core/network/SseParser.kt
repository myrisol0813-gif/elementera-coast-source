package com.elementeracoast.app.core.network

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement

internal data class CoastSseEvent(val event: String, val data: JsonElement)

internal class SseParser(private val json: Json) {
    private var eventName = "message"
    private val dataLines = mutableListOf<String>()

    fun acceptLine(line: String?): CoastSseEvent? {
        if (line == null || line.isEmpty()) return finishBlock()
        if (line.startsWith(':')) return null
        val separator = line.indexOf(':')
        val field = if (separator < 0) line else line.substring(0, separator)
        var value = if (separator < 0) "" else line.substring(separator + 1)
        if (value.startsWith(' ')) value = value.substring(1)
        when (field) {
            "event" -> eventName = value.ifBlank { "message" }
            "data" -> dataLines += value
        }
        return null
    }

    private fun finishBlock(): CoastSseEvent? {
        if (dataLines.isEmpty()) {
            eventName = "message"
            return null
        }
        val raw = dataLines.joinToString("\n")
        val parsed = try {
            json.parseToJsonElement(raw)
        } catch (cause: Throwable) {
            reset()
            throw CoastApiException(
                CoastApiErrorKind.Stream,
                "invalid_stream_event",
                "Coast 流式响应格式无效。",
                cause = cause
            )
        }
        val result = CoastSseEvent(eventName, parsed)
        reset()
        return result
    }

    private fun reset() {
        eventName = "message"
        dataLines.clear()
    }
}
