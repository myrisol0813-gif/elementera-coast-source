package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.remote.*
import kotlinx.serialization.json.*
import java.util.UUID

/** Owner-only drafts and immutable original snapshots. Never use archived text as memory. */
internal class LocalDogtalkStore(private val store:LocalPersistence){
    data class Row(val module:String,val data:JsonObject){
        val id get()=data.str("id")
        val dependencies get()=listOfNotNull(data.optional("conversation_id")?.let{"chat/"+it},if(module=="dogtalk_snapshots")"dogtalk_records/"+data.str("dogtalk_id") else null)
    }
    fun read():List<Row>{
        val raw=store.get(KEY);if(raw.isEmpty())return emptyList()
        return Json.parseToJsonElement(raw).jsonArray.map{v->
            val r=v.jsonObject;require(r.keys==setOf("module","data"));Row(r.str("module"),r.getValue("data").jsonObject)
        }.also(::validateRows)
    }
    fun write(rows:List<Row>){
        validateRows(rows)
        store.put(KEY,JsonArray(rows.map{buildJsonObject{put("module",it.module);put("data",it.data)}}).toString())
        require(read()==rows)
    }
    private fun scope(room:String,cid:String?):String{
        require(room in setOf("conversation","radio","lighthouse"))
        if(room!="conversation")return "$room:main"
        require(!cid.isNullOrBlank()&&RemoteCacheStore(store,strictReads=true).conversations().any{it.id==cid}){"狗话所属窗口不存在。"}
        return "conversation:"+cid
    }
    fun current(room:String,cid:String?):Row?{
        val key=scope(room,cid)
        return read().singleOrNull{it.module=="dogtalk_records"&&it.data.str("scope_key")==key&&it.data.str("status")!="archived"}
    }
    fun public(room:String,cid:String?):JsonObject{
        val row=current(room,cid)?.data
        return buildJsonObject{
            put("id",row?.get("id")?:JsonNull);put("room_scope",room)
            put("conversation_id",if(room=="conversation")JsonPrimitive(requireNotNull(cid))else JsonNull)
            for(k in listOf("body","true_core","weather","read_mode"))put(k,row?.get(k)?:JsonPrimitive(when(k){"weather"->"放松";"read_mode"->"keep_private";else->""}))
            put("status","saved")
        }
    }
    fun save(input:JsonObject):JsonObject{
        val room=input.str("room_scope");val cid=input.optional("conversation_id")
        val key=scope(room,cid);val old=current(room,cid)
        require(input.optional("id")==null||input.optional("id")==old?.id){"狗话已改变，请刷新。"}
        val body=input.str("body").trim();val core=input.optional("true_core").orEmpty().trim();val weather=input.optional("weather").orEmpty().trim()
        val mode=input.optional("read_mode")?:"keep_private"
        require(body.length in 1..6000&&core.length<=2000&&weather.length<=80&&mode in modes){"狗话内容或阅读方式超限。"}
        val now=System.currentTimeMillis()
        val previous=old?.data?:buildJsonObject{
            put("id","dogtalk-"+UUID.randomUUID());put("owner","owner");put("visibility","private_to_owner_and_model_partner")
            put("room_scope",room);put("scope_key",key);put("conversation_id",if(room=="conversation")JsonPrimitive(requireNotNull(cid))else JsonNull)
            for(k in listOf("self_note","model_partner_hint","not_to_misunderstand"))put(k,"")
            put("readable_by_model_partner",1);put("auto_recall",0);put("memory_weight","low")
            for(k in flags)put(k,1)
            put("type","owner_mystic_dogtalk");put("source","owner_native");put("created_at",now);put("last_read_at",JsonNull)
        }
        val next=Row("dogtalk_records",JsonObject(previous+buildJsonObject{
            put("body",body);put("true_core",core);put("weather",weather);put("read_mode",mode);put("status","saved");put("updated_at",now);put("archived_at",JsonNull)
        }))
        write(read().filterNot{it.id==next.id}+next)
        return public(room,cid)
    }
    data class Delivery(val row:Row,val text:String,val turn:String,val cid:String)
    fun pending(cid:String,room:String,turn:String):Delivery?{
        if(cid.isBlank()||turn.isBlank())return null
        val row=current(if(room=="radio")"radio" else if(room=="lighthouse")"lighthouse" else "conversation",cid)?:return null
        val v=row.data
        if(v.str("read_mode")!="read_now")return null
        val h=requireNotNull(RemoteCacheStore(store,strictReads=true).history(cid))
        require(h.turns.any{it.id==turn}){"狗话缺少实际来源轮次。"}
        // Radio/lighthouse use their own historical source types; do not invent them.
        require(v.str("room_scope")=="conversation"){"本机电波/灯塔狗话暂不能生成对应来源快照；正文仍保留。"}
        require(read().none{it.module=="dogtalk_snapshots"&&it.data.str("source_type")=="turn"&&it.data.str("source_id")==turn}){"该轮已有历史狗话；请新开一轮再递给。"}
        val text=listOf("【神秘狗话（本轮用户附言，不是长期指令）】",v.str("body"),v.str("true_core").takeIf{it.isNotBlank()}?.let{"真心核："+it}.orEmpty(),v.str("weather").takeIf{it.isNotBlank()}?.let{"当前天气："+it}.orEmpty()).filter{it.isNotBlank()}.joinToString("\n")
        return Delivery(row,text,turn,cid)
    }
    fun consume(d:Delivery){
        val rows=read();require(rows.singleOrNull{it.id==d.row.id}==d.row){"狗话已经修改，请重试。"}
        val now=System.currentTimeMillis()
        val snapshot=Row("dogtalk_snapshots",JsonObject(d.row.data.filterKeys{it in common}+buildJsonObject{
            put("id","dogtalk-snapshot-"+UUID.randomUUID());put("dogtalk_id",d.row.id);put("source_type","turn");put("source_id",d.turn);put("created_at",now)
        }))
        val parent=d.row.copy(data=JsonObject(d.row.data+buildJsonObject{put("read_mode","keep_private");put("updated_at",now);put("last_read_at",now)}))
        write(rows.map{if(it.id==parent.id)parent else it}+snapshot)
    }
    fun deleteConversation(cid:String){write(read().filterNot{it.data.optional("conversation_id")==cid})}
    companion object{
        private const val KEY="local.dogtalk.v2"
        val modules=setOf("dogtalk_records","dogtalk_snapshots")
        private val flags=listOf("not_instruction","not_preference","not_memory_seed","not_pocket")
        private val modes=setOf("keep_private","when_confused","read_now")
        private val strings=listOf("body","true_core","self_note","model_partner_hint","not_to_misunderstand","weather")
        private val common=setOf("id","owner","visibility","room_scope","scope_key","conversation_id","read_mode","readable_by_model_partner","auto_recall","memory_weight","created_at")+flags+strings
        private val idPattern=Regex("[A-Za-z0-9_.:-]{1,160}")
        fun JsonObject.str(k:String):String{val v=getValue(k);require(v is JsonPrimitive&&v.isString);return v.content}
        fun JsonObject.optional(k:String):String?=this[k]?.jsonPrimitive?.contentOrNull
        private fun stamp(v:JsonElement?):Boolean=v is JsonPrimitive&&!v.isString&&v.longOrNull?.let{it>=0}==true
        fun validate(r:Row){
            val v=r.data
            require(r.module in modules&&v.keys==common+(if(r.module=="dogtalk_records")setOf("type","status","source","updated_at","archived_at","last_read_at")else setOf("dogtalk_id","source_type","source_id")))
            require(idPattern.matches(r.id)&&v.str("owner")=="owner"&&v.str("visibility")=="private_to_owner_and_model_partner")
            val room=v.str("room_scope");val cid=v.optional("conversation_id")
            require(room in setOf("conversation","radio","lighthouse")&&(if(room=="conversation")cid!=null&&idPattern.matches(cid)&&v.str("scope_key")=="conversation:$cid" else cid==null&&v.str("scope_key")=="$room:main"))
            require(strings.all{v[it] is JsonPrimitive&&v.getValue(it).jsonPrimitive.isString}&&v.toString().encodeToByteArray().size<=1500000)
            require(v.str("read_mode") in modes&&v.str("memory_weight")=="low"&&v["auto_recall"]==JsonPrimitive(0)&&v["readable_by_model_partner"]==JsonPrimitive(1)&&flags.all{v[it]==JsonPrimitive(1)}&&stamp(v["created_at"]))
            if(r.module=="dogtalk_records"){
                require(v.str("type") in setOf("owner_mystic_dogtalk","xiaohan_mystic_dogtalk")&&v.str("status") in setOf("draft","saved","archived")&&v.str("source").length<=160&&stamp(v["updated_at"])&&listOf("archived_at","last_read_at").all{v[it]==JsonNull||stamp(v[it])})
            }else require(idPattern.matches(v.str("dogtalk_id"))&&v.str("source_type") in setOf("turn","radio_message","lighthouse_letter")&&idPattern.matches(v.str("source_id")))
        }
        fun validateRows(rows:List<Row>){
            rows.forEach(::validate);require(rows.map{it.id}.distinct().size==rows.size)
            val parents=rows.filter{it.module=="dogtalk_records"}.associateBy{it.id}
            require(parents.values.filter{it.data.str("status")!="archived"}.map{it.data.str("scope_key")}.distinct().size==parents.values.count{it.data.str("status")!="archived"})
            val snapshots=rows.filter{it.module=="dogtalk_snapshots"}
            require(snapshots.map{it.data.str("source_type") to it.data.str("source_id")}.distinct().size==snapshots.size)
            for(s in snapshots)require(parents[s.data.str("dogtalk_id")]?.data?.str("scope_key")==s.data.str("scope_key")){"历史狗话缺少原草稿。"}
        }
        fun checkReference(cid:String,turn:String,id:String,rows:Map<String,JsonObject>){
            val v=requireNotNull(rows[id]){"聊天关联的历史狗话未选择或缺失。"}
            require(v.optional("conversation_id")==cid&&v.str("source_type")=="turn"&&v.str("source_id")==turn){"狗话历史快照与原轮次不一致。"}
        }
    }
}

