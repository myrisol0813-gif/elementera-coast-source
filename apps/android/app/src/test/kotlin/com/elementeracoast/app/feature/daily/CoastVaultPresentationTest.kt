package com.elementeracoast.app.feature.daily

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test

class CoastVaultPresentationTest {
    private fun media(id: String, kind: String): JsonObject =
        JsonObject(mapOf("id" to JsonPrimitive(id), "kind" to JsonPrimitive(kind)))

    @Test fun allViewKeepsCanonicalTypesInTheirOwnExhibitionSections() {
        assertEquals("影像", vaultSection("image", false))
        assertEquals("声音", vaultSection("audio", false))
        assertEquals("文件", vaultSection("file", false))
        assertEquals("文字", vaultSection("text", true))
        assertEquals("文字", vaultSection("soil", true))
        assertEquals("其他", vaultSection("file", true))
    }

    @Test fun paperTabsGroupTextAndSoilWithoutMutatingOtherRecords() {
        val rows = listOf(media("a", "text"), media("b", "soil"),
            media("c", "audio"), media("d", "file"))
        val writing = vaultVisibleRows(rows, "treasures", "writing")
        val other = vaultVisibleRows(rows, "treasures", "other")
        assertEquals(listOf("a", "b"), writing.map { it["id"].toString().trim('"') })
        assertEquals(listOf("d"), other.map { it["id"].toString().trim('"') })
        assertEquals(4, rows.size)
        assertEquals(rows, vaultVisibleRows(rows, "treasures", "all"))
        assertEquals(rows, vaultVisibleRows(rows, "basic", "all"))
    }

    @Test fun audioTimeLabelsRemainLegibleWhenSeeking() {
        assertEquals("0:00", vaultTime(0))
        assertEquals("0:07", vaultTime(7_999))
        assertEquals("1:18", vaultTime(78_400))
        assertEquals("61:01", vaultTime(3_661_000))
        assertEquals("0:00", vaultTime(-10))
    }
}
