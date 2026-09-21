package com.elementeracoast.app.feature.gate

import com.elementeracoast.app.core.network.CoastApiConfig
import com.elementeracoast.app.core.network.CoastApiException
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Before
import org.junit.Test

class MailboxRepositoryTest {
    private lateinit var server: MockWebServer
    private lateinit var sessions: MemoryMailboxSessionStore
    private lateinit var repository: MailboxRepository

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        sessions = MemoryMailboxSessionStore()
        repository = MailboxRepository(
            config = CoastApiConfig(server.url("/").toString()),
            sessionStore = sessions
        )
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun loginStoresMailboxCookieWithoutOwnerSession() = runBlocking {
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .addHeader("Content-Type", "application/json")
                .addHeader(
                    "Set-Cookie",
                    "__Host-coast_mailbox=visitor-token; Max-Age=2592000; Path=/; HttpOnly; Secure; SameSite=Strict"
                )
                .setBody(
                    """{"ok":true,"visitor_id":"visitor-1","display_name":"海鸥","preferred_name":null,"allow_memory":true,"privacy_level":"sealed","session":"secure_cookie"}"""
                )
        )

        val visitor = repository.login("moon-word")

        assertEquals("visitor-1", visitor.visitor_id)
        assertEquals("__Host-coast_mailbox=visitor-token", sessions.load())
        val request = server.takeRequest()
        assertEquals("/api/mailbox/login", request.path)
        assertEquals(server.url("/").toString().trimEnd('/'), request.getHeader("Origin"))
        assertNull(request.getHeader("Cookie"))
    }

    @Test
    fun authenticatedRequestUsesOnlyMailboxCookie() = runBlocking {
        sessions.save("__Host-coast_mailbox=visitor-token")
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .addHeader("Content-Type", "application/json")
                .setBody(
                    """{"ok":true,"visitor_id":"visitor-1","display_name":"海鸥","preferred_name":"鸥鸥","allow_memory":true,"privacy_level":"sealed"}"""
                )
        )

        val visitor = repository.me()

        assertEquals("鸥鸥", visitor.preferred_name)
        val request = server.takeRequest()
        assertEquals("__Host-coast_mailbox=visitor-token", request.getHeader("Cookie"))
        assertEquals(null, request.getHeader("Origin"))
    }


    @Test
    fun roomSnapshotDecodesBackendIsoTimestamps() = runBlocking {
        sessions.save("__Host-coast_mailbox=visitor-token")
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val body = when (request.path) {
                    "/api/mailbox/messages" ->
                        """{"ok":true,"messages":[{"id":"m-1","visitor_id":"visitor-1","role":"visitor","content":"第一封信","created_at":"2026-09-20T02:20:00.000Z","updated_at":"2026-09-20T02:20:00.000Z","status":"waiting_for_myri","reply_batch_id":null}]}"""
                    "/api/mailbox/status" ->
                        """{"ok":true,"pending_count":1,"last_myri_reply_at":null,"last_visitor_message_at":"2026-09-20T02:20:00.000Z","queue_status":"pending"}"""
                    "/api/mailbox/memory" ->
                        """{"ok":true,"memory":{"thought_soil":{"visitor_id":"visitor-1","current_text":"","hand_seeds":[],"do_not_repeat":"","pocket_candidates":[],"revision":1,"model_label":null,"model_nickname":null,"updated_at":"2026-09-20T02:19:59.000Z"},"pending_pockets":[],"entries":[]}}"""
                    else -> """{"ok":false}"""
                }
                return MockResponse()
                    .setResponseCode(200)
                    .addHeader("Content-Type", "application/json")
                    .setBody(body)
            }
        }

        val snapshot = repository.roomSnapshot()

        assertEquals("2026-09-20T02:20:00.000Z", snapshot.messages.single().created_at)
        assertEquals("2026-09-20T02:20:00.000Z", snapshot.status.last_visitor_message_at)
        assertEquals("2026-09-20T02:19:59.000Z", snapshot.memory.thought_soil.updated_at)
    }

    @Test
    fun unauthorizedResponseClearsMailboxSession() {
        sessions.save("__Host-coast_mailbox=expired")
        server.enqueue(
            MockResponse()
                .setResponseCode(401)
                .addHeader("Content-Type", "application/json")
                .setBody("""{"ok":false,"error":{"type":"mailbox_session_required","message":"请先输入访客暗号。"}}""")
        )

        assertThrows(CoastApiException::class.java) {
            runBlocking { repository.me() }
        }
        assertNull(sessions.load())
    }
}
