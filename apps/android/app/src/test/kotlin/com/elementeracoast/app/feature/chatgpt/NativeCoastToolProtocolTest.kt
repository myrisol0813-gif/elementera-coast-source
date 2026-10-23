package com.elementeracoast.app.feature.chatgpt

import com.elementeracoast.app.core.network.CoastApiException
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class NativeCoastToolProtocolTest {
    @Test fun namespacedToolCallRoundTripsToResponsesOutput() {
        val call = parseNativeCoastToolCall(buildJsonObject {
            put("type", "function_call")
            put("call_id", "call_abc")
            put("namespace", "coast")
            put("name", "memory_search")
            put("arguments", "{\"query\":\"海岸\"}")
        })
        assertEquals("memory_search", call.name)
        val output = nativeCoastToolOutput(call, "{\"ok\":true}")
        assertEquals("function_call_output", output["type"]!!.jsonPrimitive.content)
        assertEquals("call_abc", output["call_id"]!!.jsonPrimitive.content)
        assertEquals("memory_search", output["name"]!!.jsonPrimitive.content)
        assertEquals("coast", output["namespace"]!!.jsonPrimitive.content)
        assertEquals("{\"ok\":true}", output["output"]!!.jsonPrimitive.content)
    }

    @Test fun dottedToolNameIsNormalizedOnceWithoutDroppingItsNamespace() {
        val call = parseNativeCoastToolCall(buildJsonObject {
            put("call_id", "call_42")
            put("name", "coast.create_moment")
        })
        assertEquals("create_moment", call.name)
        assertEquals("coast", nativeCoastToolOutput(call, "{}")["namespace"]!!.jsonPrimitive.content)
    }

    @Test fun anotherNamespaceIsRejectedBeforeExecution() {
        assertThrows(CoastApiException::class.java) {
            parseNativeCoastToolCall(buildJsonObject {
                put("call_id", "call_2")
                put("namespace", "other")
                put("name", "memory_search")
            })
        }
    }

    @Test fun missingCallIdIsRejectedBeforeExecution() {
        assertThrows(CoastApiException::class.java) {
            parseNativeCoastToolCall(buildJsonObject { put("name", "memory_search") })
        }
    }
}
