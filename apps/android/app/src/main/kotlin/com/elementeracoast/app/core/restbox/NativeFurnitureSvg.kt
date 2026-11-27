package com.elementeracoast.app.core.restbox

import kotlinx.serialization.json.*
import org.w3c.dom.Document
import org.w3c.dom.Element
import org.xml.sax.InputSource
import java.io.StringReader
import java.io.StringWriter
import javax.xml.parsers.DocumentBuilderFactory
import javax.xml.transform.TransformerFactory
import javax.xml.transform.OutputKeys
import javax.xml.transform.dom.DOMSource
import javax.xml.transform.stream.StreamResult
import kotlin.math.roundToInt

/** Geometry and color-slot rules are shared with room-renderer.mjs; no HTML or arbitrary imported SVG. */
class NativeFurnitureSvg(private val art: RestArtRepository) {
    private val presets by lazy { art.manifest(art.index().getValue("colorPresets").jsonPrimitive.content).getValue("assets").jsonObject }
    private val fallbackSlots by lazy {
        val index=art.index()
        val docs=index.getValue("rooms").jsonArray.map{it.jsonObject.getValue("manifest").jsonPrimitive.content}+
            index.getValue("extras").jsonArray.map{it.jsonPrimitive.content}
        docs.flatMap{art.manifest(it).getValue("assets").jsonArray.map{a->a.jsonObject}}.associate{
            it.getValue("id").jsonPrimitive.content to (it["colorSlots"]?.jsonObject ?: JsonObject(emptyMap()))
        }
    }
    private fun slots(asset: NativeFurnitureAsset): Map<String,JsonElement> =
        presets[asset.id]?.jsonObject?.get("slots")?.jsonObject ?: fallbackSlots[asset.id].orEmpty()
    fun colorSlots(asset: NativeFurnitureAsset): Map<String,Pair<String,String>> =
        slots(asset).mapValues { (key,raw) ->
            val s=raw.jsonObject
            (s["label"]?.jsonPrimitive?.contentOrNull ?: key) to s.getValue("base").jsonPrimitive.content
        }
    fun prepare(asset: NativeFurnitureAsset, colors: Map<String,String>, part: NativePaintPart): String {
        val slots=slots(asset)
        val doc=NativeSvgXml.parse(art.svg(asset.file))
        val all=NativeSvgXml.elements(doc.documentElement)
        val global=linkedMapOf<String,String>()
        val coordinated=linkedMapOf<String,String>()
        val patterns=linkedMapOf<String,MutableMap<String,String>>()
        fun attr(e:Element,name:String):String?=e.getAttribute(name).takeIf{it.isNotEmpty()}
        fun apply(e:Element,map:Map<String,String>){
            for(a in listOf("fill","stroke","stop-color"))attr(e,a)?.lowercase()?.let{map[it]}?.let{e.setAttribute(a,it)}
        }
        for((key,value) in colors){
            val slot=requireNotNull(slots[key]?.jsonObject)
            require(hex.matches(value))
            val base=slot.getValue("base").jsonPrimitive.content
            if(slot["members"]!=null){
                for(c in slot.getValue("members").jsonArray.map{it.jsonPrimitive.content})coordinated[c.lowercase()]=shiftInk(c,base,value)
                for((id,cs) in slot["patterns"]?.jsonObject.orEmpty()){
                    val map=patterns.getOrPut(id){linkedMapOf()}
                    for(c in cs.jsonArray.map{it.jsonPrimitive.content})map[c.lowercase()]=shiftInk(c,base,value)
                }
            }else if(slot["selector"]!=null){
                val selector=slot.getValue("selector").jsonObject
                val id=selector.getValue("groupId").jsonPrimitive.content
                val root=all.firstOrNull{it.getAttribute("id")==id}?:error("Palette group missing")
                val a=selector.getValue("attribute").jsonPrimitive.content
                require(a in setOf("fill","stroke"))
                val original=selector.getValue("original").jsonPrimitive.content
                for(e in NativeSvgXml.elements(root))if(attr(e,a).equals(original,ignoreCase=true))e.setAttribute(a,value)
            }else{
                val afternoon=asset.id in setOf("extra-rocker","extra-telescope","extra-lace-table","extra-teapot","extra-letter-shelf","extra-moon-cushion")
                val secondary=key=="secondary"
                val light=if(secondary)mix(value,"#f3d8ad",.38)else mix(value,if(afternoon)"#fff3d5" else "#fff1d2",if(afternoon).45 else .44)
                val dark=if(secondary)mix(value,"#503d31",.28)else mix(value,if(afternoon)"#67503e" else "#514a3d",if(afternoon).25 else .32)
                for((from,to) in listOf(base to value,slot["light"]?.jsonPrimitive?.contentOrNull to light,slot["dark"]?.jsonPrimitive?.contentOrNull to dark)){
                    if(from==null||!hex.matches(from))continue
                    val old=global.put(from.lowercase(),to)
                    require(old==null||old==to){"Overlapping palette slots"}
                }
            }
        }
        if(coordinated.isNotEmpty())for(e in all.filter{node->
            generateSequence<org.w3c.dom.Node>(node){it.parentNode}.filterIsInstance<Element>().any{it.hasAttribute("data-part")}
        })apply(e,coordinated)
        for((id,map) in patterns){
            val p=all.firstOrNull{it.getAttribute("id")==id && it.localName=="pattern"}?:error("Missing palette pattern")
            NativeSvgXml.elements(p).forEach{apply(it,map)}
        }
        if(global.isNotEmpty())all.forEach{apply(it,global)}
        if(part!=NativePaintPart.WHOLE){
            val layers=all.filter{it.hasAttribute("data-part")}
            val name=part.name.lowercase()
            require(layers.any{it.getAttribute("data-part")==name}){"Missing authored furniture layer"}
            layers.filter{it.getAttribute("data-part")!=name}.forEach{it.parentNode?.removeChild(it)}
        }
        return NativeSvgXml.serialize(doc)
    }
    /** Tracks address the element order of the same source after the same front/back split. */
    fun animatePrepared(svg:String,tracks:List<NativeMotionTrack>,elapsedMs:Long):String {
        val doc=NativeSvgXml.parse(svg)
        val elements=NativeSvgXml.elements(doc.documentElement)
        for(track in tracks) {
            require(track.attribute in setOf("transform","opacity","d"))
            val index=track.targetId.takeIf{it.startsWith("@")}?.substring(1)?.toIntOrNull()?:continue
            val target=elements.getOrNull(index)?:error("Missing original animated element")
            track.frame(elapsedMs)?.let{target.setAttribute(track.attribute,it)}
        }
        return NativeSvgXml.serialize(doc)
    }

