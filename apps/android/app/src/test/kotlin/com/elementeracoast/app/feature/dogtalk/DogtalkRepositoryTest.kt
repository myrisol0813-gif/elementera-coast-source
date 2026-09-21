package com.elementeracoast.app.feature.dogtalk

import com.elementeracoast.app.core.network.CoastApiConfig
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DogtalkRepositoryTest {
    @Test
    fun refreshAndSaveUseCanonicalDogtalkEndpointAndKeepRemoteIdInsideRepository() {
        val server = MockWebServer()
        server.start()
        try {
            server.enqueue(
                MockResponse().setResponseCode(200).setBody(
                    """{"ok":true,"dogtalk":{"id":"dogtalk-1","room_scope":"conversation","conversation_id":"main-1","body":"服务器私人草稿","true_core":"真心核","weather":"晴","read_mode":"read_now","status":"saved"}}"""
                ).addHeader("Content-Type", "application/json")
            )
            server.enqueue(
                MockResponse().setResponseCode(200).setBody(
                    """{"ok":true,"dogtalk":{"id":"dogtalk-1","room_scope":"conversation","conversation_id":"main-1","body":"Native 改写","true_core":"真心核","weather":"晴","read_mode":"keep_private","status":"saved"}}"""
                ).addHeader("Content-Type", "application/json")
            )

            val repository = DefaultDogtalkRepository(
                config = CoastApiConfig(server.url("/").toString().trimEnd('/')),
                client = OkHttpClient()
            )

            val loaded = kotlinx.coroutines.runBlocking { repository.refresh(DogtalkScope.Main, "main-1") }
            assertEquals("服务器私人草稿", loaded.body)
            assertEquals("真心核", loaded.trueCore)
            assertEquals("晴", loaded.weather)
            assertEquals(DogtalkReadMode.ReadNow, loaded.readMode)

            val saved = kotlinx.coroutines.runBlocking {
                repository.save(
                    DogtalkScope.Main,
                    "main-1",
                    loaded.copy(body = "Native 改写", readMode = DogtalkReadMode.KeepPrivate)
                )
            }
            assertEquals("Native 改写", saved.body)
            assertEquals(DogtalkReadMode.KeepPrivate, saved.readMode)

            val get = server.takeRequest()
            assertEquals("GET", get.method)
            assertEquals("/api/dogtalk?room_scope=conversation&conversation_id=main-1", get.path)

            val put = server.takeRequest()
            assertEquals("PUT", put.method)
            assertEquals("/api/dogtalk", put.path)
            val body = put.body.readUtf8()
            assertTrue(body.contains("\"id\":\"dogtalk-1\""))
            assertTrue(body.contains("\"body\":\"Native 改写\""))
            assertTrue(body.contains("\"read_mode\":\"keep_private\""))
        } finally {
            server.shutdown()
        }
    }
}
