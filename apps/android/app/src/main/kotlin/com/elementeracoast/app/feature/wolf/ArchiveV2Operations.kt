package com.elementeracoast.app.feature.wolf

import com.elementeracoast.app.BuildConfig
import com.elementeracoast.app.core.local.*
import com.elementeracoast.app.core.network.CoastApiClient
import android.content.Context
import java.io.File
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*

/** Explicit target selection; never fall through from local mode to remote. */
internal class ArchiveV2Operations(private val api:CoastApiClient, private val context:Context, private val local:Boolean) {
    private val root=File(context.cacheDir,"coast-v2-work")
    private fun folder():File {
        require(root.isDirectory||root.mkdirs())
        return File(root,UUID.randomUUID().toString()).also { require(it.mkdir()) }
    }
    suspend fun export(progress:(Int,Long)->Unit):Pair<File,ArchiveV2Manifest> = withContext(Dispatchers.IO) {
        val dir=folder();val file=File(dir,"archive.zip")
        try {
            val manifest=if(local) {
                require(NativeWorkspace.isLocal)
                ArchiveV2Local.export(NativeWorkspace.persistence(context),BuildConfig.APPLICATION_ID,file)
            }else ArchiveV2NativeCollector.collectCloud(api,file,BuildConfig.APPLICATION_ID,progress)
            file to manifest
        }catch(e:Throwable){dir.deleteRecursively();throw e}
    }
    class Imported(val directory:File,val manifest:ArchiveV2Manifest,val stage:ArchiveV2Stage) {
        fun close(){directory.deleteRecursively()}
    }
    suspend fun open(uri:android.net.Uri):Imported=withContext(Dispatchers.IO) {
        val dir=folder();val file=File(dir,"import.zip")
        try{
            context.contentResolver.openInputStream(uri)?.use { input->
                file.outputStream().use { out->
                    val b=ByteArray(65536);var total=0L
                    while(true){val n=input.read(b);if(n<0)break;total+=n
                        require(total<=3L*1024*1024*1024+16L*1024*1024){"归档超过当前读取上限。"}
                        out.write(b,0,n)}
                }
            }?:error("无法读取归档。")
            val stage=ArchiveV2Stage(dir,"verified")
            val m=ArchiveV2ZipReader.stage(file,stage);file.delete()
            Imported(dir,m,stage)
        }catch(e:Throwable){dir.deleteRecursively();throw e}
    }
    fun localModules(m:ArchiveV2Manifest):Set<String> =
        if(local) m.modules.filter { it.coverage!="unavailable" && it.module in (if(m.workspace=="local")ArchiveV2Local.localModules else ArchiveV2Local.cloudModules) && (it.module!="daily"||m.workspace=="local"||m.applicationId==BuildConfig.APPLICATION_ID) && (it.module!="custom_instructions"||m.applicationId==BuildConfig.APPLICATION_ID) }.map { it.module }.toSet() else emptySet()
    suspend fun localRestore(input:Imported,modules:Set<String>,confirm:Boolean):JsonObject=withContext(Dispatchers.IO){
        require(local&&NativeWorkspace.isLocal)
        val report=ArchiveV2Local.restore(input.manifest,input.stage,modules,BuildConfig.APPLICATION_ID,NativeWorkspace.persistence(context),confirm)
        buildJsonObject{
            put("committed",confirm)
            report.counts.forEach { (key,value)->putJsonObject(key){put("ready",value.ready);put("existing",value.existing);put("conflicts",value.conflicts)} }
        }
    }
    fun cloudChats(m:ArchiveV2Manifest):List<String> =
        if(!local&&m.workspace=="backend"&&m.applicationId==BuildConfig.APPLICATION_ID) m.records.filter { it.module=="chat" }.map { it.id } else emptyList()
    data class Choice(val kind:String,val id:String,val title:String,val fromLocal:Boolean=false){
        val key get()=kind+":"+id
    }
    suspend fun cloudChoices(input:Imported):List<Choice> = withContext(Dispatchers.IO) {
        if(local||input.manifest.workspace !in setOf("backend","local"))return@withContext emptyList()
        val m=input.manifest;val objects=m.objects.associateBy { it.objectSha256 }
        buildList {
            for(r in m.records){
                if(m.workspace=="local"&&(r.module !in ArchiveV2Local.localModules||r.module=="custom_instructions"&&m.applicationId!=BuildConfig.APPLICATION_ID))continue
                if(m.workspace=="backend"&&!(r.module=="chat"&&m.applicationId==BuildConfig.APPLICATION_ID)&&!(r.module=="library"&&r.id.startsWith("library_books:"))&&r.module !in setOf("calendar","worldbook","model_profile")&&!(m.applicationId==BuildConfig.APPLICATION_ID&&r.module in setOf("memory_entries","memory_pockets","user_portrait","self_portrait","daily","vault","custom_instructions")))continue
                val d=objects.getValue(r.recordObject)
                if(d.size>1800000)continue
                val value=Json.parseToJsonElement(input.stage.verify(d,1800000).readText()).jsonObject
                val kind=value.getValue("kind").jsonPrimitive.content
                val data=value.getValue("data").jsonObject
                if(m.workspace=="local"){
                    val kinds=mapOf("local_chat" to "chat","local_calendar" to "calendar","local_moment" to "daily","local_diary" to "daily","local_daily_profile" to "daily","local_model_profile" to "model_profile","worldbook" to "worldbook","custom_instructions" to "custom_instructions")
                    if(kinds[kind]==r.module){val title=((data["conversation"] as? JsonObject)?.get("title")?.jsonPrimitive?.contentOrNull?:data["title"]?.jsonPrimitive?.contentOrNull?:data["text"]?.jsonPrimitive?.contentOrNull?:r.module).take(100);add(Choice(r.module,r.id,title,true))}
                    continue
                }
                if(r.module=="chat"&&kind=="chat"){
                    val c=data.getValue("conversation").jsonObject
                    if(c.getValue("id").jsonPrimitive.content==r.id)add(Choice("chat",r.id,c.getValue("title").jsonPrimitive.content))
                }else if(r.module=="library"&&kind=="library_books"){
                    val id=data.getValue("id").jsonPrimitive.content
                    val identity="library_books:"+ArchiveV2Chunks.digest(JsonArray(listOf(JsonPrimitive(id))).toString().encodeToByteArray())
                    if(r.id==identity&&Regex("[A-Za-z0-9_.:-]{1,160}").matches(id))add(Choice("book",id,data.getValue("title").jsonPrimitive.content))
                }else if(r.module in setOf("calendar","worldbook","model_profile","memory_entries","memory_pockets","user_portrait","self_portrait","custom_instructions")&&kind==r.module){
                    add(Choice(r.module,r.id,data["title"]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotBlank() }?:when(r.module){"custom_instructions"->"自定义指令";"user_portrait"->"用户画像及历史";"self_portrait"->"自我画像及历史";"memory_pockets"->"待确认候选";"memory_entries"->"记忆";else->"模型资料"}))
                }else if(m.applicationId==BuildConfig.APPLICATION_ID&&r.module=="daily"&&kind in setOf("daily_moments","daily_diaries","daily_profile")){
                    val title=if(kind=="daily_profile")"日常资料" else (data["date"]?.jsonPrimitive?.contentOrNull.orEmpty()+" · "+data["text"]?.jsonPrimitive?.contentOrNull.orEmpty()).take(80)
                    add(Choice("daily",r.id,title))
                }else if(m.applicationId==BuildConfig.APPLICATION_ID&&r.module=="vault"&&kind in setOf("vault_treasures","vault_media_labels")){
                    val title=(data["display_name"]?.jsonPrimitive?.contentOrNull?:data["excerpt"]?.jsonPrimitive?.contentOrNull?:data["source_id"]?.jsonPrimitive?.contentOrNull?:"拾潮").take(80)
                    add(Choice("vault",r.id,title))
                }
            }
        }
    }
    suspend fun createSession():String {
        require(!local)
        return api.archiveV2CreateSession().getValue("session").jsonObject.getValue("id").jsonPrimitive.content
    }
    suspend fun upload(input:Imported,session:String,progress:(Int)->Unit):JsonObject {
        require(!local)
        return ArchiveV2NativeCollector.upload(api,session,input.manifest,input.stage,progress)
    }
    suspend fun cloudRestore(input:Imported,session:String,choice:Choice,confirm:Boolean):JsonObject {
        require(!local&&choice in cloudChoices(input))
        return if(choice.kind=="book")api.archiveV2RestoreBook(session,input.manifest,choice.id,confirm)
            else if(choice.kind=="chat"&&!choice.fromLocal)api.archiveV2RestoreChat(session,input.manifest,choice.id,confirm)
            else api.archiveV2RestoreRecord(session,input.manifest,choice.kind,choice.id,confirm)
    }
    suspend fun cancelSession(session:String){require(!local);api.archiveV2CancelSession(session)}
}
