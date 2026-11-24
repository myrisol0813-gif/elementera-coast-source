package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.remote.*
import kotlinx.serialization.json.*
import java.time.Instant

/** These modules already have a real editable local store. Use the cloud's
 * canonical V2 record shape in both directions, not a parallel backup schema. */
internal object ArchiveV2Knowledge {
    val modules=setOf("custom_instructions","worldbook")+LocalMemoryStore.modules
    data class Row(val module:String,val id:String,val data:JsonObject)
    private fun identity(module:String,id:String)=module+":"+ArchiveV2Chunks.digest(JsonArray(listOf(JsonPrimitive(id))).toString().encodeToByteArray())
    private fun stamp(value:String?)=Instant.parse(requireNotNull(value)).toEpochMilli().also{require(it>=0)}
    private fun iso(v:JsonElement):String {require(v is JsonPrimitive&&!v.isString&&v.long>=0);return Instant.ofEpochMilli(v.long).toString()}
    private fun JsonObject.str(k:String):String {val v=getValue(k);require(v is JsonPrimitive&&v.isString);return v.content}
    private fun JsonObject.flag(k:String):Boolean {val v=getValue(k).jsonPrimitive;require(!v.isString&&v.int in 0..1);return v.int==1}
    private fun JsonObject.num(k:String):Int {val v=getValue(k).jsonPrimitive;require(!v.isString);return v.int}
    fun export(store:LocalPersistence):List<Row> {
        val cache=RemoteCacheStore(store,strictReads=true)
        val result=mutableListOf<Row>()
        cache.customInstructions()?.takeIf{it.updatedAt!=null||it.content.isNotEmpty()}?.let{v->
            require(v.content.length<=32000&&v.updatedBy.length<=80&&v.source.length<=80)
            result.add(Row("custom_instructions",identity("custom_instructions","active"),buildJsonObject {
                put("id","active");put("content",v.content);put("updated_at",stamp(v.updatedAt));put("updated_by",v.updatedBy);put("source",v.source)
            }))
        }
        val entries=cache.worldbookEntries();LocalKnowledgeStore.validateWorldbook(entries)
        for(v in entries)result.add(Row("worldbook",identity("worldbook",v.id),buildJsonObject{
            put("id",v.id);put("title",v.title);put("content",v.content);put("keywords_json",JsonArray(v.keywords.map(::JsonPrimitive)).toString())
            put("use_regex",if(v.useRegex)1 else 0);put("case_sensitive",if(v.caseSensitive)1 else 0);put("constant_active",if(v.constantActive)1 else 0)
            put("priority",v.priority);put("scan_depth",v.scanDepth);put("inject_position","before_memory");put("enabled",if(v.enabled)1 else 0);put("scope",v.scope);put("visitor_safe",if(v.visitorSafe)1 else 0)
            put("created_at",stamp(v.createdAt));put("updated_at",stamp(v.updatedAt))
        }))
        val memory=LocalMemoryStore(store).snapshot()
        for((module,records) in listOf("memory_entries" to memory.entries,"memory_pockets" to memory.pockets)){
            records.filter{it["deleted_at"]==JsonNull}.forEach{result.add(Row(module,it.str("id"),it))}
        }
        return result
    }
    fun read(manifest:ArchiveV2Manifest,stage:ArchiveV2Stage,selection:Set<String>,app:String):List<Row>{
        require(selection.intersect(LocalMemoryStore.modules+setOf("custom_instructions")).isEmpty()||manifest.applicationId==app){"记忆及自定义指令原始身份暂需同版本恢复。"}
        val objects=manifest.objects.associateBy{it.objectSha256}
        return manifest.records.filter{it.module in selection}.map{r->
            require(r.mediaObjects.isEmpty())
            val d=objects.getValue(r.recordObject)
            require(d.size<=1800000)
            val raw=Json.parseToJsonElement(stage.verify(d,1800000).readBytes().decodeToString(throwOnInvalidSequence=true)).jsonObject
            require(raw.keys==setOf("kind","data")&&raw.str("kind")==r.module)
            val v=raw.getValue("data").jsonObject
            if(r.module in LocalMemoryStore.modules){
                LocalMemoryStore.validateRow(v,r.module=="memory_pockets")
                require(v["deleted_at"]==JsonNull&&r.id==v.str("id"))
                val cid=v["conversation_id"]?.jsonPrimitive?.contentOrNull
                require(r.dependencies==if(cid==null)emptyList() else listOf("chat/"+cid))
            }else require(r.dependencies.isEmpty()&&r.id==identity(r.module,v.str("id")))
            Row(r.module,r.id,v)
        }
    }
    fun apply(rows:List<Row>,selection:Set<String>,store:LocalPersistence,write:Boolean,parents:Set<String>,conflictingParents:Set<String>):Map<String,LocalRestoreCount>{
        val cache=RemoteCacheStore(store,strictReads=true)
        val counts=linkedMapOf<String,LocalRestoreCount>()
        if("custom_instructions" in selection){
            val incoming=rows.filter{it.module=="custom_instructions"};require(incoming.size<=1)
            var old=cache.customInstructions()
            if(old?.updatedAt==null&&old?.content.orEmpty().isEmpty())old=null
            val new=incoming.singleOrNull()?.data?.let{v->
                require(v.keys==setOf("id","content","updated_at","updated_by","source")&&v.str("id")=="active")
                val content=v.str("content");val actor=v.str("updated_by");val source=v.str("source")
                require(content.length<=32000&&actor.length<=80&&source.length<=80)
                RemoteCustomInstructions(content=content,updatedAt=iso(v.getValue("updated_at")),updatedBy=actor,source=source)
            }
            val fresh=new!=null&&old==null
            counts["custom_instructions"]=LocalRestoreCount(if(fresh)1 else 0,if(new!=null&&old!=null)1 else 0,if(new!=null&&old!=null&&old!=new)1 else 0)
            if(write&&fresh){cache.putCustomInstructions(new);require(cache.customInstructions()==new)}
        }
        if("worldbook" in selection){
            val incoming=rows.filter{it.module=="worldbook"}.map{row->
                val v=row.data
                require(v.keys==setOf("id","title","content","keywords_json","use_regex","case_sensitive","constant_active","priority","scan_depth","inject_position","enabled","scope","visitor_safe","created_at","updated_at"))
                require(v.str("inject_position")=="before_memory")
                val keywords=Json.parseToJsonElement(v.str("keywords_json")).jsonArray.map{require(it is JsonPrimitive&&it.isString);it.content}
                RemoteWorldbookEntry(id=v.str("id"),title=v.str("title"),content=v.str("content"),keywords=keywords,useRegex=v.flag("use_regex"),caseSensitive=v.flag("case_sensitive"),constantActive=v.flag("constant_active"),priority=v.num("priority"),scanDepth=v.num("scan_depth"),enabled=v.flag("enabled"),scope=v.str("scope"),visitorSafe=v.flag("visitor_safe"),createdAt=iso(v.getValue("created_at")),updatedAt=iso(v.getValue("updated_at")))
            }
            LocalKnowledgeStore.validateWorldbook(incoming)
            val old=cache.worldbookEntries();val byId=old.associateBy{it.id}
            val fresh=incoming.filter{it.id !in byId};val existing=incoming.filter{it.id in byId}
            val merged=old+fresh;LocalKnowledgeStore.validateWorldbook(merged)
            counts["worldbook"]=LocalRestoreCount(fresh.size,existing.size,existing.count{byId[it.id]!=it})
            if(write){cache.putWorldbookEntries(merged);require(cache.worldbookEntries()==merged)}
        }
        if(selection.any{it in LocalMemoryStore.modules}){
            val memory=LocalMemoryStore(store);val old=memory.snapshot()
            fun merge(module:String,existing:List<JsonObject>):List<JsonObject>{
                if(module !in selection)return existing
                val incoming=rows.filter{it.module==module}.map{it.data}
                val byId=existing.associateBy{it.str("id")}
                val fresh=incoming.filter{it.str("id") !in byId}
                val matched=incoming.filter{it.str("id") in byId}
                for(v in fresh){
                    val parent=v["conversation_id"]?.jsonPrimitive?.contentOrNull
                    require(parent==null||parent in parents&&parent !in conflictingParents){"记忆关联原窗口缺失或存在内容冲突。"}
                }
                counts[module]=LocalRestoreCount(fresh.size,matched.size,matched.count{byId[it.str("id")]!=it})
                return existing+fresh
            }
            val next=LocalMemoryStore.Snapshot(merge("memory_entries",old.entries),merge("memory_pockets",old.pockets))
            LocalMemoryStore.validate(next)
            if(write)memory.write(next)
        }
        return counts
    }
}
