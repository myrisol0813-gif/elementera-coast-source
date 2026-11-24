package com.elementeracoast.app.core.local

import com.elementeracoast.app.ui.theme.*
import kotlinx.serialization.json.*
import java.io.File

/** Native-only appearance package. No raw paths, arbitrary preferences or
 * credentials are exported. Original assets are copied to immutable digest names. */
internal object ArchiveV2Appearance {
    const val MODULE="appearance"
    const val ID="native-appearance"
    private const val ROOT="wolf."
    private const val ABSENT="\u0000absent"
    private val fields=setOf("themePreset","bubble","accent","fontMode","paperMode","cloudOutlineEnabled","readingWeight","messageSurfaceAlpha","chatBackgroundName","chatBackgroundDimAlpha","localFontName")
    private val pathFields=mapOf("background" to "chatBackgroundPath","font" to "localFontPath")
    private val dirs=mapOf("background" to setOf("chat-background","chat-background-local","coast-appearance-local"),"font" to setOf("local-fonts","local-fonts-local","coast-appearance-local"))
    private val formats=mapOf("background" to setOf("png","jpg","webp"),"font" to setOf("ttf","otf"))
    private val max=mapOf("background" to 12L*1024*1024,"font" to 16L*1024*1024)
    data class Original(val role:String,val format:String,val bytes:ByteArray){
        val sha get()=ArchiveV2Chunks.digest(bytes)
    }
    data class Snapshot(val settings:JsonObject,val originals:List<Original>){
        fun data()=buildJsonObject{put("settings",settings);put("files",JsonArray(originals.map{v->buildJsonObject{put("role",v.role);put("format",v.format);put("size",v.bytes.size);put("sha256",v.sha)}}))}
    }
    private fun JsonObject.str(k:String):String{val v=getValue(k);require(v is JsonPrimitive&&v.isString);return v.content}
    private fun stored(store:LocalPersistence)=buildJsonObject{
        for(k in fields){val v=store.get(ROOT+k,ABSENT);if(v!=ABSENT)put(k,v)}
    }
    private fun checkSettings(v:JsonObject){
        require(v.keys.all{it in fields})
        for(k in v.keys){
            val s=v.str(k)
            when(k){
                "themePreset"->require(CoastThemePreset.entries.any{it.name==s})
                "fontMode"->require(CoastFontMode.entries.any{it.name==s})
                "paperMode"->require(CoastPaperMode.entries.any{it.name==s})
                "readingWeight"->require(CoastReadingWeight.entries.any{it.name==s})
                "bubble","accent"->require(s.isEmpty()||Regex("#[0-9a-fA-F]{6}").matches(s))
                "cloudOutlineEnabled"->require(s in setOf("true","false"))
                "messageSurfaceAlpha"->require(s.toFloatOrNull()?.let{it in .55f..1f}==true)
                "chatBackgroundDimAlpha"->require(s.toFloatOrNull()?.let{it in 0f.. .65f}==true)
                "chatBackgroundName","localFontName"->require(s.length<=120)
            }
        }
    }
    private fun validateOriginal(o:Original){
        require(o.role in pathFields&&o.format in formats.getValue(o.role)&&o.bytes.size.toLong() in 1..max.getValue(o.role))
        val b=o.bytes;fun sig(offset:Int,vararg v:Int)=b.size>=offset+v.size&&v.indices.all{(b[offset+it].toInt() and 255)==v[it]}
        val valid=when(o.format){
            "png"->sig(0,137,80,78,71,13,10,26,10)
            "jpg"->sig(0,255,216,255)
            "webp"->sig(0,82,73,70,70)&&sig(8,87,69,66,80)
            "ttf"->sig(0,0,1,0,0)||sig(0,116,114,117,101)
            "otf"->sig(0,79,84,84,79)
            else->false
        }
        require(valid){"外观原件格式不正确。"}
    }
    private fun validate(v:Snapshot){
        checkSettings(v.settings)
        require(v.originals.map{it.role}.distinct().size==v.originals.size)
        v.originals.forEach(::validateOriginal)
        require(v.settings["fontMode"]!=JsonPrimitive("CustomLocal")||v.originals.any{it.role=="font"}){"自定义字体缺少原件。"}
    }
    fun capture(store:LocalPersistence,root:File):Snapshot{
        val assets=pathFields.mapNotNull{(role,key)->
            val raw=store.get(ROOT+key);if(raw.isEmpty())return@mapNotNull null
            val file=File(raw).canonicalFile
            require(dirs.getValue(role).any{file.parentFile==File(root,it).canonicalFile}&&file.isFile&&file.length() in 1..max.getValue(role)){"外观原件缺失或位于不允许的目录。"}
            Original(role,file.extension.lowercase(),file.readBytes())
        }
        return Snapshot(stored(store),assets).also(::validate)
    }
    fun read(m:ArchiveV2Manifest,stage:ArchiveV2Stage,selection:Set<String>):Snapshot?{
        if(MODULE !in selection)return null
        require(m.workspace=="local"){"外观只支持本机归档。"}
        val rows=m.records.filter{it.module==MODULE};require(rows.size<=1)
        val r=rows.singleOrNull()?:return null
        require(r.id==ID&&r.dependencies.isEmpty())
        val objects=m.objects.associateBy{it.objectSha256}
        val raw=Json.parseToJsonElement(stage.verify(objects.getValue(r.recordObject),1800000).readBytes().decodeToString(throwOnInvalidSequence=true)).jsonObject
        require(raw.keys==setOf("kind","data")&&raw.str("kind")==MODULE)
        val data=raw.getValue("data").jsonObject;require(data.keys==setOf("settings","files"))
        val files=data.getValue("files").jsonArray;require(files.size==r.mediaObjects.size&&files.size<=2)
        val assets=files.mapIndexed{i,f->
            val row=f.jsonObject;require(row.keys==setOf("role","format","size","sha256"))
            val role=row.str("role");val d=objects.getValue(r.mediaObjects[i]);require(row.getValue("size").jsonPrimitive.long==d.size)
            val b=stage.verify(d,max.getValue(role)).readBytes()
            Original(role,row.str("format"),b).also{require(it.sha==row.str("sha256"))}
        }
        return Snapshot(data.getValue("settings").jsonObject,assets).also(::validate)
    }
    fun apply(v:Snapshot?,store:LocalPersistence,root:File,write:Boolean):LocalRestoreCount{
        if(v==null)return LocalRestoreCount(0,0,0)
        validate(v)
        val old=capture(store,root)
        val same=old.settings==v.settings&&old.originals.map{it.role to it.sha}==v.originals.map{it.role to it.sha}
        if(same)return LocalRestoreCount(0,1,0)
        // This explicit module selection restores device appearance only. Existing
        // original files remain untouched; the settings pointer switches in the archive transaction.
        if(write){
            val dir=File(root,"coast-appearance-local")
            require(dir.isDirectory||dir.mkdirs())
            require(dir.canonicalFile.parentFile==root.canonicalFile)
            val paths=v.originals.associate{a->
                val file=File(dir,a.role+"-"+a.sha+"."+a.format)
                require(file.canonicalFile.parentFile==dir.canonicalFile)
                if(!file.exists()){
                    val temp=File.createTempFile("original-",".tmp",dir)
                    try{temp.outputStream().use{it.write(a.bytes);it.fd.sync()};require(!file.exists()&&temp.renameTo(file))}finally{temp.delete()}
                }
                require(file.readBytes().contentEquals(a.bytes)){"外观原件校验失败。"}
                a.role to file.absolutePath
            }
            for(k in fields){val value=v.settings[k];if(value==null)store.remove(ROOT+k)else store.put(ROOT+k,value.jsonPrimitive.content)}
            for((role,k) in pathFields)store.put(ROOT+k,paths[role].orEmpty())
            val check=capture(store,root)
            require(check.settings==v.settings&&check.originals.map{it.role to it.sha}==v.originals.map{it.role to it.sha})
        }
        return LocalRestoreCount(1,0,if(old.settings.isNotEmpty()||old.originals.isNotEmpty())1 else 0)
    }
}
