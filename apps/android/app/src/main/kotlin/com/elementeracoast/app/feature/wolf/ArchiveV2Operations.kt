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
        if(local&&m.workspace=="local") m.modules.filter { it.coverage!="unavailable" && it.module in CoastTransferCodec.supportedModules }.map { it.module }.toSet() else emptySet()
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
    suspend fun createSession():String {
        require(!local)
        return api.archiveV2CreateSession().getValue("session").jsonObject.getValue("id").jsonPrimitive.content
    }
    suspend fun upload(input:Imported,session:String,progress:(Int)->Unit):JsonObject {
        require(!local)
        return ArchiveV2NativeCollector.upload(api,session,input.manifest,input.stage,progress)
    }
    suspend fun cloudRestore(input:Imported,session:String,id:String,confirm:Boolean):JsonObject {
        require(!local&&id in cloudChats(input.manifest))
        return api.archiveV2RestoreChat(session,input.manifest,id,confirm)
    }
    suspend fun cancelSession(session:String){require(!local);api.archiveV2CancelSession(session)}
}
