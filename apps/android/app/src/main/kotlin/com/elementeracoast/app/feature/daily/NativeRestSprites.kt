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
    private val index = assets.open(root+"index.json").bufferedReader().use {
        Json.parseToJsonElement(it.readText()).jsonObject.also { doc -> require(doc["version"]?.jsonPrimitive?.intOrNull == 1) }
    }
    private val entries = index.getValue("entries").jsonObject.mapValues { e -> e.value.jsonPrimitive.content.also { p ->
        require(Regex("^sprites/[0-9a-f]{24}\\.png$").matches(p))
    } }
    private val templates = index["templates"]?.jsonObject.orEmpty().mapValues { e -> e.value.jsonPrimitive.content.also { p ->
        require(Regex("^poses/[0-9a-f]{24}\\.json$").matches(p))
    } }
    private val motion = index["motion"]?.jsonObject.orEmpty().mapValues { (_,v) ->
        Json.decodeFromJsonElement<List<NativeMotionTrack>>(v).also { tracks ->
            require(tracks.size<=100&&tracks.all{it.targetId.matches(Regex("^@[0-9]+$"))&&it.attribute in setOf("transform","opacity","d")&&it.durationMs.isFinite()&&it.durationMs>0&&it.frames.size in 1..128})
        }
    }
    private val cache = object : LruCache<String,Bitmap>(48 * 1024 * 1024) {
        override fun sizeOf(key: String, value: Bitmap): Int = value.allocationByteCount
    }

    private val art by lazy { RestArtRepository(assets) }
    private val catalogue by lazy { NativeSceneCatalogue.load(art) }
    private val furnitureSvg by lazy { NativeFurnitureSvg(art) }
    private val appearanceCatalogue by lazy { art.appearance() }
    private val creatureSvg by lazy { NativeCreatureSvg(appearanceCatalogue) }
    private val json=Json{encodeDefaults=true}
    private val poseCache=object:LruCache<String,NativePoseTemplate>(12){}
    fun propOptions(a:RestAppearance,action:String):List<String> = template(a,action)?.mounts?.keys?.filter{it.startsWith("prop:")}?.map{it.substringAfter(':')}.orEmpty()
    fun colorSlots(asset: NativeFurnitureAsset) = furnitureSvg.colorSlots(asset)
    fun has(key: String) = key in entries || customFurniture(key) != null || customCreature(key) != null
    fun get(key: String): Bitmap? {
        val path = entries[key] ?: return if(key.startsWith("cc|"))getCustomCreature(key)else getCustomFurniture(key)
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
    fun movingFurnitureKey(asset:NativeFurnitureAsset,part:NativePaintPart,colors:Map<String,String>):String? =
        furnitureKey(asset,part,colors).takeIf { furnitureKey(asset,part,emptyMap()) in motion }
    fun movingEnvironmentKey(path:String):String? = environmentKey(path).takeIf{it in motion}
    fun furnitureMotionFrame(key:String,elapsedMs:Long):Bitmap? = runCatching {
        val path:String
        val svg:String
        val w:Double
        val h:Double
        val tracks:List<NativeMotionTrack>
        if(key.startsWith("e|")){
            path=key.substringAfter('|')
            val room=catalogue.rooms.values.firstOrNull{it.environment==path||it.overlay==path}?:return null
            tracks=motion[key]?:return null
            svg=art.svg(path);w=room.width;h=room.height
        }else{
            val parts=key.split('|')
            if(parts.size!=4||parts[0]!="f")return null
            val a=catalogue.assets[parts[1]]?:return null
            val part=NativePaintPart.entries.firstOrNull{it.name.lowercase()==parts[2]}?:return null
            tracks=motion[furnitureKey(a,part,emptyMap())]?:return null
            val colors=if(parts[3].isEmpty())emptyMap()else customFurniture(key)?.colors?:return null
            svg=furnitureSvg.prepare(a,colors,part);w=a.width;h=a.height
        }
        val factor=minOf(1.5,480.0/maxOf(w,h))
        NativeSvgRaster.render(furnitureSvg.animatePrepared(svg,tracks,elapsedMs),
            kotlin.math.ceil(w*factor).toInt().coerceAtLeast(1),kotlin.math.ceil(h*factor).toInt().coerceAtLeast(1))
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
    fun baseCreatureKey(appearance:RestAppearance,action:String) = "c|${appearance.bodyId}|${appearance.palette}|$action"
    fun creatureKey(appearance:RestAppearance,action:String,prop:String?=null):String =
        if(!customized(appearance)&&prop==null)baseCreatureKey(appearance,action)
        else "cc|$action|${prop.orEmpty()}|"+json.encodeToString(RestAppearance.serializer(),appearance.copy(colors=appearance.colors.toSortedMap()))
    private data class CreatureRequest(val appearance:RestAppearance,val action:String,val prop:String?)
    private fun customCreature(key:String):CreatureRequest?=runCatching {
        val p=key.split('|',limit=4)
        if(p.size!=4||p[0]!="cc"||p[1] !in RestAppearancePolicy.actions)return null
        val a=RestAppearancePolicy.validate(appearanceCatalogue,json.decodeFromString<RestAppearance>(p[3]))
        if(baseCreatureKey(a,p[1]) !in templates)return null
        val prop=p[2].takeIf{it.isNotEmpty()}
        if(prop!=null&&prop !in setOf("book","flower","cookie","tea","letter"))return null
        CreatureRequest(a,p[1],prop)
    }.getOrNull()
    private fun template(a:RestAppearance,action:String):NativePoseTemplate? {
        val path=templates[baseCreatureKey(a,action)]?:return null
        poseCache.get(path)?.let{return it}
        return assets.open(root+path).bufferedReader().use{creatureSvg.decode(it.readText())}.also{poseCache.put(path,it)}
    }
    fun motionFrame(a:RestAppearance,action:String,prop:String?,elapsedMs:Long,maxDimension:Int):Bitmap? = runCatching {
        val t=template(a,action)?:return null
        if(t.motion.isEmpty())return null
        val p=creatureSvg.prepare(t,a,prop,elapsedMs,maxDimension)
        NativeSvgRaster.render(p.svg,p.width,p.height)
    }.getOrNull()
    private fun getCustomCreature(key:String):Bitmap? {
        cache.get(key)?.let{return it}
        val req=customCreature(key)?:return null
        return runCatching {
            val t=template(req.appearance,req.action)?:return null
            val p=creatureSvg.prepare(t,req.appearance,req.prop)
            NativeSvgRaster.render(p.svg,p.width,p.height)
        }.getOrNull()?.also{cache.put(key,it)}
    }
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
    private val moving: Map<String,Bitmap> = emptyMap(),
) : NativeRestImages {
    override fun environment(path: String) = moving[atlas.environmentKey(path)]?:bitmaps[atlas.environmentKey(path)]
    override fun furniture(asset: NativeFurnitureAsset, part: NativePaintPart, colors: Map<String,String>) =
        moving[atlas.furnitureKey(asset,part,colors)] ?: bitmaps[atlas.furnitureKey(asset,part,colors)] ?: bitmaps[atlas.furnitureKey(asset,part,emptyMap())]
    override fun occupant(role: String, action: String):Bitmap? {
        val a=if(role=="model")house.model else house.human
        return moving[role]?:bitmaps[atlas.creatureKey(a,action)]?:bitmaps[atlas.baseCreatureKey(a,action)]
    }
}
