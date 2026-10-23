package com.elementeracoast.app.feature.chatgpt

import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeResponseOutputTest {
    @Test fun imageMessageDoesNotCrashSystemInstructionExtraction() {
        val developer = buildJsonObject {
            put("role", "developer")
            put("content", "你正在海岸。")
        }
        val user = buildJsonObject {
            put("role", "user")
            put("content", buildJsonArray {
                add(buildJsonObject { put("type", "text"); put("text", "请读图") })
                add(buildJsonObject {
                    put("type", "image_url")
                    put("image_url", buildJsonObject {
                        put("url", "data:image/png;base64,AA==")
                    })
                })
            })
        }
        val messageList = listOf(developer, user)
        assertEquals("你正在海岸。", nativeSystemInstructions(messageList))
        val actual = normalizeNativeInput(user)
        val input = buildJsonArray { add(actual) }
        assertEquals(1, nativeVisionCount(input))
        val parts = actual["content"]!!.jsonArray
        assertEquals("input_text", parts[0].jsonObject["type"]!!.jsonPrimitive.content)
        assertEquals("请读图", parts[0].jsonObject["text"]!!.jsonPrimitive.content)
        assertEquals("input_image", parts[1].jsonObject["type"]!!.jsonPrimitive.content)
        assertEquals(
            "data:image/png;base64,AA==",
            parts[1].jsonObject["image_url"]!!.jsonPrimitive.content
        )
    }

    @Test fun attachedUserContentIsNeverInjectedIntoSystemInstructions() {
        val user = buildJsonObject {
            put("role", "user")
            put("content", buildJsonArray {
                add(buildJsonObject {
                    put("type", "text")
                    put("text", "这张图里有什么？")
                })
            })
        }
        assertEquals("", nativeSystemInstructions(listOf(user)))
        assertEquals("", nativeSystemInstructions(listOf(buildJsonObject {
            put("role", "system")
            put("content", buildJsonArray {})
        })))
    }

    @Test fun finalMessageIsRecoveredWhenStreamContainsNoTextDeltas() {
        val response = buildJsonObject {
            put("output", buildJsonArray {
                add(buildJsonObject {
                    put("type", "message")
                    put("content", buildJsonArray {
                        add(buildJsonObject {
                            put("type", "output_text")
                            put("text", "朋友圈已经写好。")
                        })
                    })
                })
            })
        }
        val outcome = readNativeResponseOutput(response)
        assertEquals("朋友圈已经写好。", outcome.finalText)
        assertEquals("朋友圈已经写好。", missingNativeFinalText("", outcome.finalText))
        assertTrue(outcome.toolCalls.isEmpty())
    }

    @Test fun finalTextDoesNotRepeatAlreadyStreamedDelta() {
        assertEquals("世界", missingNativeFinalText("你好，", "你好，世界"))
        assertEquals("", missingNativeFinalText("你好，世界", "你好，世界"))
        assertEquals("", missingNativeFinalText("不同的流", "最终文本"))
    }

    @Test fun functionOnlyResponseContinuesToToolExecutionWithoutText() {
        val response = buildJsonObject {
            put("output", buildJsonArray {
                add(buildJsonObject {
                    put("type", "function_call")
                    put("call_id", "call_001")
                    put("name", "create_moment")
                    put("namespace", "coast")
                    put("arguments", "{\"content\":\"测试\"}")
                })
            })
        }
        val outcome = readNativeResponseOutput(response)
        assertEquals("", outcome.finalText)
        assertEquals(1, outcome.toolCalls.size)
        assertEquals("create_moment", parseNativeCoastToolCall(outcome.toolCalls.first()).name)
    }

    @Test fun reasoningOnlyResponseIsDistinctFromToolCallAndFinishedText() {
        val response = buildJsonObject {
            put("output", buildJsonArray {
                add(buildJsonObject { put("type", "reasoning") })
            })
        }
        val outcome = readNativeResponseOutput(response)
        assertTrue(outcome.hasReasoning)
        assertTrue(outcome.finalText.isEmpty())
        assertTrue(outcome.toolCalls.isEmpty())
    }

    @Test fun emptyOutputDoesNotPretendToContainTextOrTools() {
        val outcome = readNativeResponseOutput(buildJsonObject { put("output", buildJsonArray {}) })
        assertFalse(outcome.hasReasoning)
        assertTrue(outcome.finalText.isEmpty())
        assertTrue(outcome.toolCalls.isEmpty())
    }

    @Test fun functionCallSurvivesEmptyCompletedOutputWhenStreamDeliveredIt() {
        val item = buildJsonObject {
            put("type", "function_call")
            put("call_id", "call_100")
            put("namespace", "coast")
            put("name", "memory_search")
            put("arguments", "{\"query\":\"海岸\"}")
        }
        val finished = buildJsonObject {
            put("type", "response.output_item.done")
            put("output_index", 1)
            put("item", item)
        }
        val reconstructed = completedNativeStreamItem(finished)
        assertEquals(1, reconstructed?.first)
        val outcome = readNativeResponseOutput(
            buildJsonObject { put("output", buildJsonArray {}) },
            mapOf(reconstructed!!)
        )
        assertEquals(1, outcome.toolCalls.size)
        assertEquals("memory_search", parseNativeCoastToolCall(outcome.toolCalls.first()).name)
        assertEquals("function_call", nativeOutputKinds(outcome))
    }

    @Test fun streamOutputFallbackPreservesMessageEvenWhenFinalOutputIsNull() {
        val finalMessage = buildJsonObject {
            put("type", "message")
            put("content", buildJsonArray {
                add(buildJsonObject {
                    put("type", "output_text")
                    put("text", "确认收到。")
                })
            })
        }
        val outcome = readNativeResponseOutput(
            buildJsonObject { put("output", kotlinx.serialization.json.JsonNull) },
            mapOf(0 to finalMessage)
        )
        assertEquals("确认收到。", outcome.finalText)
    }

    @Test fun authoritativeFinalOutputWinsOverStreamFallback() {
        val finalMessage = buildJsonObject {
            put("type", "message")
            put("content", buildJsonArray {
                add(buildJsonObject { put("type", "output_text"); put("text", "最终正文") })
            })
        }
        val stale = buildJsonObject { put("type", "reasoning") }
        val outcome = readNativeResponseOutput(
            buildJsonObject { put("output", buildJsonArray { add(finalMessage) }) },
            mapOf(0 to stale)
        )
        assertEquals("最终正文", outcome.finalText)
        assertFalse(outcome.hasReasoning)
    }

    @Test fun partialOutputItemsCannotBecomeExecutableToolCalls() {
        val partial = buildJsonObject {
            put("type", "response.output_item.added")
            put("output_index", 0)
            put("item", buildJsonObject {
                put("type", "function_call")
                put("call_id", "call_unsafe")
            })
        }
        assertEquals(null, completedNativeStreamItem(partial))
        val interrupted = buildJsonObject {
            put("type", "response.output_item.done")
            put("output_index", 0)
            put("item", buildJsonObject {
                put("type", "function_call")
                put("status", "incomplete")
                put("call_id", "call_unsafe")
            })
        }
        assertEquals(null, completedNativeStreamItem(interrupted))
    }

    @Test fun searchTurnsOnOnlyWithExplicitWebSearchIntent() {
        assertTrue(requestsNativeWebSearch("请联网搜索一下最近的消息"))
        assertTrue(requestsNativeWebSearch("请搜索一下这件事"))
        assertTrue(requestsNativeWebSearch("可以上网搜一些随便的东西给我看吗"))
        assertTrue(requestsNativeWebSearch("请网上查一查最新资料"))
        assertFalse(requestsNativeWebSearch("搜寻我之前保存的记忆"))
        assertTrue(requestsNativeWebSearch("Search the web for today's updates"))
        assertFalse(requestsNativeWebSearch("想和朋友说说话"))
    }

    @Test fun responseCitationsAreDeduplicatedAndDoNotLeakUntrustedSchemes() {
        val output = readNativeResponseOutput(buildJsonObject {
            put("output", buildJsonArray {
                add(buildJsonObject {
                    put("type", "web_search_call")
                    put("action", buildJsonObject {
                        put("sources", buildJsonArray {
                            add(buildJsonObject { put("url", "https://example.org/article") })
                            add(buildJsonObject { put("url", "javascript:alert(1)") })
                        })
                    })
                })
                add(buildJsonObject {
                    put("type", "message")
                    put("content", buildJsonArray {
                        add(buildJsonObject {
                            put("type", "output_text")
                            put("text", "已完成搜索")
                            put("annotations", buildJsonArray {
                                add(buildJsonObject { put("url", "https://example.org/article") })
                                add(buildJsonObject { put("url", "https://second.org/source") })
                            })
                        })
                    })
                })
            })
        })
        assertEquals(listOf("https://example.org/article", "https://second.org/source"), nativeWebSearchSources(output))
    }

    @Test fun imageFailureReportsStageWithoutLeakingExceptionDetails() {
        val error = diagnoseNativeInferenceFailure(
            java.net.SocketTimeoutException("SECRET_ACCESS_TOKEN_AND_IMAGE_BASE64"),
            "openai_stream",
            1,
            1200
        )
        assertEquals("chatgpt_plan_timeout_openai_stream", error.type)
        assertTrue(error.message.orEmpty().contains("图片数=1"))
        assertTrue(error.message.orEmpty().contains("阶段=openai_stream"))
        assertFalse(error.message.orEmpty().contains("SECRET_ACCESS_TOKEN"))
        assertFalse(error.message.orEmpty().contains("IMAGE_BASE64"))
    }

    @Test fun invalidStagesAreRedactedBeforeErrorDisplay() {
        val error = diagnoseNativeInferenceFailure(
            IllegalArgumentException("auth credential and text"),
            "user:secret/private/location",
            0,
            1
        )
        assertTrue(error.message.orEmpty().contains("阶段=unknown"))
        assertFalse(error.message.orEmpty().contains("private/location"))
        assertEquals("chatgpt_plan_processing_unknown", error.type)
    }

    @Test fun visionCountReportsOnlyNormalizedImageParts() {
        val input = buildJsonArray {
            add(buildJsonObject {
                put("role", "user")
                put("content", buildJsonArray {
                    add(buildJsonObject { put("type", "input_text"); put("text", "看这两张") })
                    add(buildJsonObject { put("type", "input_image"); put("image_url", "data:image/png;base64,AA") })
                    add(buildJsonObject { put("type", "input_image"); put("image_url", "data:image/png;base64,BB") })
                })
            })
        }
        assertEquals(2, nativeVisionCount(input))
    }
}
