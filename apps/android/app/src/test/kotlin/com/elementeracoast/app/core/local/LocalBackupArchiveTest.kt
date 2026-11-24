package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.remote.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class LocalBackupArchiveTest {
    private val app = "com.elementeracoast.source"
    private val now = Instant.parse("2026-11-24T12:00:00Z")

    private fun sample(store: LocalPersistence): LocalBackupPayload {
        val cache = RemoteCacheStore(store)
        val c = RemoteConversation("c-1", "中文窗口")
        val user = RemoteUserBranch(1, listOf(RemoteVariant("u1", "旧问题"), RemoteVariant("u2", "新问题", favorite = true)))
        val a = RemoteAssistantBranches(mapOf("1" to 1), mapOf("1" to listOf(
            RemoteVariant("a1", "隐藏旧回复", hidden = true),
            RemoteVariant("a2", "新的回复", liked = true, modelId = "model/test"))))
        cache.putHistory(c.id, RemoteHistory(conversationId = c.id, turns = listOf(RemoteTurn("turn-1", user = user, assistant = a))))
        cache.putConversations(listOf(c))
        cache.putDailyDiaries(listOf(RemoteDailyDiary("d1", date = "2026-11-24", text = "日记")))
        LocalCalendarStore(store).save(null, buildJsonObject {
            put("day", "2026-11-24"); put("title", "第 100 天")
            putJsonObject("anniversary") { put("startDay", "2026-11-24"); put("mode", "milestone"); put("targetDays", 100); put("pinned", true) }
        })
        store.put("unrelated.secret", "NEVER-EXPORT-THIS")
        return LocalBackupArchive.capture(store, app, now)
    }

    @Test fun typedRecordsRoundTripAndNoArbitraryKeysLeak() {
        val data = sample(MemoryLocalPersistence())
        val bytes = LocalBackupArchive.encode(data)
        assertFalse(bytes.decodeToString().contains("NEVER-EXPORT-THIS"))
        val restored = LocalBackupArchive.decode(bytes, app)
        assertEquals(data, restored)
        assertEquals("2027-03-03", restored.calendar.single().jsonObject["day"]!!.jsonPrimitive.content)
        val preview = LocalBackupArchive.preview(restored, data)
        assertEquals(4, preview.variants)
        assertEquals(setOf("c-1"), preview.existingConversationIds)
        assertTrue(preview.conflictingConversationIds.isEmpty())
        val changed = data.copy(conversations = data.conversations.map { it.copy(conversation = it.conversation.copy(title = "另一个标题")) })
        assertEquals(setOf("c-1"), LocalBackupArchive.preview(restored, changed).conflictingConversationIds)
    }

    @Test fun rejectsDamageWrongAppAndDuplicateIds() {
        val data = sample(MemoryLocalPersistence())
        val bytes = LocalBackupArchive.encode(data)
        val damaged = bytes.decodeToString().replace("新的回复", "被篡改").encodeToByteArray()
        assertTrue(runCatching { LocalBackupArchive.decode(damaged, app) }.isFailure)
        assertTrue(runCatching { LocalBackupArchive.decode(bytes, "com.elementeracoast.app") }.isFailure)
        assertTrue(runCatching { LocalBackupArchive.encode(data.copy(conversations = data.conversations + data.conversations)) }.isFailure)
    }

    @Test fun missingOrCorruptHistoryCannotBecomeAnEmptyBackup() {
        val store = MemoryLocalPersistence()
        RemoteCacheStore(store).putConversations(listOf(RemoteConversation("c1")))
        assertTrue(runCatching { LocalBackupArchive.capture(store, app, now) }.isFailure)
        store.put("remote.history.c1", "{invalid")
        assertTrue(runCatching { LocalBackupArchive.capture(store, app, now) }.isFailure)
    }
}
