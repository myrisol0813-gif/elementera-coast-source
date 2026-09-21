package com.elementeracoast.app.feature.serpentdesk

import com.elementeracoast.app.core.auth.AuthSession
import com.elementeracoast.app.core.auth.MemoryAuthStore
import com.elementeracoast.app.core.network.CoastApiConfig
import com.elementeracoast.app.core.network.CoastApiException
import com.elementeracoast.app.core.network.CoastHttpClient
import java.security.MessageDigest
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class DevHandsRepositoryTest {
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


    private fun repository(): DevHandsRepository {
        val store = MemoryAuthStore(AuthSession("__Host-coast_session=owner-cookie", 0L))
        val config = CoastApiConfig(server.url("/").toString().trimEnd('/'))
        val client = CoastHttpClient(config, store).client
        return DefaultDevHandsRepository(config, client)
    }

    private fun sha256(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256")
            .digest(bytes)
            .joinToString("") { byte -> (byte.toInt() and 0xff).toString(16).padStart(2, '0') }
}
