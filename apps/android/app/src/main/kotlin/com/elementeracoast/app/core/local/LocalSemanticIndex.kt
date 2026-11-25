package com.elementeracoast.app.core.local

import kotlinx.serialization.json.*
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

internal interface CoastVectorEncoder:AutoCloseable {
    fun query(text:String):FloatArray
    fun documents(text:String):List<FloatArray>
}

/** Rebuildable private index, outside authoritative storage and archive. No source text on disk. */
internal class LocalSemanticIndex(
    private val directory:File,
    private val rows:()->List<JsonObject>,
    private val factory:()->CoastVectorEncoder
):AutoCloseable {
    data class Match(val scores:Map<String,Double>,val status:String)
    private data class Document(val key:String,val text:String)
    private val worker=Executors.newSingleThreadExecutor{task->Thread(task,"coast-embedding-index").apply{isDaemon=true;priority=Thread.MIN_PRIORITY}}
    private val dirty=AtomicBoolean()
    private val scheduled=AtomicBoolean()
    private val closed=AtomicBoolean()
    private val inference=ReentrantLock()
    @Volatile private var encoder:CoastVectorEncoder?=null
    @Volatile private var vectors:Map<String,List<FloatArray>> = emptyMap()
    @Volatile private var state="语义索引准备中"
    @Volatile private var indexedTotal=0
    @Volatile private var expectedTotal=0

    fun requestRefresh(){
        if(closed.get())return
        dirty.set(true)
        if(!scheduled.compareAndSet(false,true))return
        try{
            worker.execute{
                try{
                    while(!closed.get()&&dirty.getAndSet(false)){
                        try{refresh()}catch(_:Exception){state="语义索引失败 · 关键词可用"}
                        catch(_:LinkageError){state="设备推理库不可用 · 关键词可用"}
                    }
                }finally{
                    scheduled.set(false)
                    if(dirty.get()&&!closed.get())requestRefresh()
                }
            }
        }catch(_:java.util.concurrent.RejectedExecutionException){scheduled.set(false)}
    }
    private fun refresh(){
        val docs=rows().filter(::eligible).map(::document).distinctBy{it.key}
        expectedTotal=docs.size
        val keys=docs.map{it.key}.toSet()
        if(keys==vectors.keys&&encoder!=null){indexedTotal=keys.size;state="语义索引就绪";return}
        val kept=vectors.filterKeys{it in keys}.toMutableMap()
        vectors=kept.toMap();indexedTotal=kept.size
        check(directory.isDirectory||directory.mkdirs()){"无法创建派生索引"}
        directory.listFiles()?.filter{it.isFile&&it.name.matches(Regex("[0-9a-f]{64}\\.vec"))&&it.name.removeSuffix(".vec") !in keys}
            ?.forEach{it.delete()}
        if(docs.isEmpty()){state="语义索引就绪";return}
        if(encoder==null)inference.withLock{if(!closed.get()&&encoder==null)encoder=factory()}
        val engine=encoder?:return
        state="语义索引建立中"
        for(doc in docs){
            if(closed.get()||dirty.get())return
            if(doc.key in kept)continue
            val cached=read(doc.key)
            val value=cached?:inference.withLock{engine.documents(doc.text)}.also{require(valid(it));if(!closed.get())write(doc.key,it)}
            if(closed.get())return
            kept[doc.key]=value;vectors=kept.toMap();indexedTotal=kept.size
            if(cached==null)Thread.sleep(5)
        }
        state="语义索引就绪"
    }
    fun lookup(query:String,allowed:List<JsonObject>):Match{
        val docs=allowed.filter(::eligible).map{it.getValue("id").jsonPrimitive.content to document(it).key}
        val current=vectors;val engine=encoder
        val indexed=docs.count{it.second in current}
        val detail=indexed.toString()+"/"+docs.size
        if(docs.isEmpty())return Match(emptyMap(),"无合资格记忆 · "+state)
        if(engine==null||indexed==0||closed.get())return Match(emptyMap(),state+" · "+detail+" · 本轮关键词")
        if(!inference.tryLock())return Match(emptyMap(),"语义推理忙 · "+detail+" · 本轮关键词")
        return try{
            if(closed.get())return Match(emptyMap(),"语义索引已停止 · 本轮关键词")
            val vector=engine.query(query)
            require(valid(listOf(vector)))
            val scores=docs.mapNotNull{(id,key)->current[key]?.let{items->
                id to items.maxOf{v->v.indices.sumOf{i->v[i].toDouble()*vector[i]}.coerceIn(-1.0,1.0)}
            }}.toMap()
            Match(scores,"混合召回 · "+detail+(if(indexed<docs.size)" · "+state else ""))
        }catch(_:Exception){Match(emptyMap(),"语义推理失败 · 本轮关键词")}
        catch(_:LinkageError){Match(emptyMap(),"设备推理库不可用 · 本轮关键词")}
        finally{inference.unlock()}
    }
    fun progress()=state+" · "+indexedTotal+"/"+expectedTotal
    override fun close(){
        if(!closed.compareAndSet(false,true))return
        worker.execute{inference.withLock{runCatching{encoder?.close()};encoder=null}}
        worker.shutdown()
    }
    private fun file(key:String)=File(directory,key+".vec")
    private fun read(key:String):List<FloatArray>?=runCatching{
        DataInputStream(file(key).inputStream().buffered()).use{input->
            val count=input.readInt();require(count in 1..128)
            val value=List(count){FloatArray(512){input.readFloat()}}
            require(input.read()==-1&&valid(value));value
        }
    }.getOrNull()
    private fun write(key:String,values:List<FloatArray>){
        val temp=File.createTempFile("embedding-",".tmp",directory)
        try{
            DataOutputStream(temp.outputStream().buffered()).use{out->out.writeInt(values.size);values.forEach{v->v.forEach{out.writeFloat(it)}}}
            Files.move(temp.toPath(),file(key).toPath(),StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE)
        }finally{temp.delete()}
    }
    private fun valid(v:List<FloatArray>)=v.isNotEmpty()&&v.size<=128&&v.all{it.size==512&&it.all{n->n.isFinite()}&&it.sumOf{n->n.toDouble()*n} in 0.95..1.05}
    private fun document(row:JsonObject):Document{
        val text=listOf("title","life_core","tag","usage_hint","content").joinToString("\n"){row.getValue(it).jsonPrimitive.contentOrNull.orEmpty()}
        val key=MessageDigest.getInstance("SHA-256").digest(("bge-small-zh-quantized-15b717c3:wordpiece-cls-chunks-v1\n"+text).toByteArray(Charsets.UTF_8)).joinToString(""){"%02x".format(it.toInt() and 255)}
        return Document(key,text)
    }
    companion object{
        fun eligible(row:JsonObject)=row["deleted_at"]==JsonNull&&row["user_confirmed"]?.jsonPrimitive?.intOrNull==1&&row["status"]?.jsonPrimitive?.contentOrNull in setOf("active","dormant")
    }
}
