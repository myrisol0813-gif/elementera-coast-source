package com.elementeracoast.app.core.restbox

import android.content.Context
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*
import java.util.UUID
import kotlin.math.min

@Serializable
data class NativeStudioState(
    val version: Int = 1,
    val layout: NativeRoomLayout,
    val household: RestHousehold,
    val room: String = "living",
    val pets: Boolean = true,
    val reducedMotion: Boolean = false,
    val poseChoices: Map<String, Map<String, String>> = emptyMap(),
)

data class NativePreviewSlot(val instanceId: String, val anchorId: String, val name: String, val action: String, val assetId: String) {
    val key get() = "$instanceId:$anchorId"
}

class NativeStudioPolicy(private val catalogue: NativeSceneCatalogue, private val appearance: RestAppearanceCatalogue) {
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    fun fresh() = NativeStudioState(layout = catalogue.defaultLayout(), household = RestHousehold(
        model = RestAppearancePolicy.fresh(appearance, "wolf"), human = RestAppearancePolicy.fresh(appearance, "cat")))
    fun validate(state: NativeStudioState): NativeStudioState {
        require(state.version == 1)
        val layout = catalogue.validate(state.layout)
        val house = RestAppearancePolicy.restore(appearance, state.household)
        val choices = catalogue.rooms.keys.associateWith { id ->
            val allowed = slots(layout.rooms.getValue(id)).map { it.key }.toSet() + setOf("", "none")
            state.poseChoices[id].orEmpty().filter { (k,v) -> k in setOf("model","human") && v in allowed }
        }.filterValues { it.isNotEmpty() }
        return state.copy(layout = layout, household = house, room = state.room.takeIf { it in catalogue.rooms } ?: "living", poseChoices = choices)
    }
    fun decode(raw: String): NativeStudioState = validate(json.decodeFromString<NativeStudioState>(raw))
    fun encode(state: NativeStudioState): String = json.encodeToString(NativeStudioState.serializer(), validate(state))
    fun export(state: NativeStudioState): String = json.encodeToString(NativeStudioArchive.serializer(),
        NativeStudioArchive(layout = state.layout, household = state.household))
    fun import(raw: String, current: NativeStudioState): NativeStudioState {
        val doc = json.parseToJsonElement(raw).jsonObject
        require(doc["version"]?.jsonPrimitive?.intOrNull == 1)
        val layout = json.decodeFromJsonElement<NativeRoomLayout>(doc["layout"] ?: doc)
        val house = doc["household"]?.let { json.decodeFromJsonElement<RestHousehold>(it) } ?: current.household
        return validate(current.copy(layout = layout, household = house, poseChoices = emptyMap()))
    }
    fun items(state: NativeStudioState) = state.layout.rooms.getValue(state.room)
    private fun change(state: NativeStudioState, items: List<NativeFurniture>) = validate(
        state.copy(layout = state.layout.copy(rooms = state.layout.rooms + (state.room to items))))
    fun edit(state: NativeStudioState, id: String, edit: (NativeFurniture) -> NativeFurniture): NativeStudioState {
        require(items(state).any { it.id == id })
        return change(state, items(state).map { if (it.id == id) edit(it) else it })
    }
    fun add(state: NativeStudioState, assetId: String): Pair<NativeStudioState, String> {
        val asset = catalogue.assets.getValue(assetId)
        val room = catalogue.rooms.getValue(state.room)
        val scale = asset.default?.scale ?: min(.55, min(room.width*.26/asset.width, room.height*.26/asset.height))
        val id = "i-" + UUID.randomUUID()
        val item = NativeFurniture(id, assetId, (room.width-asset.width*scale)/2, (room.height-asset.height*scale)/2, scale)
        return change(state, items(state) + item) to id
    }
    fun duplicate(state: NativeStudioState, id: String): Pair<NativeStudioState, String> {
        val list = items(state).toMutableList()
        val index = list.indexOfFirst { it.id == id }
        require(index >= 0)
        val old = list[index]
        val newId = "i-" + UUID.randomUUID()
        list.add(index+1, old.copy(id=newId, x=(old.x+8).coerceIn(-10000.0,10000.0), y=(old.y+8).coerceIn(-10000.0,10000.0)))
        return change(state,list) to newId
    }
    fun remove(state: NativeStudioState, id: String) = change(state,items(state).filterNot { it.id == id })
    fun resetRoom(state: NativeStudioState) = change(state,catalogue.defaults(state.room))
    fun reorder(state: NativeStudioState, id: String, direction: String): NativeStudioState {
        val list = items(state).toMutableList()
        val index = list.indexOfFirst { it.id == id }
        require(index >= 0)
        val to = when(direction) { "top" -> list.lastIndex; "bottom" -> 0; "up" -> (index+1).coerceAtMost(list.lastIndex); "down" -> (index-1).coerceAtLeast(0); else -> error("Invalid layer") }
        list.add(to,list.removeAt(index))
        return change(state,list)
    }
    fun slots(items: List<NativeFurniture>): List<NativePreviewSlot> = items.filter { it.visible }.flatMap { i ->
        val a = catalogue.assets[i.assetId] ?: return@flatMap emptyList()
        a.anchors.map { NativePreviewSlot(i.id,it.id,a.name,it.action,a.id) }
    }
    fun occupants(state: NativeStudioState): List<NativeOccupant> {
        if (!state.pets) return emptyList()
        val slots = slots(items(state))
        val preferred = when(state.room) {
            "bedroom" -> listOf("bedroom-bed","bedroom-nest")
            "study" -> listOf("study-chair","study-cushion")
            else -> listOf("living-nest","living-sofa")
        }
        val sorted = slots.sortedBy { preferred.indexOf(it.assetId).takeIf { n -> n>=0 } ?: 100 }
        val used = mutableSetOf<String>()
        return listOf("model","human").mapNotNull { role ->
            if (role=="human" && !state.household.humanEnabled) return@mapNotNull null
            val choice=state.poseChoices[state.room]?.get(role)
            if (choice=="none") return@mapNotNull null
            val slot=slots.firstOrNull { it.key==choice && it.key !in used } ?: sorted.firstOrNull { it.key !in used } ?: return@mapNotNull null
            used.add(slot.key)
            NativeOccupant(role,slot.instanceId,slot.anchorId)
        }
    }
}

