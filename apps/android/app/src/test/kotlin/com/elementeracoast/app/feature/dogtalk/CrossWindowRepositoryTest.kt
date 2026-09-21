package com.elementeracoast.app.feature.dogtalk

import com.elementeracoast.app.core.network.CoastApiConfig
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class CrossWindowRepositoryTest {
    private lateinit var server: MockWebServer

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun nullOldLetterMetadataStillDecodesAndGetsSafeFallbacks() = runBlocking {
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "application/json")
                .setBody(
                    """{
                      "ok":true,
                      "description":"旧信索引",
                      "limits":{"default_turns":4,"technical_max_turns_per_source":9999},
                      "sources":[{
                        "conversation_id":"other-window",
                        "title":"旧窗口",
                        "room_type":"main",
                        "source":"coast",
                        "source_window_id":null,
                        "updated_at":"2026-09-19T12:00:00.000Z",
                        "message_count":2,
                        "turn_count":1,
                        "readable":true,
                        "disabled_reason":"",
                        "turns":[{
                          "turn_id":null,
                          "turn_number":1,
                          "messages":[
                            {
                              "message_id":"u1",
                              "role":"user",
                              "created_at":"2026-09-19T12:00:00.000Z",
                              "model_id":null,
                              "display_author":null,
                              "preview":"过去的话",
                              "length":4
                            },
                            {
                              "message_id":"a1",
                              "role":"assistant",
                              "created_at":"2026-09-19T12:01:00.000Z",
                              "model_id":null,
                              "display_author":null,
                              "preview":"过去的回复",
                              "length":5
                            }
                          ]
                        }]
                      }]
                    }"""
                )
        )

        val repository = DefaultCrossWindowRepository(
            CoastApiConfig(server.url("/").toString().trimEnd('/')),
            OkHttpClient()
        )
        val snapshot = repository.sources("current-window")

        assertEquals(1, snapshot.sources.size)
        val turn = snapshot.sources.single().turns.single()
        assertEquals("other-window:turn:1", turn.turnId)
        assertEquals("user", turn.messages[0].displayAuthor)
        assertEquals("另一位屋主", turn.messages[1].displayAuthor)
        assertTrue(server.takeRequest().path!!.startsWith("/api/chat/cross-window/messages"))
    }
}
