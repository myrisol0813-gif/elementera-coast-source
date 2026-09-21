package com.elementeracoast.app.core.auth

import com.elementeracoast.app.core.network.CoastApiClient
import com.elementeracoast.app.core.network.CoastApiConfig
import com.elementeracoast.app.core.network.CoastHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class AuthRepositoryTest {
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
    fun authStoreKeepsSessionUntilExplicitClear() {
        val store = MemoryAuthStore()
        val session = AuthSession("__Host-coast_session=abc", 4_000_000_000L)

        store.save(session)
        assertEquals(session, store.load())
        assertEquals(session, store.load())

        store.clear()
        assertNull(store.load())
    }

    @Test
    fun restoreRevalidatesStoredCookieAndRefreshesExpiry() = kotlinx.coroutines.runBlocking {
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "application/json")
                .setBody("""{"ok":true,"authenticated":true,"session":{"kind":"owner","issued_at":"2026-09-18T10:00:00.000Z","persistence":"legacy_expiring","expires_at":"2096-10-02T07:06:40Z"},"account":{"type":"owner","display_name":"前端屋主"}}""")
        )
        val store = MemoryAuthStore(AuthSession("__Host-coast_session=stored", 3_900_000_000L))
        val repository = repository(store)

        val result = repository.restore()

        assertTrue(result is SessionRestoreResult.Restored)
        assertEquals(4_000_000_000L, store.load()!!.expiresAtEpochSeconds)
        val request = server.takeRequest()
        assertEquals("__Host-coast_session=stored", request.getHeader("Cookie"))
        assertEquals("/api/session", request.path)
    }

    @Test
    fun restoreAcceptsUntilLogoutSessionWithoutExpiry() = kotlinx.coroutines.runBlocking {
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "application/json")
                .setBody(
                    """{"ok":true,"authenticated":true,"session":{"kind":"owner","issued_at":"2026-09-19T11:00:00.000Z","persistence":"until_logout","expires_at":null},"account":{"type":"owner","display_name":"前端屋主"}}"""
                )
        )
        val store = MemoryAuthStore(AuthSession("__Host-coast_session=persistent", 3_900_000_000L))
        val repository = repository(store)

        val result = repository.restore()

        assertTrue(result is SessionRestoreResult.Restored)
        assertEquals(0L, store.load()!!.expiresAtEpochSeconds)
        assertEquals("__Host-coast_session=persistent", server.takeRequest().getHeader("Cookie"))
    }

    @Test
    fun networkFailureDoesNotEraseStoredSession() = kotlinx.coroutines.runBlocking {
        val store = MemoryAuthStore(AuthSession("__Host-coast_session=offline", 4_000_000_000L))
        server.shutdown()
        val repository = repository(store)

        val result = repository.restore()

        assertTrue(result is SessionRestoreResult.Offline)
        assertEquals("__Host-coast_session=offline", store.load()!!.cookieHeader)
    }

    @Test
    fun logoutClearsStoredCredentialEvenIfRemoteLogoutIsBestEffort() = kotlinx.coroutines.runBlocking {
        server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "/login"))
        val store = MemoryAuthStore(AuthSession("__Host-coast_session=bye", 4_000_000_000L))
        val repository = repository(store)

        repository.logout()

        assertNull(store.load())
    }

    private fun repository(store: AuthStore): AuthRepository {
        val config = CoastApiConfig(server.url("/").toString().trimEnd('/'))
        val client = CoastHttpClient(config, store).client
        return DefaultAuthRepository(store, CoastApiClient(config, client))
    }
}
