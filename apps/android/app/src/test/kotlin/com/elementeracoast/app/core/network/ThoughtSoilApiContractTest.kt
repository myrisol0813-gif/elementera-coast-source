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
            "hand_seeds":[],
            "do_not_repeat":"",
            "pocket_candidates":[],
            "revision":2
          }
        }"""))
        server.enqueue(jsonResponse("""{
          "ok":true,
          "degraded":false,
          "soil":{
            "conversation_id":"c1",
            "current_text":"新壤",
            "hand_seeds":[{"name":"新芽","life_core":"继续承接","usage_hint":"下一轮","avoid_hint":"勿复读"}],
            "do_not_repeat":"",
            "pocket_candidates":[],
            "revision":3,
            "organized_by_model":"openai/gpt-5.6"
          }
        }"""))

        val loaded = api.getThoughtSoil("c1")
        val organized = api.organizeThoughtSoil("c1", "openai/gpt-5.6")

        assertEquals("旧壤", loaded.currentText)
        assertEquals("新壤", organized.soil.currentText)
        assertEquals("新芽", organized.soil.handSeeds.single().name)

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
    }

    private fun jsonResponse(body: String): MockResponse = MockResponse()
        .setResponseCode(200)
        .setHeader("Content-Type", "application/json")
        .setBody(body)
}
