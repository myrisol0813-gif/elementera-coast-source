package com.elementeracoast.app.core.restbox

import android.content.res.AssetManager
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

// Wire names are shared with the Web room/creature modules. No persistence or chat calls.
@Serializable
data class RestAppearance(
    val bodyId: String,
    val palette: String,
    val colors: Map<String, String> = emptyMap(),
    val glasses: String = "none",
    val neck: String = "none",
    val glassesColor: String = "#b69b65",
    val neckColor: String = "#768ba6",
    val horn: Boolean = true,
    val hat: Boolean = true,
    val tongue: Boolean = true,
)

@Serializable
data class RestHousehold(
    val version: Int = 1,
    val model: RestAppearance,
    val human: RestAppearance,
    val humanEnabled: Boolean = false,
)

@Serializable
data class RestColorSlot(val kind: String, val base: String)

@Serializable
data class RestBodyAppearance(
    val id: String,
    val defaultPalette: String,
    val palettes: Map<String, Map<String, String>>,
    val slots: Map<String, RestColorSlot>,
    val actions: List<String>,
    val neck: Boolean,
    val horn: Boolean,
    val sleepHat: Boolean,
    val hasBodyClip: Boolean,
)

@Serializable
data class RestAppearanceCatalogue(val version: Int, val bodies: Map<String, RestBodyAppearance>)

object RestAppearancePolicy {
    val actions = setOf("idle", "cling", "cheer", "sad", "sit", "sleep")
    private val hex = Regex("^#[0-9a-fA-F]{6}$")
    private val glasses = setOf("none", "round", "square", "sun", "mono")
    private val necks = setOf("none", "tie", "bow", "scarf")

    fun fresh(catalogue: RestAppearanceCatalogue, bodyId: String): RestAppearance {
        val def = requireNotNull(catalogue.bodies[bodyId])
        return RestAppearance(bodyId, def.defaultPalette)
    }

    fun validate(catalogue: RestAppearanceCatalogue, value: RestAppearance): RestAppearance {
        val def = requireNotNull(catalogue.bodies[value.bodyId])
        require(value.palette in def.palettes)
        require(value.colors.all { (key, color) -> key in def.slots && hex.matches(color) })
        require(value.glasses in glasses && value.neck in necks)
        require(def.neck || value.neck == "none")
        require(hex.matches(value.glassesColor) && hex.matches(value.neckColor))
        return value.copy(colors = value.colors.mapValues { it.value.lowercase() })
    }

    fun restore(catalogue: RestAppearanceCatalogue, value: RestHousehold): RestHousehold {
        require(value.version == 1)
        return value.copy(model = validate(catalogue, value.model), human = validate(catalogue, value.human))
    }

    fun chooseBody(catalogue: RestAppearanceCatalogue, value: RestAppearance, bodyId: String): RestAppearance =
        if (value.bodyId == bodyId) value else fresh(catalogue, bodyId)

    fun colors(catalogue: RestAppearanceCatalogue, value: RestAppearance): Map<String, String> {
        val verified = validate(catalogue, value)
        return catalogue.bodies.getValue(verified.bodyId).palettes.getValue(verified.palette) + verified.colors
    }
}

/** Reads only the bundled canonical art directory, not user-supplied SVG or network URLs.
 * Packaging still needs the shared Gradle entry after the concurrent branch is reconciled.
 */
class RestArtRepository(private val open: (String) -> String) {
    constructor(assets: AssetManager) : this({ path -> assets.open(path).bufferedReader(Charsets.UTF_8).use { it.readText() } })

    private val json = Json { ignoreUnknownKeys = true }
    private val safePath = Regex("^(?:[A-Za-z0-9_-]+/)*[A-Za-z0-9_-]+\\.(?:json|svg)$")
    private fun read(path: String): String {
        require(safePath.matches(path))
        return open("rest-box/art/v1/" + path)
    }
    fun index(): JsonObject = json.parseToJsonElement(read("index.json")).jsonObject
    fun appearance(): RestAppearanceCatalogue {
        val path = index().getValue("appearance").jsonPrimitive.content
        val result = json.decodeFromString<RestAppearanceCatalogue>(read(path))
        require(result.version == 1 && result.bodies.size == 16)
        require(result.bodies.all { (id, b) -> id == b.id && b.defaultPalette in b.palettes && b.actions.toSet() == RestAppearancePolicy.actions })
        return result
    }
    fun manifest(path: String): JsonObject {
        require(path.endsWith(".json"))
        return json.parseToJsonElement(read(path)).jsonObject
    }
    fun svg(path: String): String {
        require(path.endsWith(".svg"))
        return read(path)
    }
}