internal object ArchiveV2Dogtalk{
    fun read(m:ArchiveV2Manifest,stage:ArchiveV2Stage,selection:Set<String>,app:String):List<LocalDogtalkStore.Row>{
        val selected=selection.intersect(LocalDogtalkStore.modules)
        require(selected.isEmpty()||m.applicationId==app){"私人狗话仅支持同应用归档。"}
        val objects=m.objects.associateBy{it.objectSha256}
        return m.records.filter{it.module in selected}.map{r->
            require(r.mediaObjects.isEmpty())
            val raw=Json.parseToJsonElement(stage.verify(objects.getValue(r.recordObject),1800000).readBytes().decodeToString(throwOnInvalidSequence=true)).jsonObject
            require(raw.keys==setOf("kind","data")&&raw["kind"]==JsonPrimitive(r.module))
            val row=LocalDogtalkStore.Row(r.module,raw.getValue("data").jsonObject)
            LocalDogtalkStore.validate(row);require(r.id==row.id&&r.dependencies.toSet()==row.dependencies.toSet())
            row
        }
    }
    fun apply(rows:List<LocalDogtalkStore.Row>,selection:Set<String>,target:LocalPersistence,histories:Map<String,RemoteHistory>,conflicts:Set<String>,write:Boolean):Map<String,LocalRestoreCount>{
        val store=LocalDogtalkStore(target);val old=store.read();val byId=old.associateBy{it.id}
        require(rows.all{byId[it.id]==null||byId[it.id]==it}){"目标狗话内容冲突，不覆盖。"}
        val next=old+rows.filter{it.id !in byId};LocalDogtalkStore.validateRows(next)
        var detached=0
        // A snapshot is immutable history, not an active draft. Legacy room IDs and
        // pruned turn IDs can outlive their original messages. Preserve the exact
        // record without fabricating a new message link or changing its source ID.
        val references=histories.flatMap{(cid,h)->h.turns.flatMap{t->
            (t.user.variants+t.assistant.variantsByUserVariant.values.flatten()).mapNotNull{v->
                v.dogtalkSnapshotId?.takeIf{it.isNotBlank()}?.let{Triple(it,cid,t.id)}
            }
        }}.groupBy{it.first}
        val snapshotData=next.filter{it.module=="dogtalk_snapshots"}.associate{it.id to it.data}
        for(r in rows){
            val cid=r.data["conversation_id"]?.jsonPrimitive?.contentOrNull
            if(cid!=null)require(cid in histories&&cid !in conflicts){"狗话原窗口缺失或冲突。"}
            if(r.module=="dogtalk_snapshots"){
                val refs=references[r.id].orEmpty()
                // A live explicit reference must still match exactly. Detached
                // snapshots are never allowed to satisfy a mismatched live link.
                for(ref in refs){
                    require(ref.second !in conflicts){"狗话原窗口缺失或冲突。"}
                    LocalDogtalkStore.checkReference(ref.second,ref.third,r.id,snapshotData)
                }
                val linked=r.data["source_type"]==JsonPrimitive("turn")&&cid!=null&&
                    histories.getValue(cid).turns.any{it.id==r.data["source_id"]?.jsonPrimitive?.content}
                if(!linked){
                    require(refs.isEmpty()){"狗话历史快照与原轮次不一致。"}
                    detached++
                }
            }
        }
        if(write)store.write(next)
        return selection.intersect(LocalDogtalkStore.modules).associateWith{module->
            val group=rows.filter{it.module==module};val existing=group.count{it.id in byId}
            LocalRestoreCount(group.size-existing,existing,0,if(module=="dogtalk_snapshots")detached else 0)
        }
    }
}
