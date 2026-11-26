package com.elementeracoast.app.feature.daily

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test

class LibraryDisplayContractTest {
    @Test fun notesFromBothModesRemainVisible() {
        for (author in listOf("assistant", "model_partner")) {
            val note = Json.parseToJsonElement("""{"id":"existing","author":"$author","body":"note"}""").jsonObject
            val display = note.libraryDisplayNote()
            assertEquals("assistant", display["author"]?.jsonPrimitive?.content)
            assertEquals("existing", display["id"]?.jsonPrimitive?.content)
            assertEquals("note", display["body"]?.jsonPrimitive?.content)
            assertEquals(author, note["author"]?.jsonPrimitive?.content)
        }
        for (author in listOf("owner")) {
            val note = Json.parseToJsonElement("""{"author":"$author"}""").jsonObject
            assertEquals("owner", note.libraryDisplayNote()["author"]?.jsonPrimitive?.content)
        }
    }
    @Test fun countsAcceptEachTransportAlias() {
        for (key in listOf("assistant_notes","model_partner_notes")) {
            assertEquals(4, Json.parseToJsonElement("""{"$key":4}""").jsonObject.libraryDisplayCount(true))
        }
        for (key in listOf("owner_notes")) {
            assertEquals(3, Json.parseToJsonElement("""{"$key":3}""").jsonObject.libraryDisplayCount(false))
        }
    }
}
