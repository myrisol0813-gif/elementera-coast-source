package com.elementeracoast.app.core.restbox

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import org.w3c.dom.Element
import kotlin.math.ceil

@Serializable
data class NativeAccessoryMount(val parentId:String,val index:Int,val svg:String)
@Serializable
data class NativeMotionTrack(
    val targetId:String,val attribute:String,val durationMs:Double,val delayMs:Double=0.0,
    val alternate:Boolean=false,val frames:List<String>,
) {
    fun frame(elapsedMs:Long):String? {
        if(elapsedMs<delayMs||frames.isEmpty()||durationMs<=0||!durationMs.isFinite())return null
        val t=(elapsedMs-delayMs)/durationMs
        val cycle=kotlin.math.floor(t).toLong()
        var phase=t-kotlin.math.floor(t)
        if(alternate&&cycle%2L!=0L)phase=1-phase
        return frames[(phase*frames.size).toInt().coerceIn(0,frames.lastIndex)]
    }
}
@Serializable
data class NativePoseTemplate(
    val version:Int,
    val bodyId:String,
    val palette:String,
    val action:String,
    val viewBox:String,
    val slots:Map<String,String>,
    val accessoryMarker:Map<String,String>,
    val svg:String,
    val mounts:Map<String,NativeAccessoryMount>,
    val motion:List<NativeMotionTrack> = emptyList(),
)
data class NativePreparedPose(val svg:String,val width:Int,val height:Int)

/** Compile the actual authored pose geometry with validated appearance, using only immutable templates.
 * Accessories retain the original insertion parent and position, not guessed screen coordinates.
 */
class NativeCreatureSvg(private val appearance:RestAppearanceCatalogue) {
    private val json=Json{ignoreUnknownKeys=true}
    private val hex=Regex("^#[0-9a-fA-F]{6}$")
    fun decode(raw:String):NativePoseTemplate {
        require(raw.length<=2_000_000)
        val t=json.decodeFromString<NativePoseTemplate>(raw)
        require(t.version==1&&t.action in RestAppearancePolicy.actions)
        val body=appearance.bodies.getValue(t.bodyId)
        require(t.palette in body.palettes&&t.slots.keys==body.slots.keys)
        require((t.slots.values+t.accessoryMarker.values).all{hex.matches(it)})
        require((t.slots.values+t.accessoryMarker.values).distinct().size==t.slots.size+t.accessoryMarker.size)
        require(t.motion.size<=100&&t.motion.all{it.attribute in setOf("transform","opacity","d")&&it.durationMs.isFinite()&&it.durationMs>0&&it.frames.size in 1..128})
        return t
    }
    fun prepare(t:NativePoseTemplate,input:RestAppearance,prop:String?=null,elapsedMs:Long?=null,maxDimension:Int=1536):NativePreparedPose {
        val a=RestAppearancePolicy.validate(appearance,input)
        require(a.bodyId==t.bodyId&&a.palette==t.palette&&t.action in RestAppearancePolicy.actions)
        require(prop==null||prop in setOf("book","flower","cookie","tea","letter"))
        val doc=NativeSvgXml.parse(t.svg)
        val root=doc.documentElement
        val colors=RestAppearancePolicy.colors(appearance,a)
        val palette=t.slots.mapValues{(slot,_)->colors.getValue(slot)}.mapKeys{(slot,_)->t.slots.getValue(slot).lowercase()}
        fun recolor(element:Element,map:Map<String,String>) {
            for(e in NativeSvgXml.elements(element))for(attr in listOf("fill","stroke","stop-color","color")){
                map[e.getAttribute(attr).lowercase()]?.let{e.setAttribute(attr,it)}
            }
        }
        recolor(root,palette)
        val byId=NativeSvgXml.elements(root).filter{it.hasAttribute("id")}.associateBy{it.getAttribute("id")}
        if(!a.hat)byId["hat"]?.setAttribute("display","none")
        if(!a.tongue)byId["tongue"]?.setAttribute("display","none")
        if(!a.horn)NativeSvgXml.elements(root).firstOrNull{it.getAttribute("data-coast-toggle")=="horn"}?.setAttribute("display","none")
        if(elapsedMs!=null)for(track in t.motion)track.frame(elapsedMs)?.let{value->byId[track.targetId]?.setAttribute(track.attribute,value)}
        val originalChildren=byId.mapValues{(_,parent)->
            (0 until parent.childNodes.length).mapNotNull{parent.childNodes.item(it) as? Element}
        }
        fun mount(key:String,kind:String,color:String?=null,adjust:Boolean=false) {
            val recipe=t.mounts[key]?:error("Original accessory is not available in this pose: $key")
            val parent=byId[recipe.parentId]?:error("Missing original accessory parent")
            val children=originalChildren.getValue(recipe.parentId)
            require(recipe.index in 0..children.size)
            val wrapped="<svg xmlns=\"http://www.w3.org/2000/svg\">"+recipe.svg+"</svg>"
            val source=NativeSvgXml.parse(wrapped)
            val group=NativeSvgXml.elements(source.documentElement).drop(1).first()
            val imported=doc.importNode(group,true) as Element
            val replacements=if(color!=null)palette+(t.accessoryMarker.getValue(kind).lowercase() to color)else palette
            recolor(imported,replacements)
            if(adjust) {
                val transform=imported.getAttribute("transform")
                val m=Regex("""^translate\(\s*([-+0-9.eE]+)[ ,]+([-+0-9.eE]+)\s*\)\s*scale\(\s*([-+0-9.eE]+)\s*\)$""").matchEntire(transform)
                    ?:error("Original badge transform missing")
                val x=m.groupValues[1].toDouble()+a.badgeX
                val y=m.groupValues[2].toDouble()+a.badgeY
                val s=m.groupValues[3].toDouble()*a.badgeSize/100
                imported.setAttribute("transform","translate($x $y) scale($s)")
            }
            parent.insertBefore(imported,children.getOrNull(recipe.index))
        }
        if(a.glasses!="none")mount("glasses:"+a.glasses,"glasses",a.glassesColor)
        if(a.neck!="none")mount("neck:"+a.neck,"neck",a.neckColor)
        if(a.badge!="none")mount("badge:"+a.badge+":"+a.badgePlace+":"+a.badgeMode,"badge",
            if(a.badgeMode=="custom")a.badgeColor else null,adjust=true)
        if(prop!=null&&"prop:$prop" in t.mounts)mount("prop:$prop","prop")
        val box=t.viewBox.trim().split(Regex("\\s+")).map{it.toDouble()}
        require(box.size==4&&box.all{it.isFinite()}&&box[2]>0&&box[3]>0)
        val factor=minOf(2.0,maxDimension.toDouble()/maxOf(box[2],box[3]))
        return NativePreparedPose(NativeSvgXml.serialize(doc),ceil(box[2]*factor).toInt().coerceIn(1,1536),ceil(box[3]*factor).toInt().coerceIn(1,1536))
    }
}
