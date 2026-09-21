package com.elementeracoast.app.feature.memory

import com.elementeracoast.app.core.auth.AuthSession
import com.elementeracoast.app.core.auth.MemoryAuthStore
import com.elementeracoast.app.core.network.CoastApiConfig
import com.elementeracoast.app.core.network.CoastHttpClient
import com.elementeracoast.app.core.remote.RemoteMemoryEntryWriteRequest
import com.elementeracoast.app.core.remote.RemoteMemoryPocketResolveRequest
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class MemoryRemoteDataSourceTest {
    private lateinit var server: MockWebServer
    private lateinit var config: CoastApiConfig
    private lateinit var remote: MemoryRemoteDataSource

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        config = CoastApiConfig(server.url("/").toString().trimEnd('/'))
        val auth = MemoryAuthStore(AuthSession("__Host-coast_session=memory-test", 4_000_000_000L))
        remote = MemoryRemoteDataSource(config, CoastHttpClient(config, auth).client)
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun canonicalReadsUseMemoryWorldbookEndpointsAndSharedSession() = runBlocking {
        server.enqueue(json("""{"ok":true,"entries":[{"id":"m1","entry_type":"memory","title":"灯","life_core":"归岸","tag":"关系","memory_tags":["关系"]}],"facets":{"models":[],"windows":[],"tags":["关系"],"times":[]}}"""))
        server.enqueue(json("""{"ok":true,"pockets":[{"id":"p1","conversation_id":"c1","title":"待确认","life_core":"新芽","status":"pending"}]}"""))
        server.enqueue(json("""{"ok":true,"entries":[{"id":"w1","title":"海岸","content":"家","keywords":["海岸"],"enabled":true,"scope":"owner"}]}"""))
        server.enqueue(json("""{"ok":true,"instructions":{"title":"当前自定义指令","content":"保持清明","status":"active","updated_by":"xiaohan","source":"屋主手动编辑"}}"""))

        val entries = remote.listEntries("memory")
        val pockets = remote.listPockets("c1")
        val worldbook = remote.listWorldbook()
        val instructions = remote.getInstructions()

        assertEquals("灯", entries.single().title)
        assertEquals("待确认", pockets.single().title)
        assertEquals("海岸", worldbook.single().title)
        assertEquals("保持清明", instructions?.content)

        val entryRequest = server.takeRequest()
        assertTrue(entryRequest.path!!.startsWith("/api/memory/entries?"))
        assertTrue(entryRequest.path!!.contains("entry_type=memory"))
        assertTrue(entryRequest.path!!.contains("library=1"))
        assertEquals("__Host-coast_session=memory-test", entryRequest.getHeader("Cookie"))
        assertEquals("native-android", entryRequest.getHeader("X-Coast-Client"))

        val pocketRequest = server.takeRequest()
        assertTrue(pocketRequest.path!!.startsWith("/api/memory/pockets?"))
        assertTrue(pocketRequest.path!!.contains("conversation_id=c1"))
        assertTrue(pocketRequest.path!!.contains("status=pending"))

        assertEquals("/api/worldbook", server.takeRequest().path)
        assertEquals("/api/memory/custom-instructions", server.takeRequest().path)
    }

    @Test
    fun canonicalWritesCarryOriginAndResolvePocketWithoutLocalFallback() = runBlocking {
        server.enqueue(json("""{"ok":true,"entry":{"id":"m2","entry_type":"memory","title":"回海","life_core":"同一主人","status":"active","tag":"关系","memory_tags":["关系"]}}"""))
        server.enqueue(json("""{"ok":true,"pocket":{"id":"p1","conversation_id":"c1","title":"候选","life_core":"确认后归库","status":"confirmed"},"entry":{"id":"m3","entry_type":"memory","title":"候选","life_core":"确认后归库","status":"active","tag":"关系","memory_tags":["关系"]}}"""))
        server.enqueue(json("""{"ok":true,"instructions":{"content":"同一片海","status":"active","updated_by":"xiaohan","source":"Native 手动编辑"}}"""))
        server.enqueue(json("""{"ok":true,"matches":[{"id":"w1","title":"海岸","content":"家","keywords":["海岸"],"enabled":true,"scope":"owner"}]}"""))

        remote.createEntry(
            RemoteMemoryEntryWriteRequest(
                entryType = "memory",
                title = "回海",
                lifeCore = "同一主人",
                status = "active",
                tag = "关系",
                memoryTags = listOf("关系")
            )
        )
        remote.resolvePocket("p1", RemoteMemoryPocketResolveRequest(action = "memory", tag = "关系"))
        remote.putInstructions("同一片海")
        remote.testWorldbook("海岸")

        val entryRequest = server.takeRequest()
        assertEquals("POST", entryRequest.method)
        assertEquals("/api/memory/entries", entryRequest.path)
        assertEquals(config.origin, entryRequest.getHeader("Origin"))
        val entryBody = entryRequest.body.readUtf8()
        assertTrue(entryBody.contains("\"entry_type\":\"memory\""))
        assertTrue(entryBody.contains("\"tag\":\"关系\""))

        val pocketRequest = server.takeRequest()
        assertEquals("POST", pocketRequest.method)
        assertEquals("/api/memory/pockets/p1/resolve", pocketRequest.path)
        assertEquals(config.origin, pocketRequest.getHeader("Origin"))
        val pocketBody = pocketRequest.body.readUtf8()
        assertTrue(pocketBody.contains("\"action\":\"memory\""))
        assertTrue(pocketBody.contains("\"tag\":\"关系\""))

        val instructionsRequest = server.takeRequest()
        assertEquals("PUT", instructionsRequest.method)
        assertEquals("/api/memory/custom-instructions", instructionsRequest.path)
        assertEquals(config.origin, instructionsRequest.getHeader("Origin"))
        assertTrue(instructionsRequest.body.readUtf8().contains("\"content\":\"同一片海\""))

        val worldbookRequest = server.takeRequest()
        assertEquals("POST", worldbookRequest.method)
        assertEquals("/api/worldbook/test-match", worldbookRequest.path)
        assertEquals(config.origin, worldbookRequest.getHeader("Origin"))
        val worldbookBody = worldbookRequest.body.readUtf8()
        assertTrue(worldbookBody.contains("\"input\":\"海岸\""))
        assertTrue(worldbookBody.contains("\"allowed_scopes\":[\"owner\",\"both\"]"))
    }

    @Test
    fun globalExcerptUsesFormalCandidateLifecycleEndpoints() = runBlocking {
        server.enqueue(json("""{"ok":true,"excerpt":{"write_guidance":"只收录重要认知","body":"我在文字里认出自己。","write_enabled":true,"revision":1},"candidates":[{"id":"g1","proposed_body":"我在文字里认出自己。\n\n新的理解。","reason":"关系理解变清楚"}],"revisions":[{"id":"r1","revision":2,"before_body":"旧","after_body":"新","confirmation_mode":"confirm","operator":"user"}]}"""))
        server.enqueue(json("""{"ok":true,"excerpt":{"write_guidance":"只收录重要认知","body":"我在文字里认出自己。","write_enabled":false,"revision":1}}"""))
        server.enqueue(json("""{"ok":true,"excerpt":{"write_guidance":"只收录重要认知","body":"编辑后的正文","write_enabled":true,"revision":2}}"""))
        server.enqueue(json("""{"ok":true,"discarded":true}"""))

        val read = remote.getGlobalExcerpt()
        assertEquals("只收录重要认知", read.excerpt.writeGuidance)
        assertEquals("我在文字里认出自己。", read.excerpt.body)
        assertEquals("g1", read.candidates.single().id)
        assertEquals("r1", read.revisions.single().id)

        remote.setGlobalExcerptWriteEnabled(false)
        remote.confirmGlobalExcerptCandidate("g1", "编辑后的正文")
        remote.discardGlobalExcerptCandidate("g2")

        val getRequest = server.takeRequest()
        assertEquals("GET", getRequest.method)
        assertEquals("/api/memory/global-excerpt", getRequest.path)

        val toggleRequest = server.takeRequest()
        assertEquals("PATCH", toggleRequest.method)
        assertEquals("/api/memory/global-excerpt", toggleRequest.path)
        assertTrue(toggleRequest.body.readUtf8().contains("\"write_enabled\":false"))

        val confirmRequest = server.takeRequest()
        assertEquals("PATCH", confirmRequest.method)
        assertEquals("/api/memory/global-excerpt/candidates/g1", confirmRequest.path)
        val confirmBody = confirmRequest.body.readUtf8()
        assertTrue(confirmBody.contains("\"action\":\"confirm\""))
        assertTrue(confirmBody.contains("\"edited_body\":\"编辑后的正文\""))

        val discardRequest = server.takeRequest()
        assertEquals("DELETE", discardRequest.method)
        assertEquals("/api/memory/global-excerpt/candidates/g2", discardRequest.path)
    }

    private fun json(body: String) = MockResponse()
        .setResponseCode(200)
        .setHeader("Content-Type", "application/json")
        .setBody(body)
}