    companion object {
        private val hex=Regex("^#[0-9a-fA-F]{6}$")
        private fun channels(color:String)=listOf(1,3,5).map{color.substring(it,it+2).toInt(16)}
        private fun rgb(values:List<Int>)="#"+values.joinToString(""){it.coerceIn(0,255).toString(16).padStart(2,'0')}
        fun shiftInk(original:String,base:String,target:String):String {
            if(base.equals(target,true))return original
            val a=channels(original);val b=channels(base);val c=channels(target)
            return rgb(a.indices.map{a[it]+c[it]-b[it]})
        }
        private fun mix(a:String,b:String,t:Double):String {
            val x=channels(a);val y=channels(b)
            return rgb(x.indices.map{(x[it]*(1-t)+y[it]*t).roundToInt()})
        }
    }
}

/** Restrict parser inputs to the immutable bundled SVGs; no XML external entities or file/network references. */
internal object NativeSvgXml {
    fun parse(svg:String):Document {
        require(svg.length<=1_000_000 && !svg.contains("<!DOCTYPE",true) && !svg.contains("<!ENTITY",true))
        val factory=DocumentBuilderFactory.newInstance().apply{
            isNamespaceAware=true
            isExpandEntityReferences=false
            setFeature("http://xml.org/sax/features/external-general-entities",false)
            setFeature("http://xml.org/sax/features/external-parameter-entities",false)
        }
        val doc=factory.newDocumentBuilder().parse(InputSource(StringReader(svg)))
        require(doc.documentElement.localName=="svg")
        for(e in elements(doc.documentElement)){
            require(e.localName !in setOf("script","foreignObject","image"))
            for(i in 0 until e.attributes.length){
                val a=e.attributes.item(i)
                require(!a.nodeName.startsWith("on",true))
                if((a.localName ?: a.nodeName) in setOf("href","src"))require(a.nodeValue.startsWith("#"))
            }
        }
        return doc
    }
    fun elements(root:Element):List<Element> = buildList{
        add(root)
        for(i in 0 until root.childNodes.length)(root.childNodes.item(i) as? Element)?.let{addAll(elements(it))}
    }
    fun serialize(doc:Document):String {
        val writer=StringWriter()
        TransformerFactory.newInstance().newTransformer().apply{
            setOutputProperty(OutputKeys.OMIT_XML_DECLARATION,"yes")
        }.transform(DOMSource(doc),StreamResult(writer))
        return writer.toString()
    }
}
