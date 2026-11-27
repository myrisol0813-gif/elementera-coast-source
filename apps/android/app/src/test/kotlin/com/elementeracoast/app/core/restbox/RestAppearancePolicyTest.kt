package com.elementeracoast.app.core.restbox

import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test
import java.io.File

class RestAppearancePolicyTest {
    private val root = sequenceOf(File("../../web/elementera-mcp/deploy-pages/public"), File("apps/web/elementera-mcp/deploy-pages/public")).first { it.isDirectory }
    private val repo = RestArtRepository { path -> root.resolve(path).readText() }
    private val cat = repo.appearance()

    @Test fun sameCanonicalCatalogueAndRoleIsolation() {
        assertEquals(16, cat.bodies.size)
        val original = RestHousehold(model = RestAppearancePolicy.fresh(cat, "wolf"), human = RestAppearancePolicy.fresh(cat, "cat"))
        val fish = RestAppearancePolicy.chooseBody(cat, original.human, "fish").copy(palette = "black", colors = mapOf("eye" to "#FFDDAA"))
        val changed = RestAppearancePolicy.restore(cat, original.copy(human = fish, humanEnabled = true))
        assertEquals("wolf", changed.model.bodyId)
        assertEquals("cat", original.human.bodyId)
        assertEquals("#ffddaa", RestAppearancePolicy.colors(cat, changed.human)["eye"])
        val raw = Json.encodeToString(RestHousehold.serializer(), changed)
        assertEquals(changed, RestAppearancePolicy.restore(cat, Json.decodeFromString<RestHousehold>(raw)))
    }
    @Test fun rejectsUnsupportedNeckAndUnknownSlot() {
        val fish = RestAppearancePolicy.fresh(cat, "fish")
        assertThrows(IllegalArgumentException::class.java) { RestAppearancePolicy.validate(cat, fish.copy(neck = "scarf")) }
        assertThrows(IllegalArgumentException::class.java) { RestAppearancePolicy.validate(cat, fish.copy(colors = mapOf("fur" to "#ffffff"))) }
        assertThrows(IllegalArgumentException::class.java) { repo.svg("../unsafe.svg") }
    }
}
