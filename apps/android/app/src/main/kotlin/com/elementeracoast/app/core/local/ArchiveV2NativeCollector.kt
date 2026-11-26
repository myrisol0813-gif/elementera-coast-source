package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.network.CoastApiClient
import java.io.File
import java.io.ByteArrayInputStream
import java.time.Instant
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.ensureActive
import kotlinx.serialization.json.*
import kotlin.coroutines.coroutineContext

/** Native cloud collector uses the same record kinds and keys as the browser.
 * A failed export deletes its temporary output; the caller publishes only success. */
object ArchiveV2NativeCollector {
    private val json=Json { ignoreUnknownKeys=true }
    private val chunk=ArchiveV2Chunks.CHUNK_BYTES
    private val keys=mapOf(
        "thinking_soil" to listOf("conversation_id"),
        "thinking_soil_history" to listOf("conversation_id","assistant_message_id"),
        "daily_likes" to listOf("moment_id","actor"),
        "library_chapters" to listOf("book_id","chapter_index"),
        "library_progress" to listOf("book_id","author"),
        "library_reading_logs" to listOf("book_id","author","day"),
        "library_covers" to listOf("book_id"),
        "vault_media_labels" to listOf("source_key"))
    private fun JsonObject.string(k:String)=getValue(k).jsonPrimitive.content
    private fun JsonObject.optional(k:String)=(get(k) as? JsonPrimitive)?.contentOrNull
    private fun detailId(kind:String,row:JsonObject):String {
        val key=JsonArray((keys[kind]?:listOf("id")).map { requireNotNull(row[it]).also { v->require(v!=JsonNull) } })
        return kind+":"+ArchiveV2Chunks.digest(key.toString().encodeToByteArray())
    }
    private fun chatLinks(row:JsonObject)=row.optional("conversation_id")?.let { listOf("chat/"+it) }?:emptyList()
    private fun describe(bytes:ByteArray):ArchiveV2Object {
        val hashes=(bytes.indices step chunk).map { ArchiveV2Chunks.digest(bytes.copyOfRange(it,minOf(it+chunk,bytes.size))) }
        return ArchiveV2Object(bytes.size.toLong(),hashes,ArchiveV2Chunks.fingerprint(bytes.size.toLong(),hashes))
    }
    private suspend fun pages(read:suspend(String)->JsonObject,consume:suspend(JsonObject)->Unit) {
        var cursor="";val seen=mutableSetOf<String>()
        do {
            coroutineContext.ensureActive()
            val page=read(cursor);for(row in page.getValue("items").jsonArray){coroutineContext.ensureActive();consume(row.jsonObject)}
            val next=page.optional("next_cursor")?:break
            require(seen.add(next)){"归档分页重复。"};cursor=next
        }while(true)
    }
    suspend fun collectCloud(api:CoastApiClient,output:File,applicationId:String,onProgress:(Int,Long)->Unit={_,_->}):ArchiveV2Manifest=withContext(Dispatchers.IO) {
        require(!output.exists()&&output.parentFile?.isDirectory==true)
        try {
            val caps=api.archiveV2Capabilities()
            val available=linkedSetOf<String>();val records=mutableListOf<ArchiveV2Record>();val objects=linkedMapOf<String,ArchiveV2Object>();val ids=mutableSetOf<String>()
            var bytes=0L
            ArchiveV2ZipWriter(output.outputStream()).use { writer->
                fun write(d:ArchiveV2Object,input:java.io.InputStream):String {
                    if(d.objectSha256 !in objects){
                        require(objects.size<8192&&d.size<=3L*1024*1024*1024-bytes)
                        writer.objectEntry(d,input);objects[d.objectSha256]=d;bytes+=d.size
                    }else require(objects[d.objectSha256]==d)
                    return d.objectSha256
                }
                suspend fun media(item:JsonObject,read:suspend(ArchiveV2Object,Int)->ByteArray):String {
                    val d=json.decodeFromJsonElement(ArchiveV2Object.serializer(),item.getValue("descriptor"))
                    ArchiveV2Chunks.validate(d,3L*1024*1024*1024)
                    if(d.objectSha256 in objects){require(objects[d.objectSha256]==d);return d.objectSha256}
                    require(d.size<=3L*1024*1024*1024-bytes)
                    val temp=File.createTempFile("archive-object-", ".part",output.parentFile)
                    try{
                        require(d.size<=temp.usableSpace)
                        temp.outputStream().use { out->
                            for(i in d.chunks.indices){coroutineContext.ensureActive();val b=read(d,i);require(b.size.toLong()==minOf(chunk.toLong(),d.size-i.toLong()*chunk)&&ArchiveV2Chunks.digest(b)==d.chunks[i]);out.write(b)}
                        }
                        return temp.inputStream().use { write(d,it) }
                    }finally{temp.delete()}
                }
                fun record(module:String,id:String,kind:String,data:JsonObject,deps:List<String> = emptyList(),media:List<String> = emptyList()){
                    require(ids.add(module+"/"+id));available.add(module)
                    val raw=buildJsonObject { put("kind",kind);put("data",data) }.toString().encodeToByteArray()
                    val d=describe(raw);val h=ByteArrayInputStream(raw).use { write(d,it) }
                    records.add(ArchiveV2Record(module,id,h,media,deps.distinct()));onProgress(records.size,bytes)
                }
                for(m in caps.getValue("record_modules").jsonArray.map { it.jsonPrimitive.content }){
                    available.add(m)
                    pages({api.archiveV2RecordPage(m,it)}){row->
                        val id=row.string("id")
                        when(m){
                            "chat"->{val c=api.archiveV2Chat(id);record(m,id,m,JsonObject(c.filterKeys { it in setOf("conversation","history_json","history_updated_at") }))}
                            "voice"->{val item=api.archiveV2Voice(id);val meta=item.getValue("metadata").jsonObject;val h=media(item){d,i->api.archiveV2VoiceChunk(id,d,i)};record(m,id,m,meta,chatLinks(meta),listOf(h))}
                            else->record(m,id,m,row,chatLinks(row))
                        }
                    }
                }
                available.add("attachments")
                pages({api.archiveV2AttachmentPage(it)}){row->
                    val id=row.string("id");val c=row.string("conversation_id");val item=api.archiveV2Attachment(c,id)
                    val meta=item.getValue("metadata").jsonObject;val h=media(item){d,i->api.archiveV2AttachmentChunk(c,id,d,i)}
                    record("attachments",id,"attachment",meta,chatLinks(meta),listOf(h))
                }
                for(kind in listOf("records","snapshots")){
                    val m="dogtalk_"+kind;available.add(m)
                    pages({api.archiveV2DogtalkPage(kind,it)}){row->record(m,row.string("id"),m,row,chatLinks(row)+(if(kind=="snapshots")listOf("dogtalk_records/"+row.string("dogtalk_id")) else emptyList()))}
                }
                for((kind,v) in caps.getValue("detail_modules").jsonObject){
                    val m=v.jsonPrimitive.content;available.add(m)
                    pages({api.archiveV2DetailPage(kind,it)}){row->
                        val deps=chatLinks(row).toMutableList()
                        if(kind=="vault_stickers")deps.add("attachments/"+row.string("attachment_id"))
                        if(kind.startsWith("library_")&&kind!="library_books")deps.add("library/"+detailId("library_books",buildJsonObject { put("id",row.getValue("book_id")) }))
                        if(kind=="daily_comments"||kind=="daily_likes")deps.add("daily/"+detailId("daily_moments",buildJsonObject { put("id",row.getValue("moment_id")) }))
                        val id=detailId(kind,row)
                        if(kind=="library_covers"){val book=row.string("book_id");val item=api.archiveV2LibraryCover(book);val h=media(item){d,i->api.archiveV2LibraryCoverChunk(book,d,i)};record(m,id,kind,item.getValue("metadata").jsonObject,deps,listOf(h))}
                        else record(m,id,kind,row,deps)
                    }
                }
                val counts=records.groupingBy { it.module }.eachCount()
                val manifest=ArchiveV2Manifest("elementera-coast-archive",2,"backend",applicationId,Instant.now().toString(),
                    ArchiveV2Manifests.modules.map { ArchiveV2Coverage(it,if(it in available)"partial" else "unavailable",counts[it]?:0) },records,objects.values.toList())
                ArchiveV2Manifests.validate(manifest);api.archiveV2ValidateManifest(manifest);writer.finish(manifest)
                manifest
            }
        }catch(e:Throwable){output.delete();throw e}
    }
    /** Resume an existing cloud staging session. Re-verify every local object,
     * only upload missing chunks. No live restore here. */
    suspend fun upload(api:CoastApiClient,session:String,manifest:ArchiveV2Manifest,stage:ArchiveV2Stage,onProgress:(Int)->Unit={}):JsonObject=withContext(Dispatchers.IO){
        ArchiveV2Manifests.validate(manifest);var uploaded=0
        for(d in manifest.objects){
            coroutineContext.ensureActive()
            val file=stage.verify(d,3L*1024*1024*1024)
            api.archiveV2RegisterObject(session,d)
            val received=api.archiveV2ObjectStatus(session,d.objectSha256).getValue("received").jsonArray.map { it.jsonPrimitive.int }.toSet()
            file.inputStream().use { input->
                for(i in d.chunks.indices){
                    coroutineContext.ensureActive()
                    val b=ByteArray(minOf(chunk.toLong(),d.size-i.toLong()*chunk).toInt());var at=0
                    while(at<b.size){val n=input.read(b,at,b.size-at);require(n>0);at+=n}
                    require(ArchiveV2Chunks.digest(b)==d.chunks[i])
                    if(i !in received){api.archiveV2PutChunk(session,d.objectSha256,i,b);onProgress(++uploaded)}
                }
                require(input.read()==-1)
            }
        }
        api.archiveV2Preflight(session,manifest)
    }
}
