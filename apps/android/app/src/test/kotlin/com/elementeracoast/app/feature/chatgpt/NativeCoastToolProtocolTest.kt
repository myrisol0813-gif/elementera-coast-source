package com.elementeracoast.app.feature.chatgpt

import com.elementeracoast.app.core.network.CoastApiException
import kotlinx.serialization.json.*
import com.elementeracoast.app.core.remote.RemoteNativeToolResult
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

    @Test fun savedImagePixelsUseResponsesInputNotFunctionOutput() {
        val image=Json.parseToJsonElement("""{"role":"user","content":[{"type":"text","text":"system readback"},{"type":"image_url","image_url":{"url":"data:image/png;base64,AA=="}}]}""").jsonObject
        val receipt="""{"ok":true,"status":"saved","attachment":{"id":"image1"}}"""
        val result=RemoteNativeToolResult(ok=true,output=receipt,privateContinuation=listOf(image))
        val (saved,continuation)=nativeSavedImageContinuation("image_generate",result)
        assertEquals(true,saved)
        val part=continuation.single().getValue("content").jsonArray[1].jsonObject
        assertEquals("input_image",part.getValue("type").jsonPrimitive.content)
        assertEquals("data:image/png;base64,AA==",part.getValue("image_url").jsonPrimitive.content)
        val output=nativeCoastToolOutput(NativeCoastToolCall("call_image","image_generate"),result.output)
        assertEquals(false,output.toString().contains("base64"))
        assertEquals(false,result.toString().contains("base64"))
        assertEquals(false,nativeSavedImageContinuation("other_tool",result).first)
        assertEquals(emptyList<JsonObject>(),nativeSavedImageContinuation("image_generate",result.copy(ok=false)).second)
        assertEquals(true,nativeSavedImageContinuation("image_generate",result.copy(privateContinuation=emptyList())).first)
    }

}
