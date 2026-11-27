package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.remote.*
import kotlinx.serialization.json.*
import java.util.UUID

/** Historical autonomous activity is inert on import. It is not a device job. */
internal class LocalDreamArchive(private val store:LocalPersistence){
    private val json=Json{ignoreUnknownKeys=true;encodeDefaults=true;explicitNulls=true}
    private val lists=listOf("runs","steps","tools","notes","replies")
    private fun key(cid:String)="local.dream.archive."+cid
    private fun draftKey(cid:String)="local.dream.settings."+cid
    private fun JsonObject.str(k:String)=getValue(k).jsonPrimitive.content
    private fun JsonObject.rows(k:String)=getValue(k).jsonArray.map{it.jsonObject}
    private fun id(v:String)=v.matches(Regex("[A-Za-z0-9_.:-]{1,160}"))
    private fun emptyHistory()=buildJsonObject{put("version",1);put("settings",JsonNull);lists.forEach{put(it,JsonArray(emptyList()))}}
    private fun history(cid:String)=store.get(key(cid)).takeIf{it.isNotBlank()}?.let{json.parseToJsonElement(it).jsonObject}?:emptyHistory()
    internal fun runtimeHistory(cid:String)=history(cid)
    internal fun writeRuntimeHistory(cid:String,value:JsonObject)=store.put(key(cid),value.toString())
    private fun validate(value:JsonObject,cid:String,allowRunning:Boolean=false):DreamSettings?{
        require(id(cid)&&value.keys==lists.toSet()+setOf("version","settings")&&value["version"]?.jsonPrimitive?.int==1)
        require(value.toString().encodeToByteArray().size<=1400000)
        val rows=lists.associateWith{value.rows(it).also{r->require(r.size<=20000)}}
        val runs=rows.getValue("runs").associateBy{it.str("claim_id")}
        require(runs.size==rows.getValue("runs").size)
        require(runs.values.all{r->id(r.str("claim_id"))&&r.str("conversation_id")==cid&&(r.str("status") in setOf("completed","failed","cancelled","interrupted")||allowRunning&&r.str("status")=="running")})
        val notes=rows.getValue("notes").associateBy{it.str("claim_id")}
        require(notes.size==rows.getValue("notes").size)
        require(notes.values.all{r->r.str("conversation_id")==cid&&runs.containsKey(r.str("claim_id"))&&r.str("body").isNotBlank()&&r.str("body").length<=16000})
        require(rows.getValue("replies").map{it.str("id")}.distinct().size==rows.getValue("replies").size)
        require(rows.getValue("replies").all{r->id(r.str("id"))&&r.str("conversation_id")==cid&&notes.containsKey(r.str("claim_id"))&&r.str("body").isNotBlank()&&r.str("body").length<=16000})
        require(listOf("steps","tools").all{k->rows.getValue(k).all{r->runs.containsKey(r.str("claim_id"))&&r.str("status") in setOf("claimed","completed","failed")}})
        val settings=value.getValue("settings")
        if(settings==JsonNull)return null
        val s=settings.jsonObject
        require(s.keys==setOf("modelId","config"))
        val model=s.str("modelId");require(model.isNotBlank()&&model.length<=180)
        val cfg=json.decodeFromJsonElement(DreamConfig.serializer(),s.getValue("config"))
        val clock=Regex("([01][0-9]|2[0-3]):[0-5][0-9]")
        require(clock.matches(cfg.dailyTime));java.time.ZoneId.of(cfg.timeZone)
        cfg.quietHours?.let{require(clock.matches(it.start)&&clock.matches(it.end))}
        cfg.execution?.let{e->require(e.tokenBudget in 1..1000000&&e.outputLimit in 1..65536&&e.toolBudget in 0..128&&e.readTurns in 1..400&&e.extraPerDay in 0..128&&e.invitation.isNotBlank()&&e.invitation.length<=16000)}
        return DreamSettings(revision=UUID.randomUUID().toString(),enabled=false,config=cfg,modelId=model)
    }
    fun export(cid:String):JsonObject?{
        val history=history(cid)
        require(history.rows("runs").none{it.str("status")=="running"}){"窗口正在自主唤醒，请结束活动后再归档。"}
        val draft=store.get(draftKey(cid)).takeIf{it.isNotBlank()}?.let{json.decodeFromString(DreamSettings.serializer(),it)}
        val settings=if(draft?.config!=null&&draft.modelId!=null)buildJsonObject{
            put("modelId",draft.modelId);put("config",json.encodeToJsonElement(DreamConfig.serializer(),draft.config))
        }else JsonNull
        val v=JsonObject(history+("settings" to settings))
        if(settings==JsonNull&&lists.all{v.rows(it).isEmpty()})return null
        validate(v,cid);return v
    }
    fun restore(cid:String,value:JsonObject,write:Boolean){
        val draft=validate(value,cid)
        // Never merge over another draft or any historical receipts.
        val existing=export(cid)
        if(existing!=null){
            val old=validate(existing,cid)
            require(existing.filterKeys{it!="settings"}==value.filterKeys{it!="settings"}&&old?.config==draft?.config&&old?.modelId==draft?.modelId){"本窗口已有不同的自主唤醒资料，未覆盖。"}
            return
        }
        if(write){
            store.put(key(cid),JsonObject(value+("settings" to JsonNull)).toString())
            draft?.let{store.put(draftKey(cid),json.encodeToString(DreamSettings.serializer(),it))}
        }
    }
    fun validateMediaOrigin(archive:JsonObject?,row:JsonObject,kind:String){
        val prefix=if(kind=="voice")"voice_dream_" else "att_dream_"
        val mediaId=row.str("id")
        if(!mediaId.startsWith(prefix)&&!(kind=="voice"&&row["source"]==JsonPrimitive("dream_tide")))return
        require(row["turn_id"]==JsonNull&&(if(kind=="voice")row["message_id"]==JsonNull&&row["source"]==JsonPrimitive("dream_tide") else row["kind"]==JsonPrimitive("image"))){"自主媒体来源无效。"}
        val name=if(kind=="voice")"voice_create" else "image_generate"
        val event=archive?.rows("tools")?.firstOrNull{it.str("tool_name")==name&&mediaId==prefix+it.str("claim_id")+"_"+it.str("step_index")+"_"+it.str("call_index")}
        require(event!=null&&archive.rows("runs").any{it.str("claim_id")==event.str("claim_id")&&it.str("conversation_id")==row.str("conversation_id")}){"自主媒体所属活动缺失。"}
        val recorded=event["receipt_json"]?.jsonPrimitive?.contentOrNull?.let{json.parseToJsonElement(it).jsonObject["record_id"]?.jsonPrimitive?.contentOrNull}
        require(recorded==null||recorded==mediaId){"自主媒体回执不一致。"}
    }
    private fun receipt(row:JsonObject,key:String,target:String)=JsonObject(row.filterKeys{it!=key}+(target to (row[key]?.jsonPrimitive?.contentOrNull?.let{json.parseToJsonElement(it)}?:JsonNull)))
    fun notes(cid:String,offset:Int):JsonObject{
        val h=history(cid)
        val all=h.rows("notes").sortedByDescending{it.getValue("created_at").jsonPrimitive.long}
        val page=all.drop(offset).take(20).map{n->JsonObject(n+("replies" to JsonArray(h.rows("replies").filter{it.str("claim_id")==n.str("claim_id")})))}
        return buildJsonObject{put("ok",true);put("items",JsonArray(page));put("nextOffset",if(offset+page.size<all.size)JsonPrimitive(offset+page.size)else JsonNull)}
    }
    fun activity(cid:String,offset:Int):JsonObject{
        val h=history(cid)
        val all=h.rows("runs").sortedByDescending{it.getValue("started_at").jsonPrimitive.long}
        val page=all.drop(offset).take(20).map{r->
            val claim=r.str("claim_id")
            JsonObject(receipt(r,"result_json","result")+mapOf(
                "steps" to JsonArray(h.rows("steps").filter{it.str("claim_id")==claim}.map{receipt(it,"receipt_json","receipt")}),
                "tools" to JsonArray(h.rows("tools").filter{it.str("claim_id")==claim}.map{receipt(it,"receipt_json","receipt")})))
        }
        return buildJsonObject{put("ok",true);put("items",JsonArray(page));put("nextOffset",if(offset+page.size<all.size)JsonPrimitive(offset+page.size)else JsonNull)}
    }
    fun chatReadback(cid:String,kind:String,offset:Int,limit:Int):JsonObject{
        require(kind in setOf("notes","activity")&&offset in 0..100000&&limit in 1..5)
        val h=history(cid)
        val all=if(kind=="notes")h.rows("notes").sortedWith(compareByDescending<JsonObject>{it.getValue("created_at").jsonPrimitive.long}.thenBy{it.str("claim_id")})
            else h.rows("runs").sortedWith(compareByDescending<JsonObject>{it.getValue("started_at").jsonPrimitive.long}.thenBy{it.str("claim_id")})
        val selected=all.drop(offset).take(limit).map{r->
            val claim=r.str("claim_id")
            if(kind=="notes")JsonObject(r.filterKeys{it in setOf("claim_id","model_id","body","created_at")}+("replies" to JsonArray(h.rows("replies").filter{it.str("claim_id")==claim}.map{JsonObject(it.filterKeys{k->k in setOf("body","created_at")})})))
            else buildJsonObject{
                for(k in listOf("claim_id","kind","model_id","status","started_at","updated_at"))put(k,r.getValue(k))
                val result=r["result_json"]?.jsonPrimitive?.contentOrNull?.let{json.parseToJsonElement(it).jsonObject}
                put("result",result?.let{JsonObject(it.filterKeys{k->k in setOf("total_tokens","reported_cost","extra_scheduled")})}?:JsonNull)
                put("tools",JsonArray(h.rows("tools").filter{it.str("claim_id")==claim}.map{JsonObject(it.filterKeys{k->k in setOf("tool_name","status")})}))
            }
        }
        val out=buildJsonObject{put("ok",true);put("kind",kind);put("reference_only",true);put("items",JsonArray(selected));put("nextOffset",if(offset+selected.size<all.size)JsonPrimitive(offset+selected.size)else JsonNull)}
        require(out.toString().length<=10000){"资料超出单次阅读容量，请减少条数。"}
        return out
    }
    fun reply(cid:String,claim:String,rid:String,body:String):Boolean=store.readConsistent{s->LocalDreamArchive(s).replyLocked(cid,claim,rid,body)}
    private fun replyLocked(cid:String,claim:String,rid:String,body:String):Boolean{
        require(id(rid)&&body.isNotBlank()&&body.length<=16000)
        val h=history(cid);if(h.rows("notes").none{it.str("claim_id")==claim})return false
        val prior=h.rows("replies").firstOrNull{it.str("id")==rid}
        if(prior!=null)return prior.str("claim_id")==claim&&prior.str("body")==body
        val row=buildJsonObject{put("id",rid);put("claim_id",claim);put("conversation_id",cid);put("body",body);put("created_at",System.currentTimeMillis())}
        val next=JsonObject(h+("replies" to JsonArray(h.rows("replies")+row)))
        validate(next,cid,allowRunning=true);store.put(key(cid),next.toString());return true
    }
    fun remove(cid:String){store.remove(key(cid));store.remove(draftKey(cid))}
}
