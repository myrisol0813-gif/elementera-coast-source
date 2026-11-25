package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.remote.*
import kotlinx.serialization.json.*
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.UUID

/** Authoritative local memory records retain the cloud's portable provenance.
 * The existing RemoteMemoryEntry/Pocket types are read-only UI projections. */
internal class LocalMemoryStore(private val store:LocalPersistence) {
    data class Snapshot(val entries:List<JsonObject>,val pockets:List<JsonObject>)
    fun snapshot():Snapshot{
        val raw=store.get(KEY)
        if(raw.isEmpty())return Snapshot(emptyList(),emptyList())
        val v=Json.parseToJsonElement(raw).jsonObject
        require(v.keys==setOf("entries","pockets"))
        return Snapshot(v.getValue("entries").jsonArray.map{it.jsonObject},v.getValue("pockets").jsonArray.map{it.jsonObject}).also(::validate)
    }
    fun write(v:Snapshot){
        validate(v)
        store.put(KEY,buildJsonObject{put("entries",JsonArray(v.entries));put("pockets",JsonArray(v.pockets))}.toString())
        require(snapshot()==v)
    }
    fun entries(type:String):List<RemoteMemoryEntry>{
        require(type in setOf("memory","seed"))
        return snapshot().entries.filter{it.str("entry_type")==type&&it["deleted_at"]==JsonNull&&it.str("status") in setOf("active","dormant")}
            .sortedByDescending{it.getValue("updated_at").jsonPrimitive.long}.map(::entry)
    }
    fun pockets(cid:String):List<RemoteMemoryPocket> = snapshot().pockets.filter{it.str("conversation_id")==cid&&it["deleted_at"]==JsonNull&&it.str("status")=="pending"}
        .sortedByDescending{it.getValue("created_at").jsonPrimitive.long}.map(::pocket)
    fun save(id:String?,req:RemoteMemoryEntryWriteRequest):RemoteMemoryEntry{
        val v=snapshot()
        val old=id?.let{key->v.entries.firstOrNull{it.str("id")==key&&it["deleted_at"]==JsonNull}?:error("记忆不存在。")}
        val row=makeEntry(req,old,System.currentTimeMillis())
        write(v.copy(entries=v.entries.filterNot{it.str("id")==row.str("id")}+row))
        return entry(row)
    }
    fun delete(id:String){
        val v=snapshot();require(v.entries.any{it.str("id")==id&&it["deleted_at"]==JsonNull}){"记忆不存在。"}
        val now=JsonPrimitive(System.currentTimeMillis())
        write(v.copy(entries=v.entries.map{if(it.str("id")==id)JsonObject(it+mapOf("deleted_at" to now,"updated_at" to now))else it}))
    }
    fun resolve(id:String,req:RemoteMemoryPocketResolveRequest):RemoteMemoryPocketResolveResponse{
        val v=snapshot();val old=v.pockets.firstOrNull{it.str("id")==id&&it["deleted_at"]==JsonNull}?:error("待确认候选不存在。")
        require(old.str("status")=="pending"){"候选已经处理。"}
        require(req.action in setOf("memory","seed","discard"))
        val now=System.currentTimeMillis()
        var newEntry:JsonObject?=null
        val changes=buildJsonObject{
            put("status",if(req.action=="discard")"discarded" else "confirmed");put("updated_at",now)
            if(req.action!="discard"){
                val tag=requireNotNull(req.tag);require(tag in TAGS){"确认候选需要有效标签。"}
                val view=pocket(old);val ref=Json.parseToJsonElement(old.str("source_ref_json")).jsonObject
                val sourceModel=ref["model_label"]?.jsonPrimitive?.contentOrNull?:ref["generated_by_model"]?.jsonPrimitive?.contentOrNull.orEmpty()
                val request=RemoteMemoryEntryWriteRequest(entryType=req.action,title=req.title?:view.title,lifeCore=req.lifeCore?:view.lifeCore,
                    content=req.content?:view.content,usageHint=req.usageHint?:view.usageHint,avoidHint=req.avoidHint?:view.avoidHint,
                    memoryLevel=req.memoryLevel?:"ordinary",status=if(req.action=="seed")"dormant" else "active",tag=tag,memoryTags=listOf(tag),
                    sourceModel=sourceModel,sourceWindow=ref["source_window"]?.jsonPrimitive?.contentOrNull?:view.conversationId,sourceTime=iso(old.getValue("created_at")))
                val made=makeEntry(request,null,now)
                newEntry=JsonObject(made+mapOf("source_type" to JsonPrimitive("pocket"),"source_ref_json" to JsonPrimitive(buildJsonObject{put("pocket_id",id);put("source_type",old.str("source_type"));put("source_ref",ref)}.toString())))
                put("resolved_entry_id",newEntry!!.str("id"));put("memory_tags_json",JsonArray(listOf(JsonPrimitive(tag))).toString());put("last_confirmed_at",now)
            }
        }
        val resolved=JsonObject(old+changes)
        write(Snapshot(v.entries+listOfNotNull(newEntry),v.pockets.map{if(it.str("id")==id)resolved else it}))
        return RemoteMemoryPocketResolveResponse(ok=true,pocket=pocket(resolved),entry=newEntry?.let(::entry))
    }
    private fun makeEntry(req:RemoteMemoryEntryWriteRequest,old:JsonObject?,now:Long):JsonObject{
        require(old==null||old.str("entry_type")==req.entryType){"不能通过编辑改变记忆类型。"}
        require(req.tag.isEmpty()||req.tag in TAGS)
        val time=req.sourceTime?.takeIf{it.isNotBlank()}?.let{raw->
            runCatching{Instant.parse(raw).toEpochMilli()}.getOrElse{LocalDate.parse(raw).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()}
        }?:old?.get("source_time")?.jsonPrimitive?.longOrNull?:now
        // Date-only UI editing must not discard the original time of day.
        val previous=old?.get("source_time")?.jsonPrimitive?.longOrNull
        val sourceTime=if(previous!=null&&req.sourceTime==Instant.ofEpochMilli(previous).toString().take(10))previous else time
        val defaults=buildJsonObject{
            put("id",UUID.randomUUID().toString());put("scope","global");put("conversation_id",JsonNull);put("source_type","manual");put("source_ref_json","{}")
            put("promoted_from_id",JsonNull);put("recall_count",0);put("last_recalled_at",JsonNull);put("supersedes_entry_id",JsonNull);put("revision_action","")
            put("created_at",now);put("deleted_at",JsonNull);put("user_confirmed",1)
        }
        val changed=buildJsonObject{
            put("entry_type",req.entryType);put("title",req.title.trim());put("life_core",req.lifeCore.trim());put("content",req.content);put("usage_hint",req.usageHint);put("avoid_hint",req.avoidHint)
            put("memory_level",if(req.entryType=="seed")"ordinary" else req.memoryLevel);put("status",req.status)
            val previousTag=old?.str("tag")
            put("memory_tags_json",if(old!=null&&previousTag==req.tag)old.str("memory_tags_json") else JsonArray((if(req.tag.isEmpty())req.memoryTags else listOf(req.tag)).map(::JsonPrimitive)).toString())
            put("source_model",req.sourceModel);put("source_window",req.sourceWindow);put("source_time",sourceTime);put("tag",req.tag)
            put("migration_status",if(req.tag.isEmpty())old?.str("migration_status")?:"待整理" else "");put("last_confirmed_at",now);put("updated_at",now)
        }
        return JsonObject((old?:defaults)+changed).also{validateRow(it,false)}
    }
    fun recall(input:String,cid:String,explicit:Boolean=false):List<RemoteMemoryEntry>{
        val query=input.trim().lowercase(java.util.Locale.ROOT)
        if(query.isBlank())return emptyList()
        val requested=explicit||Regex("你还记得|还记得吗|还记得|回想|找一下.*记忆|搜索.*记忆|查.*记忆|记忆里|种子库|记忆库|以前说过|我们聊过").containsMatchIn(query)
        val tokens=query.split(Regex("[\\s,，。！？!?、:：;；()（）「」“”]+")).filter{it.length>=2}.distinct().take(12)
        fun normalized(value:String)=value.lowercase(java.util.Locale.ROOT).trim()
        fun keyword(row:JsonObject):Double{
            val fields=listOf("title","life_core","content","usage_hint","avoid_hint","tag").map{normalized(row.str(it))}
            val (title,core,content,usage)=fields
            return when{
                title==query->1.0
                title.length>=2&&query.contains(title)->0.97
                title.contains(query)->0.94
                core.contains(query)->0.88
                content.contains(query)->0.76
                usage.contains(query)->0.70
                else->{val matched=tokens.count{token->fields.any{it.contains(token)}};if(matched==0)0.0 else 0.46+matched.toDouble()/tokens.size*0.34}
            }
        }
        val now=System.currentTimeMillis()
        fun score(row:JsonObject,base:Double):Double{
            val at=listOf("last_confirmed_at","source_time","updated_at","created_at").firstNotNullOfOrNull{row[it]?.jsonPrimitive?.longOrNull}?:0L
            val age=(now-at).coerceAtLeast(0)/86400000.0
            val recent=when{age<=7->0.03;age<=30->0.021;age<=90->0.0105;else->0.0}
            val tag=normalized(row.str("tag"));val window=normalized(row.str("source_window"))
            return (base+recent+(if(tag.isNotEmpty()&&query.contains(tag))0.03 else 0.0)+
                (if(window.isNotEmpty()&&query.contains(window))0.02 else 0.0)-
                (if(row.str("entry_type")=="seed")0.03 else 0.0)-
                (if(row.str("status")=="dormant")0.04 else 0.0)).coerceIn(0.0,1.0)
        }
        val candidates=snapshot().entries.asSequence().filter{
            it["deleted_at"]==JsonNull&&it.getValue("user_confirmed").jsonPrimitive.int==1&&
            it.str("status") in setOf("active","dormant")&&(it.str("scope")=="global"||it.str("conversation_id")==cid)
        }.mapNotNull{row->
            val base=keyword(row);val rank=score(row,base)
            val threshold=if(requested)0.55 else if(row.str("entry_type")=="seed")0.82 else 0.74
            if(base>0&&(base>=0.92||rank>=threshold))row to rank else null
        }.sortedWith(compareByDescending<Pair<JsonObject,Double>>{it.second}.thenByDescending{it.first["updated_at"]!!.jsonPrimitive.long}.thenBy{it.first.str("id")})
        val selected=mutableListOf<RemoteMemoryEntry>();val topics=mutableSetOf<String>()
        var memories=0;var seeds=0
        for((row,_) in candidates){
            if(selected.size>=if(requested)8 else 4)break
            val topic=normalized(row.str("tag"))+":"+normalized(row.str("title")).replace(Regex("[\\s\\p{P}\\p{S}]+"),"").take(120)
            if(topic in topics)continue
            if(row.str("entry_type")=="seed"){if(seeds>=if(requested)2 else 1)continue;seeds++}
            else {if(memories>=if(requested)6 else 3)continue;memories++}
            topics.add(topic);selected.add(entry(row))
        }
        return selected
    }
    companion object{
        const val KEY="local.memory.records.v2"
        val modules=setOf("memory_entries","memory_pockets")
        private val TAGS=setOf("关系","历史锚点","偏好","人物档案","海岸世界观","工程技术")
        private val safeId=Regex("[A-Za-z0-9_.:-]{1,160}")
        private val common="id,conversation_id,title,life_core,content,usage_hint,avoid_hint,source_type,source_ref_json,status,recall_count,last_recalled_at,memory_tags_json,supersedes_entry_id,last_confirmed_at,revision_action,source_model,source_window,source_time,tag,migration_status,created_at,updated_at,deleted_at".split(",").toSet()
        private val entryKeys=common+setOf("entry_type","scope","promoted_from_id","memory_level","user_confirmed")
        private val pocketKeys=common+"source_text,suggested_title,suggested_life_core,suggested_usage_hint,suggested_avoid_hint,candidate_id,source_refs_json,source_excerpt,fingerprint,resolved_entry_id".split(",")
        fun JsonObject.str(k:String)=getValue(k).jsonPrimitive.contentOrNull.orEmpty()
        private fun iso(v:JsonElement):String?=v.jsonPrimitive.longOrNull?.let{Instant.ofEpochMilli(it).toString()}
        private fun entry(r:JsonObject)=RemoteMemoryEntry(id=r.str("id"),entryType=r.str("entry_type"),title=r.str("title"),lifeCore=r.str("life_core"),content=r.str("content"),
            usageHint=r.str("usage_hint"),avoidHint=r.str("avoid_hint"),memoryLevel=r.str("memory_level"),status=r.str("status"),memoryTags=Json.parseToJsonElement(r.str("memory_tags_json")).jsonArray.map{it.jsonPrimitive.content},
            sourceModel=r.str("source_model"),sourceWindow=r.str("source_window"),sourceDate=iso(r.getValue("source_time"))?.take(10).orEmpty(),tag=r.str("tag"),createdAt=iso(r.getValue("created_at")),updatedAt=iso(r.getValue("updated_at")))
        private fun pocket(r:JsonObject):RemoteMemoryPocket{
            val ref=Json.parseToJsonElement(r.str("source_ref_json")).jsonObject
            return RemoteMemoryPocket(id=r.str("id"),conversationId=r.str("conversation_id"),title=r.str("title").ifBlank{r.str("suggested_title")},lifeCore=r.str("life_core").ifBlank{r.str("suggested_life_core")},
                content=r.str("content").ifBlank{r.str("source_text")},usageHint=r.str("usage_hint").ifBlank{r.str("suggested_usage_hint")},avoidHint=r.str("avoid_hint").ifBlank{r.str("suggested_avoid_hint")},
                sourceExcerpt=r.str("source_excerpt"),suggestedDestination=ref["suggested_destination"]?.jsonPrimitive?.contentOrNull.orEmpty(),status=r.str("status"),createdAt=iso(r.getValue("created_at")),updatedAt=iso(r.getValue("updated_at")))
        }
        fun validate(v:Snapshot){
            for((rows,isPocket) in listOf(v.entries to false,v.pockets to true)){
                require(rows.map{it.str("id")}.distinct().size==rows.size)
                rows.forEach{validateRow(it,isPocket)}
            }
            val fingerprints=v.pockets.map{it.str("fingerprint")}.filter{it.isNotEmpty()}
            require(fingerprints.distinct().size==fingerprints.size){"待确认候选指纹冲突。"}
        }
        fun validateRow(r:JsonObject,pocket:Boolean){
            require(r.keys==if(pocket)pocketKeys else entryKeys){"记忆归档字段不兼容。"}
            fun text(k:String,max:Int){val x=r.getValue(k);require(x is JsonPrimitive&&x.isString&&x.content.length<=max)}
            fun id(k:String,optional:Boolean=false){val x=r.getValue(k);require(optional&&x==JsonNull||x is JsonPrimitive&&x.isString&&safeId.matches(x.content))}
            fun timestamp(k:String,optional:Boolean=false){val x=r.getValue(k);require(optional&&x==JsonNull||x is JsonPrimitive&&!x.isString&&x.long>=0)}
            id("id");id("conversation_id",!pocket);id("supersedes_entry_id",true)
            for(k in listOf("created_at","updated_at","recall_count"))timestamp(k)
            for(k in listOf("deleted_at","last_recalled_at","source_time","last_confirmed_at"))timestamp(k,true)
            for((k,max) in mapOf("title" to 120,"life_core" to 2000,"content" to 6000,"usage_hint" to 1200,"avoid_hint" to 1200,"source_model" to 120,"source_window" to 180,"tag" to 80,"migration_status" to 160,"revision_action" to 160,"source_type" to 40,"source_ref_json" to 4000,"memory_tags_json" to 20000))text(k,max)
            require(Json.parseToJsonElement(r.str("source_ref_json")) is JsonObject)
            val tags=Json.parseToJsonElement(r.str("memory_tags_json")).jsonArray
            require(tags.size<=30&&tags.all{it is JsonPrimitive&&it.isString&&it.content.length<=80})
            if(pocket){
                require(r.str("source_type") in setOf("turn","soil")&&r.str("status") in setOf("pending","confirmed","discarded","stone","archived"))
                for((k,max) in mapOf("source_text" to 12000,"suggested_title" to 120,"suggested_life_core" to 2000,"suggested_usage_hint" to 1200,"suggested_avoid_hint" to 1200,"source_excerpt" to 1200,"source_refs_json" to 20000))text(k,max)
                require(r.str("source_text").isNotBlank());id("candidate_id",true);id("resolved_entry_id",true)
                if(r["fingerprint"]!=JsonNull)text("fingerprint",160)
                val refs=Json.parseToJsonElement(r.str("source_refs_json")).jsonArray
                require(refs.size<=8&&refs.all{it is JsonObject&&safeId.matches(it.str("turn_id"))&&it.str("role") in setOf("user","assistant","turn")})
            }else{
                require(r.str("entry_type") in setOf("memory","seed")&&r.str("scope") in setOf("global","conversation")&&r.str("status") in setOf("active","dormant","archived","stone","discarded"))
                require((r.str("scope")=="global")== (r["conversation_id"]==JsonNull));require(r.str("memory_level") in setOf("ordinary","core")&&(r.str("entry_type")!="seed"||r.str("memory_level")=="ordinary"))
                require(r.getValue("user_confirmed").jsonPrimitive.int in 0..1&&r.str("title").isNotBlank()&&r.str("life_core").isNotBlank());id("promoted_from_id",true)
            }
        }
    }
}
