package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.remote.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class LocalTransferRestoreTest {
    private val app = "com.elementeracoast.source"
    private val time = "2026-11-24T12:00:00Z"
    private fun cloudBundle(): ByteArray = CoastTransferCodec.encode(buildJsonObject {
        put("applicationId", "coast-web"); put("workspace", "backend"); put("exportedAt", time)
        putJsonArray("includedModules") { add("chat"); add("calendar") }
        put("profile", JsonNull); put("dailyProfile", JsonNull); put("moments", JsonArray(emptyList())); put("diaries", JsonArray(emptyList()))
        put("conversations", Json.parseToJsonElement("""[{"conversation":{"id":"cloud1","title":"原始窗口","room_type":"main","created_at":"2026-11-24T12:00:00Z","updated_at":"2026-11-24T12:00:00Z","title_manual":true},"history":{"version":4,"updated_at":"2026-11-24T12:00:00Z","conversation_id":"cloud1","context_settings":{},"turns":[{"id":"turn1","user":{"active":0,"variants":[{"id":"u1","content":"你记得蓝色小鸟吗","created_at":"2026-11-24T12:00:00Z","favorite":true}]},"assistant":{"activeByUserVariant":{"0":1},"variantsByUserVariant":{"0":[{"id":"a1","content":"旧回复","created_at":"2026-11-24T12:00:00Z","hidden":true},{"id":"a2","content":"记得","created_at":"2026-11-24T12:00:00Z"}]}}}]}}]"""))
        put("calendar", Json.parseToJsonElement("""[{"id":"calendar1","day":"2027-03-03","occurrence_day":"2027-03-03","title":"百日","body":"","kind":"event","recurrence":"none","author":"owner","source":"manual","created_at":1,"updated_at":1,"anniversary":{"startDay":"2026-11-24","mode":"milestone","targetDays":100,"pinned":true}}]"""))
    })
    @Test fun cloudToLocalPreservesVariantsAndCalendarAndDoesNotOverwrite() {
        val local = MemoryLocalPersistence()
        val bytes = cloudBundle()
        val modules = setOf("chat","calendar")
        val preview = LocalTransferRestore.preview(bytes,app,modules,local)
        assertEquals(1,preview.counts.getValue("chat").ready)
        assertTrue(RemoteCacheStore(local).conversations().isEmpty())
        LocalTransferRestore.restore(bytes,app,modules,local)
        val cache = RemoteCacheStore(local)
        val h = cache.history("cloud1")!!
        assertTrue(h.turns[0].user.variants[0].favorite)
        assertEquals(1,h.turns[0].assistant.activeByUserVariant["0"])
        assertTrue(h.turns[0].assistant.variantsByUserVariant.getValue("0")[0].hidden)
        assertEquals("2027-03-03",LocalCalendarStore(local).list(null,true).single().jsonObject["day"]!!.jsonPrimitive.content)
        cache.putHistory("cloud1",h.copy(turns=emptyList()))
        val repeated = LocalTransferRestore.restore(bytes,app,modules,local)
        assertEquals(1,repeated.counts.getValue("chat").conflicts)
        assertTrue(cache.history("cloud1")!!.turns.isEmpty())
    }
    @Test fun crossEditionLocalModelProfileRetainsExistingSelection() {
        val original = MemoryLocalPersistence()
        val profile = RemoteProfile(currentChatModel = "portable-model", modelBox = RemoteModelBox(chat = listOf("portable-model")))
        RemoteCacheStore(original).putProfile(profile)
        val bytes = LocalBackupArchive.encode(LocalBackupArchive.capture(original, "com.elementeracoast.app"))
        val modules = setOf("model_profile")
        val target = MemoryLocalPersistence()
        val decoded = CoastTransferCodec.decode(bytes)
        assertTrue("model_profile" in LocalTransferRestore.availableModules(decoded, app))
        assertTrue("daily" in LocalTransferRestore.availableModules(decoded, app))
        LocalTransferRestore.restore(bytes, app, modules, target)
        val cache = RemoteCacheStore(target)
        assertEquals(profile, cache.profile())
        cache.putProfile(profile.copy(currentChatModel = "existing-model"))
        val repeated = LocalTransferRestore.restore(bytes, app, modules, target)
        assertEquals(1, repeated.counts.getValue("model_profile").conflicts)
        assertEquals("existing-model", cache.profile()?.currentChatModel)
    }
    @Test fun dailyIdentityMappingKeepsHistoricalDisplayAndText() {
        val payload = buildJsonObject {
            put("applicationId", "com.elementeracoast.app"); put("workspace", "local"); put("exportedAt", time)
            putJsonArray("includedModules") { add("daily") }
            put("conversations", JsonArray(emptyList())); put("calendar", JsonArray(emptyList())); put("profile", JsonNull)
            put("dailyProfile", Json.parseToJsonElement("""{"myri_display_name":"原来的名字"}"""))
            put("moments", Json.parseToJsonElement("""[{"id":"m1","author":"xiaohan","text":"旧动态","display_author":"原来的署名","comments":[{"id":"c1","author":"myri","text":"旧评论"}]}]"""))
            put("diaries", Json.parseToJsonElement("""[{"id":"d1","author":"myri","text":"旧日记"}]"""))
        }
        val local = MemoryLocalPersistence()
        LocalTransferRestore.restore(CoastTransferCodec.encode(payload), "com.elementeracoast.source", setOf("daily"), local)
        val cache = RemoteCacheStore(local)
        assertEquals("owner", cache.dailyMoments().single().author)
        assertEquals("model_partner", cache.dailyMoments().single().comments.single().author)
        assertEquals("原来的署名", cache.dailyMoments().single().displayAuthor)
        assertEquals("旧日记", cache.dailyDiaries().single().text)
        assertEquals("model_partner", cache.dailyDiaries().single().author)
        val encoded = CoastTransferCodec.decode(LocalBackupArchive.encode(LocalBackupArchive.capture(local, "com.elementeracoast.source")))
        assertEquals("原来的名字", encoded.getValue("dailyProfile").jsonObject.getValue("model_partner_display_name").jsonPrimitive.content)
    }
    @Test fun cloudDailyLikeDetailsAndProvenanceSurviveLocalRestore() {
        val payload = buildJsonObject {
            put("applicationId", "com.elementeracoast.app"); put("workspace", "backend"); put("exportedAt", time)
            putJsonArray("includedModules") { add("daily") }
            put("conversations", JsonArray(emptyList())); put("calendar", JsonArray(emptyList()))
            put("profile", JsonNull); put("dailyProfile", JsonNull); put("diaries", JsonArray(emptyList()))
            put("moments", Json.parseToJsonElement("""[{"id":"m-cloud","author":"myri","actor":"myri","text":"旧云端动态","reason":"保留","tool_call_id":"call1","published_at":"2026-11-24T12:00:00Z","liked":true,"like_count":2,"likes":[{"actor":"xiaohan","created_at":"2026-11-24T12:00:00Z"},{"actor":"myri","created_at":"2026-11-24T12:00:01Z"}]}]"""))
        }
        val local = MemoryLocalPersistence()
        val bundle = CoastTransferCodec.encode(payload)
        LocalTransferRestore.restore(bundle, "com.elementeracoast.source", setOf("daily"), local)
        val m = RemoteCacheStore(local).dailyMoments().single()
        assertEquals("model_partner", m.actor)
        assertEquals("call1", m.toolCallId)
        assertEquals("保留", m.reason)
        assertEquals(time, m.publishedAt)
        assertEquals(setOf("owner", "model_partner"), m.likes!!.map { it.actor }.toSet())
        assertEquals("2026-11-24T12:00:01Z", m.likes!!.first { it.actor == "model_partner" }.createdAt)
        assertTrue(m.liked)
        assertEquals(2, m.likeCount)
    }
    @Test fun failedTransactionDoesNotExposePartialRecords() {
        val local = MemoryLocalPersistence()
        local.put("original","keep")
        assertTrue(runCatching { local.atomic { staged -> staged.put("original","changed"); staged.put("new","partial"); error("stop") } }.isFailure)
        assertEquals("keep",local.get("original"))
        assertEquals("",local.get("new"))
    }
}
