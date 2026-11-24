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
            put("dailyProfile", Json.parseToJsonElement("""{"model_partner_display_name":"原来的名字"}"""))
            put("moments", Json.parseToJsonElement("""[{"id":"m1","author":"owner","text":"旧动态","display_author":"原来的署名","comments":[{"id":"c1","author":"model_partner","text":"旧评论"}]}]"""))
            put("diaries", Json.parseToJsonElement("""[{"id":"d1","author":"model_partner","text":"旧日记"}]"""))
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
            put("moments", Json.parseToJsonElement("""[{"id":"m-cloud","author":"model_partner","actor":"model_partner","text":"旧云端动态","reason":"保留","tool_call_id":"call1","published_at":"2026-11-24T12:00:00Z","liked":true,"like_count":2,"likes":[{"actor":"owner","created_at":"2026-11-24T12:00:00Z"},{"actor":"model_partner","created_at":"2026-11-24T12:00:01Z"}]}]"""))
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

    @Test fun fullWebDeskReceiptSurvivesRestoreAndReexport() {
        val receipt = Json.parseToJsonElement("""{"summary":"本轮递给模型","recent_context":{"current_message_separate":true,"turns":1,"messages":[{"role":"user","content":"前一轮"}]},"custom_instructions":{"empty":true},"related_memory":{"items":[{"id":"memory-1","score":1,"title":"旧记忆"},{"id":"memory-2","score":0.1234,"title":"另一条"}]},"worldbook":{"matched_titles":["设定"],"delivered_titles":["设定"],"entries":[{"id":"world-1","matched_keywords":["关键词"],"title":"设定","delivered":true}]},"cross_window":{"sources":[{"conversation_id":"old-1","requested_messages":2,"loaded_messages":2,"delivered_to_model_messages":1}],"messages":[{"conversation_id":"old-1","messages":[{"role":"assistant","content":"旧消息","message_id":"old-message","turn_id":"old-turn","created_at":"2026-11-24T12:00:00Z"}]}]},"workbench":{"used_count":1,"model_visible_tools":[{"name":"test_tool","group":"core"}],"backend_tools":[{"name":"other_tool","group":null}]},"external_tide":{"empty":true},"thinking_soil":{"hand_seeds":[{"title":"旧候选","content":"不可丢失","legacy_meta":{"flag":false,"nullable":null,"items":[1,2.50,900719925474099312345,1.234567890123456789e-20,{"unknown":"原文"}]}}]},"legacy_section":{"unknown_list":[{"k":"v"},null],"empty":[]}}""")
        val original = CoastTransferCodec.decode(cloudBundle())
        val rows = original.getValue("conversations").jsonArray
        val row = rows.single().jsonObject
        val history = row.getValue("history").jsonObject
        val turns = history.getValue("turns").jsonArray
        val turn = turns.single().jsonObject
        val assistant = turn.getValue("assistant").jsonObject
        val variants = assistant.getValue("variantsByUserVariant").jsonObject
        val replies = variants.getValue("0").jsonArray
        val withReceipt = JsonArray(listOf(replies[0], JsonObject(replies[1].jsonObject + ("desk_slip" to receipt))))
        val withAssistant = JsonObject(assistant + ("variantsByUserVariant" to JsonObject(variants + ("0" to withReceipt))))
        val withHistory = JsonObject(history + ("turns" to JsonArray(listOf(JsonObject(turn + ("assistant" to withAssistant))))))
        val payload = JsonObject(original + ("conversations" to JsonArray(listOf(JsonObject(row + ("history" to withHistory))))))
        val local = MemoryLocalPersistence()
        val bytes = CoastTransferCodec.encode(payload)
        LocalTransferRestore.restore(bytes, app, setOf("chat"), local)
        val archived = CoastTransferCodec.decode(LocalBackupArchive.encode(LocalBackupArchive.capture(local, app)))
        val restored = archived.getValue("conversations").jsonArray.single().jsonObject.getValue("history").jsonObject
            .getValue("turns").jsonArray.single().jsonObject.getValue("assistant").jsonObject.getValue("variantsByUserVariant").jsonObject
            .getValue("0").jsonArray[1].jsonObject.getValue("desk_slip")
        fun assertRetained(expected: JsonElement, actual: JsonElement) {
            when (expected) {
                is JsonObject -> expected.forEach { (key, value) -> assertRetained(value, actual.jsonObject.getValue(key)) }
                is JsonArray -> { assertEquals(expected.size, actual.jsonArray.size); expected.forEachIndexed { i, value -> assertRetained(value, actual.jsonArray[i]) } }
                else -> assertEquals(expected, actual)
            }
        }
        assertRetained(receipt, restored)
        assertEquals(receipt, restored)
        assertEquals(receipt.toString(), Json.encodeToString(RemoteDeskSlip.serializer(), Json { ignoreUnknownKeys = true }.decodeFromJsonElement(RemoteDeskSlip.serializer(), receipt)))
        val cache = RemoteCacheStore(local)
        val saved = cache.history("cloud1")!!
        cache.putHistory("cloud1", saved.copy(updatedAt = "2026-11-24T12:01:00Z"))
        val reread = cache.history("cloud1")!!.turns.single().assistant.variantsByUserVariant.getValue("0")[1].deskSlip!!
        assertEquals(receipt, Json.encodeToJsonElement(RemoteDeskSlip.serializer(), reread))
    }
}
