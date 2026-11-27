package com.elementeracoast.app.core.restbox

import java.io.File
import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test

class NativeRoomSceneTest {
    private val root = sequenceOf(File("../web/elementera-mcp/deploy-pages/public"), File("../../web/elementera-mcp/deploy-pages/public"))
        .first { File(it, "rest-box/art/v1/index.json").isFile }
    private val repo = RestArtRepository { path -> root.resolve(path).readText() }
    private val cat = NativeSceneCatalogue.load(repo)

    @Test fun originalAssetsAndOrder() {
        assertEquals(setOf("living", "study", "bedroom"), cat.rooms.keys)
        assertEquals(55, cat.assets.size)
        assertEquals(13, cat.defaults("living").size)
        assertEquals(cat.rooms.getValue("living").order, cat.defaults("living").map { it.assetId })
        cat.assets.values.forEach { assertTrue(repo.svg(it.file).contains("<svg")) }
        cat.rooms.values.forEach { assertTrue(repo.svg(it.environment).contains("<svg")) }
    }

    @Test fun correctNativeLayerOrderAndMirrorAnchor() {
        val items = cat.defaults("living")
        val sofa = items.first { it.assetId == "living-sofa" }
        val a = cat.anchor(sofa, "seat")!!
        val b = cat.anchor(sofa.copy(mirror = true, scale = 2.0), "seat")!!
        val def = cat.assets.getValue(sofa.assetId)
        assertEquals(sofa.x + (def.width - (a.x - sofa.x)) * 2, b.x, 0.0001)
        val layers = cat.layers("living", items, listOf(NativeOccupant("model", sofa.id, "seat")))
        val index = layers.indexOfFirst { it is NativeSceneLayer.Occupant }
        assertTrue(index > 0)
        assertEquals(NativePaintPart.BACK, (layers[index - 1] as NativeSceneLayer.Furniture).part)
        assertEquals(NativePaintPart.FRONT, (layers[index + 1] as NativeSceneLayer.Furniture).part)
        assertEquals(cat.rooms.getValue("living").environment, (layers.first() as NativeSceneLayer.Environment).path)
        assertEquals(cat.rooms.getValue("living").overlay, (layers.last() as NativeSceneLayer.Environment).path)
    }

    @Test fun archiveAndTopmostHit() {
        val original = cat.defaultLayout()
        val first = original.rooms.getValue("living").first()
        val a = first.copy(id = "top", x = 20.0, y = 20.0)
        val b = a.copy(id = "bottom")
        assertEquals("top", cat.hitTest(listOf(b, a), 21.0, 21.0)?.id)
        assertEquals("bottom", cat.hitTest(listOf(b, a.copy(visible = false)), 21.0, 21.0)?.id)
        val appearance = repo.appearance()
        val archive = NativeStudioArchive(layout = original, household = RestHousehold(
            model = RestAppearancePolicy.fresh(appearance, "wolf"), human = RestAppearancePolicy.fresh(appearance, "cat")))
        val raw = Json.encodeToString(NativeStudioArchive.serializer(), archive)
        assertEquals(original, cat.validate(Json.decodeFromString<NativeStudioArchive>(raw).layout))
    }

    @Test fun invalidPlacementDoesNotReplaceLayout() {
        val original = cat.defaultLayout()
        val bad = original.rooms.getValue("living").map { it.copy(scale = 0.0) }
        assertThrows(IllegalArgumentException::class.java) {
            cat.validate(original.copy(rooms = original.rooms + ("living" to bad)))
        }
    }
}
