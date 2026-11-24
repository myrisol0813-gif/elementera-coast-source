package com.elementeracoast.app.core.local

import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class LocalCalendarStoreTest {
    private fun ann(pin: Boolean) = buildJsonObject {
        put("startDay", "2026-11-24"); put("mode", "milestone"); put("targetDays", 100); put("pinned", pin)
    }
    @Test fun recordsSurviveReopenAndPinningNeverDuplicatesCalendarData() {
        val persistence = MemoryLocalPersistence()
        val store = LocalCalendarStore(persistence)
        val row = store.save(null, buildJsonObject { put("day", "2026-11-24"); put("title", "第100天"); put("anniversary", ann(true)) })
        val id = row["id"]!!.jsonPrimitive.content
        assertEquals("2027-03-03", row["day"]!!.jsonPrimitive.content)
        val reopened = LocalCalendarStore(persistence)
        assertEquals(id, reopened.list("2027-03").single()["id"]!!.jsonPrimitive.content)
        val pinned = reopened.list(null, true, "2027-03-03").single()
        assertEquals("today", pinned["status"]!!.jsonObject["phase"]!!.jsonPrimitive.content)
        reopened.save(id, buildJsonObject { put("anniversary", ann(false)) })
        assertTrue(reopened.list(null, true).isEmpty())
        assertEquals(1, reopened.snapshot().size)
        reopened.delete(id)
        assertTrue(LocalCalendarStore(persistence).snapshot().isEmpty())
        assertTrue(LocalCalendarStore(MemoryLocalPersistence()).snapshot().isEmpty())
    }
}
