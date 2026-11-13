package com.elementeracoast.app.core.network

import com.elementeracoast.app.core.auth.AuthSession
import com.elementeracoast.app.core.auth.MemoryAuthStore
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class ThoughtSoilApiContractTest {
    private lateinit var server: MockWebServer
    private lateinit var api: CoastApiClient
    private lateinit var config: CoastApiConfig

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        val store = MemoryAuthStore(AuthSession("__Host-coast_session=test-cookie", 4_000_000_000L))
        config = CoastApiConfig(server.url("/").toString().trimEnd('/'))
        api = CoastApiClient(config, CoastHttpClient(config, store).client)
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun loadAndOrganizeUseSharedCoastMemoryEndpoints() = runBlocking {
        server.enqueue(jsonResponse("""{
          "ok":true,
          "soil":{
            "conversation_id":"c1",
            "current_text":"旧壤",
            "afterthoughts":["旧余思"],
            "memory_candidates":[],
            "seed_candidates":[],
            "revision":2
          }
        }"""))
        server.enqueue(jsonResponse("""{
          "ok":true,
          "degraded":false,
          "soil":{
            "conversation_id":"c1",
            "current_text":"新壤",
            "afterthoughts":["还想继续看看"],
            "memory_candidates":[{
              "title":"值得记住的决定",
              "content":"以后再遇见时仍希望知道这个决定。",
              "source_excerpt":"刚刚作出的决定"
            }],
            "seed_candidates":[{
              "title":"未尽的问题",
              "content":"不知道以后会长成什么，但想留下。",
              "source_excerpt":"还没说完的问题"
            }],
            "revision":3,
            "organized_by_model":"openai/gpt-5.6"
          }
        }"""))
        server.enqueue(jsonResponse("""{
          "ok":true,
          "soil":{
            "conversation_id":"c1",
            "current_text":"新壤",
            "afterthoughts":["还想继续看看"],
            "memory_candidates":[],
            "seed_candidates":[],
            "manual_locked":false,
            "auto_refresh_enabled":false,
            "revision":4
          }
        }"""))

        val loaded = api.getThoughtSoil("c1")
        val organized = api.organizeThoughtSoil("c1", "openai/gpt-5.6")
        val disabled = api.setThoughtSoilEnabled("c1", false)

        assertEquals("旧壤", loaded.currentText)
        assertEquals(listOf("旧余思"), loaded.afterthoughts)
        assertEquals("新壤", organized.soil.currentText)
        assertEquals(listOf("还想继续看看"), organized.soil.afterthoughts)
        assertEquals("值得记住的决定", organized.soil.memoryCandidates.single().title)
        assertEquals("未尽的问题", organized.soil.seedCandidates.single().title)
        assertEquals(false, disabled.autoRefreshEnabled)

        val getRequest = server.takeRequest()
        assertTrue(getRequest.path!!.startsWith("/api/memory/soil?conversation_id=c1"))
        assertEquals("GET", getRequest.method)
        assertEquals("__Host-coast_session=test-cookie", getRequest.getHeader("Cookie"))

        val organizeRequest = server.takeRequest()
        assertEquals("/api/memory/soil/organize", organizeRequest.path)
        assertEquals("POST", organizeRequest.method)
        assertEquals(config.origin, organizeRequest.getHeader("Origin"))
        val body = organizeRequest.body.readUtf8()
        assertTrue(body.contains("\"conversation_id\":\"c1\""))
        assertTrue(body.contains("\"model\":\"openai/gpt-5.6\""))
        assertTrue(body.contains("\"trigger\":\"reply\""))

        val toggleRequest = server.takeRequest()
        assertTrue(toggleRequest.path!!.startsWith("/api/memory/soil?conversation_id=c1"))
        assertEquals("PUT", toggleRequest.method)
        assertEquals(config.origin, toggleRequest.getHeader("Origin"))
        assertTrue(toggleRequest.body.readUtf8().contains("\"auto_refresh_enabled\":false"))
    }

    private fun jsonResponse(body: String): MockResponse = MockResponse()
        .setResponseCode(200)
        .setHeader("Content-Type", "application/json")
        .setBody(body)
}
