package com.elementeracoast.app.core.restbox

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*
import kotlin.math.abs

/** Native scene coordinates are the authored SVG viewBox units, not dp or screen pixels. */
@Serializable
data class NativeFurniture(
    val id: String, val assetId: String, val x: Double, val y: Double,
    val scale: Double = 1.0, val mirror: Boolean = false, val visible: Boolean = true,
    val colors: Map<String, String> = emptyMap(), val association: String? = null,
)

@Serializable
data class NativeRoomLayout(val version: Int = 1, val rooms: Map<String, List<NativeFurniture>>)

@Serializable
data class NativeStudioArchive(val version: Int = 1, val layout: NativeRoomLayout, val household: RestHousehold)

data class NativeAnchor(val id: String, val x: Double, val y: Double, val action: String)
data class NativeFurnitureAsset(
    val id: String, val name: String, val file: String, val width: Double, val height: Double,
    val hasFront: Boolean, val anchors: List<NativeAnchor>, val default: NativeFurniture?,
    val colorSlots: Set<String>, val family: String, val presets: List<NativeFurniturePreset>,
)
data class NativeFurniturePreset(val name: String, val colors: Map<String, String>)
data class NativeRoom(
    val id: String, val width: Double, val height: Double, val environment: String,
    val overlay: String?, val order: List<String>,
)
data class NativeSceneCatalogue(val rooms: Map<String, NativeRoom>, val assets: Map<String, NativeFurnitureAsset>) {
    companion object {
        fun load(repo: RestArtRepository): NativeSceneCatalogue {
            val index = repo.index()
            val docs = index.getValue("rooms").jsonArray.map { repo.manifest(it.jsonObject.getValue("manifest").jsonPrimitive.content) }
            val extras = index.getValue("extras").jsonArray.map { repo.manifest(it.jsonPrimitive.content) }
            val palettes = repo.manifest(index.getValue("colorPresets").jsonPrimitive.content)["assets"]?.jsonObject.orEmpty()
            val assets = linkedMapOf<String, NativeFurnitureAsset>()
            val rooms = linkedMapOf<String, NativeRoom>()
            for (d in docs + extras) {
                for (raw in d.getValue("assets").jsonArray) {
                    val a = raw.jsonObject
                    val id = a.str("id")
                    val box = (a["box"] ?: a.getValue("viewBox")).jsonArray.map { it.jsonPrimitive.double }
                    require(box.size == 4 && box.all { it.isFinite() } && box[2] > 0 && box[3] > 0)
                    val p = a["defaultPlacement"]?.jsonObject
                    val anchors = a["anchors"]?.jsonArray.orEmpty().map { v ->
                        val an = v.jsonObject
                        NativeAnchor(an.str("id"), an.num("x"), an.num("y"), an.str("action"))
                    }
                    val slots = (palettes[id]?.jsonObject?.get("slots") ?: a["colorSlots"])?.jsonObject?.keys.orEmpty()
                    val presets = palettes[id]?.jsonObject?.get("presets")?.jsonArray.orEmpty().map { v ->
                        val preset = v.jsonObject
                        NativeFurniturePreset(preset.str("name"), preset.getValue("values").jsonObject.mapValues { it.value.jsonPrimitive.content.lowercase() })
                    }
                    val asset = NativeFurnitureAsset(id, a.str("name"), a.str("file"), box[2], box[3],
                        a["hasFront"]?.jsonPrimitive?.booleanOrNull ?: false, anchors,
                        p?.let { NativeFurniture("", id, it.num("x"), it.num("y"), it.num("scale"),
                            it.getValue("mirror").jsonPrimitive.boolean, it.getValue("visible").jsonPrimitive.boolean) }, slots, d["id"]?.jsonPrimitive?.contentOrNull ?: "extras", presets)
                    require(assets.put(id, asset) == null) { "Duplicate furniture: $id" }
                }
            }
            for (d in docs) {
                val id = d.str("id")
                val room = NativeRoom(id, d.num("width"), d.num("height"), d.str("environment"),
                    d["overlay"]?.jsonPrimitive?.contentOrNull, d.getValue("order").jsonArray.map { it.jsonPrimitive.content })
                require(room.width > 0 && room.height > 0 && room.order.distinct() == room.order)
                require(room.order.all { assets[it]?.default != null })
                require(rooms.put(id, room) == null)
            }
            return NativeSceneCatalogue(rooms, assets)
        }
    }

