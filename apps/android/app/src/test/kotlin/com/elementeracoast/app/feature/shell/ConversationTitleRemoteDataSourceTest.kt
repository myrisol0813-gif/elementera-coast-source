package com.elementeracoast.app.feature.shell

import com.elementeracoast.app.core.network.CoastApiConfig
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ConversationTitleRemoteDataSourceTest {
    @Test
    fun generateUsesCanonicalChatTitleEndpoint() {
        val server = MockWebServer()
        server.start()
        try {
            server.enqueue(
                MockResponse().setResponseCode(200).setBody(
                    """{"ok":true,"conversation":{"id":"main-1","title":"自动命名","room_type":"main"}}"""
                ).addHeader("Content-Type", "application/json")
            )
            val remote = ConversationTitleRemoteDataSource(
                CoastApiConfig(server.url("/").toString().trimEnd('/')),
                OkHttpClient()
            )

            val result = kotlinx.coroutines.runBlocking {
                remote.generate("main-1", "屋主第一条", "Model Partner 第一条回复")
            }
            assertEquals("自动命名", result?.title)

            val request = server.takeRequest()
            assertEquals("POST", request.method)
            assertEquals("/api/chat/title", request.path)
            val body = request.body.readUtf8()
            assertTrue(body.contains("\"conversation_id\":\"main-1\""))
            assertTrue(body.contains("\"user\":\"屋主第一条\""))
            assertTrue(body.contains("\"assistant\":\"Model Partner 第一条回复\""))
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun skippedTitleLeavesConversationUntouched() {
        val server = MockWebServer()
        server.start()
        try {
            server.enqueue(
                MockResponse().setResponseCode(200).setBody("""{"ok":true,"skipped":true}""")
                    .addHeader("Content-Type", "application/json")
            )
            val remote = ConversationTitleRemoteDataSource(
                CoastApiConfig(server.url("/").toString().trimEnd('/')),
                OkHttpClient()
            )

            val result = kotlinx.coroutines.runBlocking {
                remote.generate("main-1", "用户", "助手")
            }
            assertNull(result)
        } finally {
            server.shutdown()
        }
    }
}
