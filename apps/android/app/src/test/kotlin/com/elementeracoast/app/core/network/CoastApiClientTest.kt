package com.elementeracoast.app.core.network

import com.elementeracoast.app.core.auth.AuthSession
import com.elementeracoast.app.core.auth.MemoryAuthStore
import com.elementeracoast.app.core.remote.RemoteChatMessage
import com.elementeracoast.app.core.remote.RemoteChatRequest
import com.elementeracoast.app.core.remote.RemoteDailyDiaryCreateRequest
import com.elementeracoast.app.core.remote.RemoteDailyMomentCreateRequest
import com.elementeracoast.app.core.remote.RemoteDailyProfilePatch
import com.elementeracoast.app.core.remote.RemoteHistory
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class CoastApiClientTest {
    private lateinit var server: MockWebServer
    private lateinit var store: MemoryAuthStore
    private lateinit var api: CoastApiClient
    private lateinit var config: CoastApiConfig

    @Before
    fun setUp() {
        server = MockWebServer(); server.start()
        store = MemoryAuthStore(AuthSession("__Host-coast_session=test-cookie", 4_000_000_000L))
        config = CoastApiConfig(server.url("/").toString().trimEnd('/'))
        api = CoastApiClient(config, CoastHttpClient(config, store).client)
    }

    @After fun tearDown() { server.shutdown() }

    @Test
    fun authenticatedWritesInjectCookieAndOriginWithoutLoggingSecrets() = runBlocking {
        server.enqueue(jsonResponse("""{"ok":true,"conversation":{"id":"c1","title":"新聊天","room_type":"main"}}"""))
        api.createConversation("新聊天", "main")
        val request = server.takeRequest()
        assertEquals("__Host-coast_session=test-cookie", request.getHeader("Cookie"))
        assertEquals(config.origin, request.getHeader("Origin"))
        assertEquals("native-android", request.getHeader("X-Coast-Client"))
        assertEquals("POST", request.method)
        assertEquals("/api/chat/conversations", request.path)
    }

    @Test
    fun profileConversationAndHistoryDecodeCurrentBackendShape() = runBlocking {
        server.enqueue(jsonResponse("""{"ok":true,"profile":{"assistant_avatar_dataurl":"data:image/png;base64,AA==","current_chat_model":"openai/gpt-5.6","current_image_model":"","model_box":{"chat":["openai/gpt-5.6"],"free":[],"image":[]}}}"""))
        server.enqueue(jsonResponse("""{"ok":true,"conversations":[{"id":"c1","title":"PWA 窗口","room_type":"radio","updated_at":"2026-09-02T10:00:00Z"}]}"""))
        server.enqueue(jsonResponse("""{"ok":true,"source":"d1-json-v4","history":{"version":4,"conversation_id":"c1","updated_at":"2026-09-02T10:00:00Z","turns":[{"id":"t1","user":{"active":0,"variants":[{"id":"u1","content":"hello","created_at":"2026-09-02T10:00:00Z"}]},"assistant":{"activeByUserVariant":{"0":0},"variantsByUserVariant":{"0":[{"id":"a1","content":"hi","created_at":"2026-09-02T10:00:01Z","model_id":"openai/gpt-5.6"}]}}}]}}"""))
        val profile = api.getProfile(); val conversations = api.listConversations(); val history = api.getHistory("c1")
        assertEquals("openai/gpt-5.6", profile.currentChatModel)
        assertEquals(listOf("openai/gpt-5.6"), profile.modelBox.chat)
        assertEquals("PWA 窗口", conversations.single().title)
        assertEquals("radio", conversations.single().roomType)
        assertEquals("hello", history.turns.single().user.variants.single().content)
        assertEquals("hi", history.turns.single().assistant.variantsByUserVariant.getValue("0").single().content)
    }

    @Test
    fun historyPutUsesSharedV4EndpointAndOrigin() = runBlocking {
        server.enqueue(jsonResponse("""{"ok":true,"source":"d1-json-v4","history":{"version":4,"conversation_id":"c1","updated_at":"","turns":[]}}"""))
        api.putHistory("c1", RemoteHistory(version = 4, conversationId = "c1"))
        val request = server.takeRequest()
        assertTrue(request.path!!.startsWith("/api/chat/history?conversation_id=c1"))
        assertEquals("PUT", request.method)
        assertEquals(config.origin, request.getHeader("Origin"))
        assertTrue(request.body.readUtf8().contains("\"version\":4"))
    }

    @Test
    fun attachmentUploadUsesCanonicalMultipartEndpointWithOrigin() = runBlocking {
        server.enqueue(jsonResponse("""{"ok":true,"attachment":{"id":"att-1","type":"image","name":"coast.png","mime":"image/png","size":4,"storage_key":"chat-attachment:att-1","created_at":"2026-09-15T12:00:00Z"}}"""))

        val attachment = api.uploadChatAttachment("c1", "coast.png", "image/png", byteArrayOf(1, 2, 3, 4))
        val request = server.takeRequest()

        assertEquals("att-1", attachment.id)
        assertEquals("POST", request.method)
        assertEquals("/api/chat/attachments", request.path)
        assertEquals(config.origin, request.getHeader("Origin"))
        assertTrue(request.getHeader("Content-Type")!!.startsWith("multipart/form-data;"))
        val body = request.body.readUtf8()
        assertTrue(body.contains("name=\"conversation_id\""))
        assertTrue(body.contains("c1"))
        assertTrue(body.contains("filename=\"coast.png\""))
    }

    @Test
    fun dailyCrudUsesCanonicalEndpointsAndPreservesTagsAndProfilePatch() = runBlocking {
        server.enqueue(jsonResponse("""{"ok":true,"moment":{"id":"m1","date":"2026-09-02","author":"owner","text":"回海","liked":false,"comments":[]}}"""))
        server.enqueue(jsonResponse("""{"ok":true,"diary":{"id":"d1","date":"2026-09-02","author":"owner","weather":"有风","mood":"开心","tags":["回海","金色"],"text":"今天。"}}"""))
        server.enqueue(jsonResponse("""{"ok":true,"profile":{"owner_avatar_dataurl":"","model_partner_avatar_dataurl":"data:image/webp;base64,TVlSSQ==","moment_cover_dataurl":""}}"""))

        api.createDailyMoment(RemoteDailyMomentCreateRequest("2026-09-02", "回海"))
        api.createDailyDiary(RemoteDailyDiaryCreateRequest("2026-09-02", "有风", "开心", listOf("回海", "金色"), "今天。"))
        api.putDailyProfile(RemoteDailyProfilePatch(modelPartnerAvatarDataUrl = "data:image/webp;base64,TVlSSQ=="))

        val momentRequest = server.takeRequest()
        assertEquals("/api/daily/moments", momentRequest.path)
        assertEquals("POST", momentRequest.method)
        assertEquals(config.origin, momentRequest.getHeader("Origin"))
        assertTrue(momentRequest.body.readUtf8().contains("\"text\":\"回海\""))

        val diaryRequest = server.takeRequest()
        assertEquals("/api/daily/diaries", diaryRequest.path)
        val diaryBody = diaryRequest.body.readUtf8()
        assertTrue(diaryBody.contains("\"tags\":[\"回海\",\"金色\"]"))
        assertTrue(diaryBody.contains("\"conflict_mode\":\"append\""))

        val profileRequest = server.takeRequest()
        assertEquals("PUT", profileRequest.method)
        assertEquals("/api/daily/profile", profileRequest.path)
        val profileBody = profileRequest.body.readUtf8()
        assertTrue(profileBody.contains("\"model_partner_avatar_dataurl\":\"data:image/webp;base64,TVlSSQ==\""))
        assertTrue(!profileBody.contains("owner_avatar_dataurl"))
    }

    @Test
    fun dailyModelPartnerCommentReadsResultSseWithoutInventingDoneEvent() = runBlocking {
        server.enqueue(
            MockResponse().setResponseCode(200).setHeader("Content-Type", "text/event-stream").setBody(
                "event: ready\ndata: {\"build\":\"daily-comment-33\"}\n\n" +
                    "event: result\ndata: {\"ok\":true,\"model\":\"openai/gpt-5.6\",\"moment\":{\"id\":\"m1\",\"date\":\"2026-09-02\",\"author\":\"owner\",\"text\":\"回海\",\"comments\":[{\"id\":\"c1\",\"author\":\"api\",\"text\":\"我看见了。\"}]}}\n\n"
            )
        )
        val result = api.requestDailyModelPartnerComment("m1")
        assertEquals("openai/gpt-5.6", result.model)
        assertEquals("我看见了。", result.moment.comments.single().text)
        val recorded = server.takeRequest()
        assertEquals("/api/daily/moments/m1/model-partner-comment", recorded.path)
        assertEquals("text/event-stream", recorded.getHeader("Accept"))
        assertTrue(recorded.body.readUtf8().contains("\"mode\":\"instant\""))
    }

    @Test
    fun chatSseDecodesDeltaDoneFurnitureAndSendsExplicitStreamContract() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(200).setHeader("Content-Type", "text/event-stream").setBody("event: meta\ndata: {\"model\":\"openai/gpt-5.6\"}\n\nevent: delta\ndata: {\"content\":\"海\"}\n\nevent: delta\ndata: {\"content\":\"岸\"}\n\nevent: furniture_runs\ndata: []\n\nevent: done\ndata: {\"finish_reason\":\"stop\"}\n\n"))
        val events = api.streamChat(chatRequest()).toList()
        assertTrue(events[0] is ApiStreamEvent.Meta)
        assertEquals(listOf("海", "岸"), events.filterIsInstance<ApiStreamEvent.Delta>().map { it.text })
        assertTrue(events.any { it is ApiStreamEvent.FurnitureRuns })
        assertEquals("stop", events.filterIsInstance<ApiStreamEvent.Done>().single().finishReason)
        val recorded = server.takeRequest()
        assertEquals("text/event-stream", recorded.getHeader("Accept"))
        assertEquals(config.origin, recorded.getHeader("Origin"))
        assertTrue(recorded.body.readUtf8().contains("\"stream\":true"))
    }

    @Test
    fun chatSseBackpressurePreservesDoneFurnitureAndDeskAfterManyDeltas() = runBlocking {
        val deltas = (0 until 160).joinToString(separator = "") { index -> "event: delta\ndata: {\"content\":\"$index,\"}\n\n" }
        server.enqueue(MockResponse().setResponseCode(200).setHeader("Content-Type", "text/event-stream").setBody("event: meta\ndata: {\"model\":\"openai/gpt-5.6\"}\n\n" + deltas + "event: done\ndata: {\"finish_reason\":\"stop\"}\n\nevent: furniture_runs\ndata: [{\"id\":\"run-1\",\"label\":\"记忆搜索\"}]\n\nevent: desk_slip\ndata: {\"summary\":\"本轮递给模型\",\"comfort\":\"已保持在舒服区间\"}\n\n"))
        val events = api.streamChat(chatRequest()).onEach { delay(2) }.toList()
        val receivedDeltas = events.filterIsInstance<ApiStreamEvent.Delta>()
        assertEquals(160, receivedDeltas.size)
        assertEquals("159,", receivedDeltas.last().text)
        assertEquals("stop", events.filterIsInstance<ApiStreamEvent.Done>().single().finishReason)
        assertEquals(1, events.filterIsInstance<ApiStreamEvent.FurnitureRuns>().size)
        assertEquals(1, events.filterIsInstance<ApiStreamEvent.DeskSlip>().size)
    }

    @Test
    fun structuredBackendErrorKeepsTypeStatusAndMessage() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(503).setHeader("Content-Type", "application/json").setBody("""{"ok":false,"error":{"type":"chat_db_not_configured","message":"主聊天 D1 存储未配置。"}}"""))
        val error = runCatching { api.listConversations() }.exceptionOrNull() as CoastApiException
        assertEquals(CoastApiErrorKind.Server, error.kind)
        assertEquals("chat_db_not_configured", error.type)
        assertEquals(503, error.status)
        assertEquals("主聊天 D1 存储未配置。", error.message)
    }

    private fun chatRequest() = RemoteChatRequest(
        conversationId = "c1", sourceTurnId = "t1", model = "openai/gpt-5.6",
        messages = listOf(RemoteChatMessage("user", "hello")), localDate = "2026-09-02", localDateTime = "2026-09-02 20:00"
    )

    private fun jsonResponse(body: String): MockResponse = MockResponse().setResponseCode(200).setHeader("Content-Type", "application/json").setBody(body)
}