    fun defaults(roomId: String): List<NativeFurniture> =
        rooms.getValue(roomId).order.mapIndexed { i, id -> assets.getValue(id).default!!.copy(id = "$roomId-${i + 1}") }

    fun defaultLayout() = NativeRoomLayout(rooms = rooms.keys.associateWith(::defaults))

    /** Preserve unknown asset ids on import; missing art is reported instead of deleting placements. */
    fun validate(layout: NativeRoomLayout): NativeRoomLayout {
        require(layout.version == 1)
        val normalized = rooms.keys.associateWith { roomId ->
            val items = layout.rooms[roomId] ?: defaults(roomId)
            require(items.size <= 150 && items.map { it.id }.distinct().size == items.size)
            items.map { item ->
                require(idPattern.matches(item.id) && idPattern.matches(item.assetId))
                require(item.x.isFinite() && item.y.isFinite() && abs(item.x) <= 10000 && abs(item.y) <= 10000)
                require(item.scale.isFinite() && item.scale in .1..4.0)
                require(item.association == null || associationPattern.matches(item.association))
                val slots = assets[item.assetId]?.colorSlots
                require(item.colors.all { (k, v) -> idPattern.matches(k) && hex.matches(v) && (slots == null || k in slots) })
                item.copy(colors = item.colors.mapValues { it.value.lowercase() })
            }
        }
        return NativeRoomLayout(rooms = normalized)
    }

    fun anchor(item: NativeFurniture, id: String): NativeSceneAnchor? {
        if (!item.visible) return null
        val asset = assets[item.assetId] ?: return null
        val a = asset.anchors.firstOrNull { it.id == id } ?: return null
        return NativeSceneAnchor(item.x + (if (item.mirror) asset.width - a.x else a.x) * item.scale,
            item.y + a.y * item.scale, a.action)
    }

    fun hitTest(items: List<NativeFurniture>, x: Double, y: Double): NativeFurniture? =
        items.asReversed().firstOrNull { i ->
            val a = assets[i.assetId]
            i.visible && a != null && x >= i.x && y >= i.y &&
                x <= i.x + a.width * i.scale && y <= i.y + a.height * i.scale
        }
}

data class NativeSceneAnchor(val x: Double, val y: Double, val action: String)
data class NativeOccupant(val role: String, val instanceId: String, val anchorId: String)
enum class NativePaintPart { WHOLE, BACK, FRONT }
sealed interface NativeSceneLayer {
    data class Environment(val path: String) : NativeSceneLayer
    data class Furniture(val item: NativeFurniture, val asset: NativeFurnitureAsset?, val part: NativePaintPart) : NativeSceneLayer
    data class Occupant(val role: String, val anchor: NativeSceneAnchor) : NativeSceneLayer
}

/** The same layer ordering as the web contract, including pets between furniture back/front. */
fun NativeSceneCatalogue.layers(roomId: String, items: List<NativeFurniture>, occupants: List<NativeOccupant>): List<NativeSceneLayer> = buildList {
    val room = rooms.getValue(roomId)
    add(NativeSceneLayer.Environment(room.environment))
    val placed = mutableSetOf<String>()
    val occupied = mutableSetOf<Pair<String, String>>()
    for (item in items) {
        if (!item.visible) continue
        val asset = assets[item.assetId]
        add(NativeSceneLayer.Furniture(item, asset, if (asset?.hasFront == true) NativePaintPart.BACK else NativePaintPart.WHOLE))
        for (occupant in occupants.filter { it.instanceId == item.id }) {
            val p = anchor(item, occupant.anchorId) ?: continue
            if (occupant.role in placed || (item.id to occupant.anchorId) in occupied) continue
            placed.add(occupant.role)
            occupied.add(item.id to occupant.anchorId)
            add(NativeSceneLayer.Occupant(occupant.role, p))
        }
        if (asset?.hasFront == true) add(NativeSceneLayer.Furniture(item, asset, NativePaintPart.FRONT))
    }
    room.overlay?.let { add(NativeSceneLayer.Environment(it)) }
}

private val idPattern = Regex("^[A-Za-z0-9_-]{1,100}$")
private val associationPattern = Regex("^[a-z][a-z0-9-]{0,63}$")
private val hex = Regex("^#[0-9a-fA-F]{6}$")
private fun JsonObject.str(key: String) = getValue(key).jsonPrimitive.content
private fun JsonObject.num(key: String) = getValue(key).jsonPrimitive.double
