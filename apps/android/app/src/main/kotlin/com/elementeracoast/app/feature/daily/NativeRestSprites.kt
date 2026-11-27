package com.elementeracoast.app.feature.daily

import android.content.res.AssetManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import com.elementeracoast.app.core.restbox.*
import kotlinx.serialization.json.*

/** Native-only runtime. Compiled layers are independent sprites, never whole-room screenshots. */
internal class NativeRestSprites(private val assets: AssetManager) {
    private val root = "rest-box/native/v1/"
    private val entries: Map<String,String> = assets.open(root+"index.json").bufferedReader().use {
        val doc = Json.parseToJsonElement(it.readText()).jsonObject
        require(doc["version"]?.jsonPrimitive?.intOrNull == 1)
        doc.getValue("entries").jsonObject.mapValues { e -> e.value.jsonPrimitive.content.also { p ->
            require(Regex("^sprites/[0-9a-f]{24}\\.png$").matches(p))
        } }
    }
    private val cache = object : LruCache<String,Bitmap>(48 * 1024 * 1024) {
        override fun sizeOf(key: String, value: Bitmap): Int = value.allocationByteCount
    }

    private val art by lazy { RestArtRepository(assets) }
    private val catalogue by lazy { NativeSceneCatalogue.load(art) }
    private val furnitureSvg by lazy { NativeFurnitureSvg(art) }
    fun colorSlots(asset: NativeFurnitureAsset) = furnitureSvg.colorSlots(asset)
    fun has(key: String) = key in entries || customFurniture(key) != null
    fun get(key: String): Bitmap? {
        val path = entries[key] ?: return getCustomFurniture(key)
        cache.get(path)?.let { return it }
        val bitmap = assets.open(root+path).use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inScaled=false }) }
        return bitmap?.also { cache.put(path,it) }
    }

    private data class CustomFurniture(val asset: NativeFurnitureAsset,val part: NativePaintPart,val colors:Map<String,String>)
    private fun customFurniture(key:String):CustomFurniture? = runCatching {
        val p=key.split('|')
        if(p.size!=4||p[0]!="f"||p[3].isEmpty())return null
        val a=catalogue.assets[p[1]]?:return null
        val part=NativePaintPart.entries.firstOrNull{it.name.lowercase()==p[2]}?:return null
        if(part!=NativePaintPart.WHOLE&&!a.hasFront)return null
        val colors=p[3].split(',').associate{entry->
            val pair=entry.split('=')
            require(pair.size==2&&pair[0] in a.colorSlots&&Regex("^#[0-9a-f]{6}$").matches(pair[1]))
            pair[0] to pair[1]
        }
        CustomFurniture(a,part,colors)
    }.getOrNull()
    private fun getCustomFurniture(key:String):Bitmap? {
        cache.get(key)?.let{return it}
        val request=customFurniture(key)?:return null
        val a=request.asset
        return runCatching {
            val svg=furnitureSvg.prepare(a,request.colors,request.part)
            NativeSvgRaster.render(svg,kotlin.math.ceil(a.width*2).toInt().coerceIn(1,1536),kotlin.math.ceil(a.height*2).toInt().coerceIn(1,1536))
        }.getOrNull()?.also{cache.put(key,it)}
    }

    /** Resolve explicitly; custom colors and accessories must not silently masquerade as complete. */
    fun furnitureKey(asset: NativeFurnitureAsset, part: NativePaintPart, colors: Map<String,String>): String =
        "f|${asset.id}|${part.name.lowercase()}|" + colors.toSortedMap().entries.joinToString(",") { "${it.key}=${it.value.lowercase()}" }
    fun environmentKey(path: String) = "e|$path"
    fun creatureKey(appearance: RestAppearance, action: String) = "c|${appearance.bodyId}|${appearance.palette}|$action"
    fun customized(appearance: RestAppearance) = appearance.colors.isNotEmpty() || appearance.glasses!="none" ||
        appearance.neck!="none" || appearance.badge!="none" || !appearance.horn || !appearance.hat || !appearance.tongue

    fun load(keys: Set<String>): Map<String,Bitmap> = keys.mapNotNull { key ->
        runCatching { get(key) }.getOrNull()?.let { key to it }
    }.toMap()
}

internal class NativeRestSpriteSnapshot(
    private val atlas: NativeRestSprites,
    private val bitmaps: Map<String,Bitmap>,
    private val house: RestHousehold,
) : NativeRestImages {
    override fun environment(path: String) = bitmaps[atlas.environmentKey(path)]
    override fun furniture(asset: NativeFurnitureAsset, part: NativePaintPart, colors: Map<String,String>) =
        bitmaps[atlas.furnitureKey(asset,part,colors)] ?: bitmaps[atlas.furnitureKey(asset,part,emptyMap())]
    override fun occupant(role: String, action: String) =
        bitmaps[atlas.creatureKey(if(role=="model") house.model else house.human,action)]
}
