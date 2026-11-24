package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.remote.RemoteCacheStore
import java.io.File
import java.io.ByteArrayInputStream
import kotlinx.serialization.json.*

/** Local mode has only the four implemented V1 modules. Package them as
 * independent objects in V2, without reading provider/auth keys or inventing
 * storage for unavailable modules. Restoration uses the existing atomic store. */
internal object ArchiveV2Local {
    private val json=Json { ignoreUnknownKeys=false }
    private val modules=CoastTransferCodec.supportedModules
    val localModules=modules+ArchiveV2Knowledge.modules
    val cloudModules get()=ArchiveV2CloudToLocal.supportedModules+ArchiveV2Knowledge.modules
    private fun describe(bytes:ByteArray):ArchiveV2Object {
        val chunk=ArchiveV2Chunks.CHUNK_BYTES
        val hashes=(bytes.indices step chunk).map { ArchiveV2Chunks.digest(bytes.copyOfRange(it,minOf(it+chunk,bytes.size))) }
        return ArchiveV2Object(bytes.size.toLong(),hashes,ArchiveV2Chunks.fingerprint(bytes.size.toLong(),hashes))
    }
    fun export(store:LocalPersistence,applicationId:String,output:File):ArchiveV2Manifest = store.readConsistent { stable -> exportStable(stable,applicationId,output) }
    private fun exportStable(store:LocalPersistence,applicationId:String,output:File):ArchiveV2Manifest {
        require(!output.exists()&&output.parentFile?.isDirectory==true)
        val payload=CoastTransferCodec.decode(LocalBackupArchive.encode(LocalBackupArchive.capture(store,applicationId)))
        val records=mutableListOf<ArchiveV2Record>();val objects=linkedMapOf<String,ArchiveV2Object>()
        try {
            ArchiveV2ZipWriter(output.outputStream()).use { writer->
                fun add(module:String,id:String,kind:String,data:JsonElement) {
                    require(data!=JsonNull)
                    val raw=buildJsonObject { put("kind",kind);put("data",data) }.toString().encodeToByteArray()
                    val d=describe(raw)
                    ByteArrayInputStream(raw).use { writer.objectEntry(d,it) }
                    val dependencies=if(module in setOf("calendar","daily")+LocalMemoryStore.modules)data.jsonObject["conversation_id"]?.jsonPrimitive?.contentOrNull?.let { listOf("chat/"+it) }?:emptyList() else emptyList()
                    objects[d.objectSha256]=d;records.add(ArchiveV2Record(module,id,d.objectSha256,emptyList(),dependencies))
                }
                fun list(module:String,field:String,kind:String,id:(JsonObject)->String) {
                    for(row in payload.getValue(field).jsonArray.map { it.jsonObject })add(module,id(row),kind,row)
                }
                list("chat","conversations","local_chat"){it.getValue("conversation").jsonObject.getValue("id").jsonPrimitive.content}
                list("calendar","calendar","local_calendar"){it.getValue("id").jsonPrimitive.content}
                list("daily","moments","local_moment"){"moment:"+it.getValue("id").jsonPrimitive.content}
                list("daily","diaries","local_diary"){"diary:"+it.getValue("id").jsonPrimitive.content}
                payload["profile"]?.takeIf { it!=JsonNull }?.let { add("model_profile","owner","local_model_profile",it) }
                payload["dailyProfile"]?.takeIf { it!=JsonNull }?.let { add("daily","profile","local_daily_profile",it) }
                ArchiveV2Knowledge.export(store).forEach{add(it.module,it.id,it.kind,it.data)}
                val counts=records.groupingBy { it.module }.eachCount()
                val manifest=ArchiveV2Manifest("elementera-coast-archive",2,"local",applicationId,payload.getValue("exportedAt").jsonPrimitive.content,
                    ArchiveV2Manifests.modules.map { ArchiveV2Coverage(it,if(it in localModules)"partial" else "unavailable",counts[it]?:0) },records,objects.values.toList())
                ArchiveV2Manifests.validate(manifest);writer.finish(manifest);return manifest
            }
        }catch(e:Throwable){output.delete();throw e}
    }
    private fun bundle(manifest:ArchiveV2Manifest,stage:ArchiveV2Stage,selection:Set<String>):ByteArray {
        ArchiveV2Manifests.validate(manifest)
        require(manifest.workspace=="local"&&selection.isNotEmpty()&&modules.containsAll(selection))
        require(selection.all { name->manifest.modules.any { it.module==name&&it.coverage!="unavailable" } })
        val byHash=manifest.objects.associateBy { it.objectSha256 }
        val chosen=manifest.records.filter { it.module in selection }
        require(chosen.sumOf { byHash.getValue(it.recordObject).size }<=CoastTransferCodec.MAX_BYTES){"当前本机恢复事务最多 64 MiB，未截断或写入。"}
        val chat=mutableListOf<JsonElement>();val calendar=mutableListOf<JsonElement>();val moments=mutableListOf<JsonElement>();val diaries=mutableListOf<JsonElement>()
        var profile:JsonElement=JsonNull;var daily:JsonElement=JsonNull
        fun id(v:JsonElement)=v.jsonObject.getValue("id").jsonPrimitive.content
        for(r in chosen){
            require(r.mediaObjects.isEmpty()&&(r.module in setOf("calendar","daily")||r.dependencies.isEmpty()))
            val d=byHash.getValue(r.recordObject)
            val raw=stage.verify(d,CoastTransferCodec.MAX_BYTES.toLong()).readBytes().decodeToString(throwOnInvalidSequence=true)
            val value=json.parseToJsonElement(raw).jsonObject
            require(value.keys==setOf("kind","data"))
            val data=value.getValue("data");require(data is JsonObject)
            val kind=value.getValue("kind").jsonPrimitive.content
            if(kind in setOf("local_calendar","local_moment","local_diary")){
                val parent=data["conversation_id"]?.jsonPrimitive?.contentOrNull
                require(r.dependencies==if(parent==null)emptyList() else listOf("chat/"+parent))
            }else require(r.dependencies.isEmpty())
            when(kind){
                "local_chat"->{require(r.module=="chat"&&id(data.getValue("conversation"))==r.id);chat.add(data)}
                "local_calendar"->{
                    require(r.module=="calendar"&&id(data)==r.id)
                    calendar.add(data)
                }
                "local_moment"->{require(r.module=="daily"&&"moment:"+id(data)==r.id);moments.add(data)}
                "local_diary"->{require(r.module=="daily"&&"diary:"+id(data)==r.id);diaries.add(data)}
                "local_daily_profile"->{require(r.module=="daily"&&r.id=="profile"&&daily==JsonNull);daily=data}
                "local_model_profile"->{require(r.module=="model_profile"&&r.id=="owner"&&profile==JsonNull);profile=data}
                else->error("目标本机暂不支持此归档记录，未写入。")
            }
        }
        return CoastTransferCodec.encode(buildJsonObject {
            put("applicationId",manifest.applicationId);put("workspace","local");put("exportedAt",manifest.exportedAt)
            put("includedModules",JsonArray(selection.sorted().map(::JsonPrimitive)))
            put("conversations",JsonArray(chat));put("calendar",JsonArray(calendar));put("moments",JsonArray(moments));put("diaries",JsonArray(diaries));put("profile",profile);put("dailyProfile",daily)
        })
    }
    fun restore(manifest:ArchiveV2Manifest,stage:ArchiveV2Stage,selection:Set<String>,applicationId:String,store:LocalPersistence,confirm:Boolean):LocalRestorePreview {
        require(manifest.workspace!="backend"||"daily" !in selection||manifest.applicationId==applicationId){"日常云端原始记录暂需同版本恢复；本机便携归档仍可跨版本。"}
        ArchiveV2Manifests.validate(manifest)
        require(selection.isNotEmpty()&&(if(manifest.workspace=="local")localModules else cloudModules).containsAll(selection))
        require(selection.all { name->manifest.modules.any { it.module==name&&it.coverage!="unavailable" } })
        val objects=manifest.objects.associateBy{it.objectSha256}
        require(manifest.records.filter{it.module in selection}.sumOf{objects.getValue(it.recordObject).size}<=CoastTransferCodec.MAX_BYTES){"本机恢复事务最多64 MiB。"}
        val extra=selection.intersect(ArchiveV2Knowledge.modules)
        val base=selection-extra
        val rows=ArchiveV2Knowledge.read(manifest,stage,extra,applicationId)
        val bytes=if(base.isEmpty())null else if(manifest.workspace=="backend")ArchiveV2CloudToLocal.convert(manifest,stage,base,selection) else bundle(manifest,stage,base)
        fun run(target:LocalPersistence,write:Boolean):LocalRestorePreview{
            val parents=bytes?.let{LocalTransferRestore.plannedParents(it,applicationId,base,target)}
            val existing=RemoteCacheStore(target,strictReads=true).conversations().map{it.id}.toSet()
            val report=bytes?.let{if(write)LocalTransferRestore.restoreStaged(it,applicationId,base,target) else LocalTransferRestore.preview(it,applicationId,base,target)}
            val extras=ArchiveV2Knowledge.apply(rows,extra,target,write,parents?.first?:existing,parents?.second.orEmpty())
            return LocalRestorePreview(manifest.workspace,report?.counts.orEmpty()+extras,report?.unsupportedModules.orEmpty())
        }
        return if(confirm)store.atomic{run(it,true)}else store.readConsistent{run(it,false)}
    }
}
