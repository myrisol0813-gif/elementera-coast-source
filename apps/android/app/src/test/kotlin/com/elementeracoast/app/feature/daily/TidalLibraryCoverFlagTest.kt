package com.elementeracoast.app.feature.daily

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TidalLibraryCoverFlagTest {
    @Test fun d1SqlExistsNumberIsRecognized() {
        val row=Json.parseToJsonElement("""{"has_cover":1}""").jsonObject
        assertTrue(row.hasLibraryCover())
    }
    @Test fun jsonBooleanAlsoWorksAndMissingCoverIsFalse() {
        assertTrue(Json.parseToJsonElement("""{"has_cover":true}""").jsonObject.hasLibraryCover())
        assertFalse(Json.parseToJsonElement("""{"has_cover":0}""").jsonObject.hasLibraryCover())
        assertFalse(Json.parseToJsonElement("{}").jsonObject.hasLibraryCover())
    }
}
