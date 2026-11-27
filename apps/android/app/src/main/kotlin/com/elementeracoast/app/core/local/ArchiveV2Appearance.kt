package com.elementeracoast.app.core.local

import com.elementeracoast.app.ui.theme.*
import kotlinx.serialization.json.*
import java.io.File

/** Native-only appearance package. No raw paths, arbitrary preferences or
 * credentials are exported. Original assets are copied to immutable digest names. */
internal object ArchiveV2Appearance {
    const val MODULE="appearance"
    const val ID="native-appearance"
    const val DEVICE_ID="device-basic-settings"
    private const val ROOT="wolf."
    private const val ABSENT="\u0000absent"
    private val fields=setOf("themePreset","bubble","accent","fontMode","paperMode","cloudOutlineEnabled","readingWeight","messageSurfaceAlpha","chatBackgroundName","chatBackgroundDimAlpha","localFontName")
    private val basicDefaults=mapOf("recentTurns" to "8","contextBudget" to "6000","outputLength" to "auto","maxOutputTokens" to "8000",
        "creativity" to "balanced","streamingEnabled" to "true","soilBudget" to "1800","seedCooldownTurns" to "2",
        "worldbookEnabled" to "true","worldbookLimit" to "3","memoryLimit" to "8","toolCallLimit" to "24",
        "replySequenceMaxMessages" to "3","replySequenceToolBudget" to "24","replySequenceTokenBudget" to "48000")
    private val basicRanges=mapOf("recentTurns" to 1..Int.MAX_VALUE,"maxOutputTokens" to 64..65536,"soilBudget" to 300..4000,
        "seedCooldownTurns" to 0..8,"worldbookLimit" to 0..6,"memoryLimit" to 0..12,"toolCallLimit" to 1..128,
        "replySequenceMaxMessages" to 1..20,"replySequenceToolBudget" to 0..128,"replySequenceTokenBudget" to 1..1000000)
    private fun validBasic(k:String,s:String):Boolean=when(k){
        "contextBudget"->s.toIntOrNull()?.let{it==0||it>=1800}==true
        "outputLength"->s in setOf("auto","short","long")
        "creativity"->s in setOf("stable","balanced","expansive")
        "streamingEnabled","worldbookEnabled"->s in setOf("true","false")
        else->s.toIntOrNull()?.let{it in basicRanges.getValue(k)}==true
    }
    fun basic(store:LocalPersistence)=buildJsonObject{
        for((k,d) in basicDefaults){val v=store.get(ROOT+k,d);put(k,if(validBasic(k,v))v else d)}
    }
    private fun checkBasic(v:JsonObject){
        require(v.keys==basicDefaults.keys&&v.keys.all{validBasic(it,v.str(it))}){"归档基本设置不合法。"}
    }
    private val pathFields=mapOf("background" to "chatBackgroundPath","font" to "localFontPath")
    private val dirs=mapOf("background" to setOf("chat-background","chat-background-local","coast-appearance-local"),"font" to setOf("local-fonts","local-fonts-local","coast-appearance-local"))
    private val formats=mapOf("background" to setOf("png","jpg","webp"),"font" to setOf("ttf","otf"))
    private val max=mapOf("background" to 12L*1024*1024,"font" to 16L*1024*1024)
    data class Original(val role:String,val format:String,val bytes:ByteArray){
        val sha get()=ArchiveV2Chunks.digest(bytes)
    }
    data class Snapshot(val settings:JsonObject,val originals:List<Original>,val basicSettings:JsonObject?=null,val basicOnly:Boolean=false){
        fun data()=buildJsonObject{put("settings",settings);put("files",JsonArray(originals.map{v->buildJsonObject{put("role",v.role);put("format",v.format);put("size",v.bytes.size);put("sha256",v.sha)}}));basicSettings?.let{put("basic_settings",it)}}
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
        v.basicSettings?.let(::checkBasic)
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
        return Snapshot(stored(store),assets,basic(store)).also(::validate)
    }
    fun read(m:ArchiveV2Manifest,stage:ArchiveV2Stage,selection:Set<String>):Snapshot?{
        if(MODULE !in selection)return null
        val rows=m.records.filter{it.module==MODULE};require(rows.size<=1)
        val r=rows.singleOrNull()?:return null
        require(r.dependencies.isEmpty())
        if(r.id==DEVICE_ID){
            require(m.workspace=="backend")
            return Snapshot(JsonObject(emptyMap()),emptyList(),requireNotNull(readDeviceBasic(m,stage)),true)
        }
        require(m.workspace=="local"&&r.id==ID)
        val objects=m.objects.associateBy{it.objectSha256}
        val raw=Json.parseToJsonElement(stage.verify(objects.getValue(r.recordObject),1800000).readBytes().decodeToString(throwOnInvalidSequence=true)).jsonObject
        require(raw.keys==setOf("kind","data")&&raw.str("kind")==MODULE)
        val data=raw.getValue("data").jsonObject;require(data.keys.containsAll(setOf("settings","files"))&&data.keys.all{it in setOf("settings","files","basic_settings","rest_studio")})
        val files=data.getValue("files").jsonArray;require(files.size==r.mediaObjects.size&&files.size<=2)
        val assets=files.mapIndexed{i,f->
            val row=f.jsonObject;require(row.keys==setOf("role","format","size","sha256"))
            val role=row.str("role");val d=objects.getValue(r.mediaObjects[i]);require(row.getValue("size").jsonPrimitive.long==d.size)
            val b=stage.verify(d,max.getValue(role)).readBytes()
            Original(role,row.str("format"),b).also{require(it.sha==row.str("sha256"))}
        }
        return Snapshot(data.getValue("settings").jsonObject,assets,data["basic_settings"]?.jsonObject).also(::validate)
    }
    /** Read only the portable basic settings; never interpret an empty appearance as deletion. */
    fun readDeviceBasic(m:ArchiveV2Manifest,stage:ArchiveV2Stage):JsonObject? {
        val rows=m.records.filter{it.module==MODULE}
        require(rows.size<=1)
        val r=rows.singleOrNull()?:return null
        require(r.dependencies.isEmpty())
        val raw=Json.parseToJsonElement(stage.verify(m.objects.single{it.objectSha256==r.recordObject},1800000).readBytes().decodeToString(throwOnInvalidSequence=true)).jsonObject
        require(raw.keys==setOf("kind","data"))
        val data=raw.getValue("data").jsonObject
        when(r.id){
            DEVICE_ID->require(m.workspace=="backend"&&raw.str("kind")=="device_basic_settings"&&r.mediaObjects.isEmpty()&&data.keys.contains("basic_settings")&&data.keys.all{it in setOf("basic_settings","rest_studio")})
            ID->require(m.workspace=="local"&&raw.str("kind")==MODULE&&data.keys.containsAll(setOf("settings","files"))&&data.keys.all{it in setOf("settings","files","basic_settings","rest_studio")})
            else->error("未知设备设置记录。")
        }
        return data["basic_settings"]?.jsonObject?.also(::checkBasic)
    }
    fun applyBasic(values:JsonObject,store:LocalPersistence,write:Boolean):LocalRestoreCount {
        checkBasic(values)
        if(basic(store)==values)return LocalRestoreCount(0,1,0)
        if(write){
            val fields=values.mapKeys{ROOT+it.key}.mapValues{it.value.jsonPrimitive.content}
            if(store is SharedPreferencesLocalPersistence)store.putDeviceSettings(fields)
            else fields.forEach{(k,v)->store.put(k,v)}
            require(basic(store)==values){"基本设置保存未确认。"}
        }
        return LocalRestoreCount(1,0,1)
    }
    fun apply(v:Snapshot?,store:LocalPersistence,root:File,write:Boolean):LocalRestoreCount{
        if(v==null)return LocalRestoreCount(0,0,0)
        validate(v)
        if(v.basicOnly)return applyBasic(requireNotNull(v.basicSettings),store,write)
        val old=capture(store,root)
        val same=old.settings==v.settings&&old.originals.map{it.role to it.sha}==v.originals.map{it.role to it.sha}&&(v.basicSettings==null||old.basicSettings==v.basicSettings)
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
            // Old archives have no basic_settings: never reset device defaults
            // from missing fields. Only the explicitly allowlisted values move.
            v.basicSettings?.forEach{(k,value)->store.put(ROOT+k,value.jsonPrimitive.content)}
            val check=capture(store,root)
            require(check.settings==v.settings&&check.originals.map{it.role to it.sha}==v.originals.map{it.role to it.sha}&&(v.basicSettings==null||check.basicSettings==v.basicSettings))
        }
        return LocalRestoreCount(1,0,if(old.settings.isNotEmpty()||old.originals.isNotEmpty()||v.basicSettings!=null&&old.basicSettings!=v.basicSettings)1 else 0)
    }
}