internal data class NativeStudioLoad(val raw:String?,val warning:String?=null,val migrated:Boolean=false)

/** Native, device-local storage. Failed reads never overwrite the previous data. */
internal class NativeStudioStore(private val context: Context) {
    private val prefs = context.getSharedPreferences("coast.native.rest.studio.v1", Context.MODE_PRIVATE)
    fun raw(): String? = prefs.getString("state", null)
    /** Called off the UI thread before the first native scene is opened. */
    fun load(policy:NativeStudioPolicy):NativeStudioLoad {
        raw()?.let{return NativeStudioLoad(it)}
        if(prefs.getBoolean("legacyChecked",false))return NativeStudioLoad(null)
        val recovered=LegacyStudioRecovery.recover(context)
        if(recovered.isFailure)return NativeStudioLoad(null,"旧版房间资料尚不能读取，自动保存已暂停；原始资料未改动。")
        val raw=recovered.getOrNull()
        if(raw==null){
            require(prefs.edit().putBoolean("legacyChecked",true).commit())
            return NativeStudioLoad(null)
        }
        return runCatching {
            val encoded=policy.encode(policy.decode(raw))
            require(prefs.edit().putString("state",encoded).putString("recovery",raw).putBoolean("legacyChecked",true).commit())
            NativeStudioLoad(encoded,migrated=true)
        }.getOrElse {
            NativeStudioLoad(raw,"旧版房间存档校验失败，可先导出原件；自动保存已暂停。")
        }
    }
    fun save(raw: String) {
        require(prefs.edit().putString("state",raw).putBoolean("legacyChecked",true).commit()){"房间保存未确认"}
    }
    fun preserve(raw: String) {
        require(prefs.edit().putString("recovery",raw).commit()){"旧房间备份保存未确认"}
    }
}
