package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.remote.*
import kotlinx.serialization.json.*
import java.time.Instant

/** These modules already have a real editable local store. Use the cloud's
 * canonical V2 record shape in both directions, not a parallel backup schema. */
internal object ArchiveV2Knowledge {
    val modules=setOf("custom_instructions","worldbook")+LocalMemoryStore.modules+LocalPortraitStore.modules+LocalSoilStore.modules+setOf("tools")
    data class Row(val module:String,val id:String,val data:JsonObject,val kind:String=module)
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
        val portraits=LocalPortraitStore(store)
        for(module in LocalPortraitStore.modules){
            val d=portraits.read(module)?:continue
            for((kind,items) in listOf(module to listOf(d.root),module+"_candidates" to d.candidates,module+"_revisions" to d.revisions)){
                items.forEach{result.add(Row(module,identity(kind,it.str("id")),it,kind))}
            }
        }
        val soils=LocalSoilStore(store).read()
        for((module,items) in listOf("thinking_soil" to soils.current,"thinking_soil_history" to soils.history)){
            items.forEach{result.add(Row(module,LocalSoilStore.identity(module,it),it))}
        }
        LocalToolAudit(store).read().forEach{result.add(Row("tools",it.str("id"),it))}
        return result
    }
    fun read(manifest:ArchiveV2Manifest,stage:ArchiveV2Stage,selection:Set<String>,app:String):List<Row>{
        require(selection.intersect(LocalMemoryStore.modules+LocalPortraitStore.modules+LocalSoilStore.modules+setOf("custom_instructions","tools")).isEmpty()||manifest.applicationId==app){"记忆及自定义指令原始身份暂需同版本恢复。"}
        val objects=manifest.objects.associateBy{it.objectSha256}
        return manifest.records.filter{it.module in selection}.map{r->
            require(r.mediaObjects.isEmpty())
            val d=objects.getValue(r.recordObject)
            require(d.size<=1800000)
            val raw=Json.parseToJsonElement(stage.verify(d,1800000).readBytes().decodeToString(throwOnInvalidSequence=true)).jsonObject
            require(raw.keys==setOf("kind","data"))
            val kind=raw.str("kind")
            require(kind==r.module||r.module in LocalPortraitStore.modules&&kind in setOf(r.module+"_candidates",r.module+"_revisions"))
            val v=raw.getValue("data").jsonObject
            if(r.module in LocalMemoryStore.modules){
                LocalMemoryStore.validateRow(v,r.module=="memory_pockets")
                require(v["deleted_at"]==JsonNull&&r.id==v.str("id"))
                val cid=v["conversation_id"]?.jsonPrimitive?.contentOrNull
                require(r.dependencies==if(cid==null)emptyList() else listOf("chat/"+cid))
            }else if(r.module=="tools"){
                LocalToolAudit.validateRow(v);require(r.id==v.str("id")&&r.dependencies==listOf("chat/"+v.str("conversation_id")))
            }else if(r.module in LocalSoilStore.modules){
                LocalSoilStore.validateRow(v,r.module=="thinking_soil_history")
                require(r.id==LocalSoilStore.identity(r.module,v)&&r.dependencies==listOf("chat/"+v.str("conversation_id")))
            }else require(r.dependencies.isEmpty()&&r.id==identity(kind,v.str("id")))
            Row(r.module,r.id,v,kind)
        }
    }
    fun apply(rows:List<Row>,selection:Set<String>,store:LocalPersistence,write:Boolean,parents:Set<String>,conflictingParents:Set<String>,histories:Map<String,RemoteHistory>):Map<String,LocalRestoreCount>{
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
        val portraits=LocalPortraitStore(store)
        for(module in selection.intersect(LocalPortraitStore.modules)){
            val group=rows.filter{it.module==module}
            if(group.isEmpty())continue
            val root=group.single{it.kind==module}.data
            val document=LocalPortraitStore.Document(root,group.filter{it.kind==module+"_candidates"}.map{it.data}.sortedBy{it.str("id")},group.filter{it.kind==module+"_revisions"}.map{it.data}.sortedBy{it.getValue("revision").jsonPrimitive.int})
            LocalPortraitStore.validate(document)
            val old=portraits.read(module)
            val same=old!=null&&old.root==document.root&&old.candidates.sortedBy{it.str("id")}==document.candidates&&old.revisions.sortedBy{it.getValue("revision").jsonPrimitive.int}==document.revisions
            val blank=old==null||old.root.str("body").isEmpty()&&old.root.getValue("revision").jsonPrimitive.int==1&&old.root.getValue("write_enabled").jsonPrimitive.int==1&&old.root["created_at"]==old.root["updated_at"]&&old.candidates.isEmpty()&&old.revisions.isEmpty()
            require(same||blank){"目标画像已有正文或历史，不覆盖。"}
            counts[module]=LocalRestoreCount(if(same)0 else group.size,if(same)group.size else 0,0)
            if(write&&!same)portraits.write(module,document)
        }
        if(selection.any{it in LocalSoilStore.modules}){
            val soil=LocalSoilStore(store);val old=soil.read()
            fun merge(module:String,existing:List<JsonObject>):List<JsonObject>{
                if(module !in selection)return existing
                val incoming=rows.filter{it.module==module}.map{it.data}
                val byId=existing.associateBy{LocalSoilStore.identity(module,it)}
                val fresh=incoming.filter{LocalSoilStore.identity(module,it) !in byId}
                val matched=incoming.filter{LocalSoilStore.identity(module,it) in byId}
                for(v in fresh){
                    val cid=v.str("conversation_id")
                    require(cid in parents&&cid !in conflictingParents){"思维壤关联原窗口缺失或存在冲突。"}
                    val h=requireNotNull(histories[cid]){"思维壤关联原聊天历史缺失。"}
                    if(module=="thinking_soil_history"){
                        val turn=h.turns.find{it.id==v.str("turn_id")}
                        require(turn!=null&&turn.assistant.variantsByUserVariant.values.flatten().any{it.id==v.str("assistant_message_id")}){"思维壤快照找不到原助手消息。"}
                    }
                }
                counts[module]=LocalRestoreCount(fresh.size,matched.size,matched.count{byId[LocalSoilStore.identity(module,it)]!=it})
                return existing+fresh
            }
            val next=LocalSoilStore.Rows(merge("thinking_soil",old.current),merge("thinking_soil_history",old.history))
            LocalSoilStore.validate(next)
            if(write)soil.write(next)
        }
        if("tools" in selection){
            val audit=LocalToolAudit(store);val old=audit.read();val byId=old.associateBy{it.str("id")}
            val incoming=rows.filter{it.module=="tools"}.map{it.data}
            val fresh=incoming.filter{it.str("id") !in byId};val matched=incoming.filter{it.str("id") in byId}
            require(fresh.all{it.str("conversation_id") in parents&&it.str("conversation_id") !in conflictingParents}){"工具历史关联原窗口缺失或存在冲突。"}
            val next=old+fresh;LocalToolAudit.validate(next)
            counts["tools"]=LocalRestoreCount(fresh.size,matched.size,matched.count{byId[it.str("id")]!=it})
            if(write)audit.write(next)
        }
        return counts
    }
}
