package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.remote.*
import kotlinx.serialization.json.*
import java.io.File

/** Verified attachment originals, stored as binary generation members, never as paths
 * from another device or base64 in the JSON database. */
internal class LocalAttachmentStore(private val store:LocalPersistence){
    data class Original(val metadata:JsonObject,val digest:String)
    fun entries():List<Original>{
        val raw=store.get(INDEX)
        if(raw.isEmpty())return emptyList()
        return Json.parseToJsonElement(raw).jsonArray.map{value->
            val r=value.jsonObject;require(r.keys==setOf("metadata","sha256"))
            Original(r.getValue("metadata").jsonObject,r.str("sha256")).also{validate(it.metadata);require(hex.matches(it.digest))}
        }.also{require(it.map{x->x.metadata.str("id")}.distinct().size==it.size)}
    }
    fun bytes(original:Original):ByteArray{
        val data=requireNotNull(store.getBinary(key(original.metadata.str("id")))){"附件原件缺失。"}
        require(data.size.toLong()==original.metadata.getValue("size").jsonPrimitive.long&&ArchiveV2Chunks.digest(data)==original.digest){"附件原件校验失败。"}
        return data
    }
    fun publish(original:Original,data:ByteArray){
        validate(original.metadata);require(data.size.toLong()==original.metadata.getValue("size").jsonPrimitive.long&&ArchiveV2Chunks.digest(data)==original.digest)
        val rows=entries();require(rows.none{it.metadata.str("id")==original.metadata.str("id")})
        store.putBinary(key(original.metadata.str("id")),data)
        require(bytes(original).contentEquals(data))
        writeIndex(rows+original)
    }
    fun deleteConversation(cid:String){
        val rows=entries();val removed=rows.filter{it.metadata.str("conversation_id")==cid}
        writeIndex(rows-removed.toSet())
        removed.forEach{store.remove(key(it.metadata.str("id")))}
    }
    private fun writeIndex(rows:List<Original>){
        store.put(INDEX,JsonArray(rows.map{buildJsonObject{put("metadata",it.metadata);put("sha256",it.digest)}}).toString())
        require(entries()==rows)
    }
    companion object{
        const val MAX_BYTES=8L*1024*1024
        private const val INDEX="local.attachment.index.v2"
        private val hex=Regex("[0-9a-f]{64}")
        private val id=Regex("[A-Za-z0-9_.:-]{1,160}")
        private val mime=Regex("[a-z0-9.+-]+/[a-z0-9.+-]+")
        private fun key(id:String)="local.attachment.original.v2."+id
        fun JsonObject.str(k:String):String{val v=getValue(k);require(v is JsonPrimitive&&v.isString);return v.content}
        fun validate(m:JsonObject){
            require(m.keys==setOf("id","conversation_id","turn_id","kind","name","mime","size","created_at","updated_at"))
            require(id.matches(m.str("id"))&&id.matches(m.str("conversation_id"))&&(m["turn_id"]==JsonNull||id.matches(m.str("turn_id"))))
            require(m.str("kind") in setOf("image","file")&&m.str("name").length in 1..180&&m.str("mime").length<=120&&mime.matches(m.str("mime")))
            val size=m.getValue("size").jsonPrimitive;require(!size.isString&&size.long in 1..MAX_BYTES)
            for(k in listOf("created_at","updated_at")){val n=m.getValue(k).jsonPrimitive;require(!n.isString&&n.long>=0)}
        }
        fun checkReference(cid:String,tid:String,a:RemoteAttachment,metadata:Map<String,JsonObject>){
            val m=requireNotNull(metadata[a.id]){"聊天引用的附件原件未选择或缺失。"}
            require(m.str("conversation_id")==cid&&(m["turn_id"]==JsonNull||m.str("turn_id")==tid)&&m.str("kind")==a.type&&m.str("name")==a.name&&m.str("mime")==a.mime&&m.getValue("size").jsonPrimitive.long==a.size){"附件原件与消息引用不一致。"}
        }
    }
}

internal object ArchiveV2Attachments{
    data class Item(val metadata:JsonObject,val descriptor:ArchiveV2Object,val file:File)
    fun read(m:ArchiveV2Manifest,stage:ArchiveV2Stage,selection:Set<String>):List<Item>{
        if("attachments" !in selection)return emptyList()
        val objects=m.objects.associateBy{it.objectSha256}
        return m.records.filter{it.module=="attachments"}.map{r->
            require(r.mediaObjects.size==1)
            val record=objects.getValue(r.recordObject)
            val raw=Json.parseToJsonElement(stage.verify(record,1800000).readText(Charsets.UTF_8)).jsonObject
            require(raw.keys==setOf("kind","data")&&raw.getValue("kind")==JsonPrimitive("attachment"))
            val row=raw.getValue("data").jsonObject;LocalAttachmentStore.validate(row)
            val cid=row.getValue("conversation_id").jsonPrimitive.content
            require(r.id==row.getValue("id").jsonPrimitive.content&&r.dependencies==listOf("chat/"+cid))
            val d=objects.getValue(r.mediaObjects.single())
            require(d.size==row.getValue("size").jsonPrimitive.long)
            Item(row,d,stage.verify(d,LocalAttachmentStore.MAX_BYTES))
        }
    }
    fun apply(items:List<Item>,target:LocalPersistence,histories:Map<String,RemoteHistory>,conflictingParents:Set<String>,write:Boolean):LocalRestoreCount{
        val store=LocalAttachmentStore(target);val existing=store.entries().associateBy{it.metadata.getValue("id").jsonPrimitive.content}
        var ready=0;var matched=0;var conflicts=0
        for(item in items){
            val id=item.metadata.getValue("id").jsonPrimitive.content;val cid=item.metadata.getValue("conversation_id").jsonPrimitive.content
            val parent=requireNotNull(histories[cid]){"附件所属原窗口不存在。"}
            require(cid !in conflictingParents){"附件原窗口存在冲突。"}
            val tid=item.metadata["turn_id"]?.jsonPrimitive?.contentOrNull
            require(tid==null||parent.turns.any{it.id==tid}){"附件所属原轮次不存在。"}
            val data=item.file.readBytes()
            require(data.size.toLong()==item.descriptor.size)
            item.file.inputStream().use{ArchiveV2Chunks.stage(item.descriptor,it,object:java.io.OutputStream(){override fun write(b:Int){};override fun write(b:ByteArray,off:Int,len:Int){}},LocalAttachmentStore.MAX_BYTES)}
            val original=LocalAttachmentStore.Original(item.metadata,ArchiveV2Chunks.digest(data))
            val old=existing[id]
            if(old!=null){matched++;if(old!=original||!store.bytes(old).contentEquals(data))conflicts++}
            else{ready++;if(write)store.publish(original,data)}
        }
        require(conflicts==0){"附件 ID 与目标原件冲突，不覆盖。"}
        return LocalRestoreCount(ready,matched,conflicts)
    }
}
