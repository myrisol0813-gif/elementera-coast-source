package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.remote.*
import java.time.Instant
import java.time.ZoneId
import java.time.LocalTime
import java.util.UUID
import kotlinx.serialization.json.*

/** One device process owns the local workspace. The persisted claim, not
 * the in-memory mutex, is the authority for a potentially billable step. */
internal object LocalDreamRuntime {
    private var holder: String?=null
    @Synchronized fun acquire(): AutoCloseable? {
        if(holder!=null)return null
        val key=UUID.randomUUID().toString();holder=key
        return AutoCloseable{synchronized(this){if(holder==key)holder=null}}
    }
    @Synchronized fun busy()=holder!=null
}

internal data class LocalDreamSlot(val kind:String,val key:String,val day:String)
internal object LocalDreamSchedule {
    fun day(at:Long,zone:String)=Instant.ofEpochMilli(at).atZone(ZoneId.of(zone)).toLocalDate().toString()
    private fun minute(at:Long,zone:String)=Instant.ofEpochMilli(at).atZone(ZoneId.of(zone)).toLocalTime().let{it.hour*60+it.minute}
    private fun minute(value:String)=LocalTime.parse(value).let{it.hour*60+it.minute}
    fun candidate(settings:DreamSettings,used:Set<String>,now:Long):LocalDreamSlot?{
        val c=settings.config?:return null
        val armed=settings.armedAt?:return null
        if(!settings.enabled||c.execution==null||armed>now)return null
        val here=day(now,c.timeZone);val m=minute(now,c.timeZone)
        c.quietHours?.let{val a=minute(it.start);val b=minute(it.end);if(a==b||if(a<b)m in a until b else m>=a||m<b)return null}
        val daily=minute(c.dailyTime)
        if(m>=daily&&!(day(armed,c.timeZone)==here&&minute(armed,c.timeZone)>daily)&&"daily:"+here !in used)
            return LocalDreamSlot("daily","daily:"+here,here)
        val extra=settings.extraAt?:return null
        val extraId=settings.extraId?:return null
        if(!c.allowExtra||c.execution.extraPerDay<=0||extra<armed||extra>now||day(extra,c.timeZone)!=here||"extra:"+extraId in used)return null
        return LocalDreamSlot("extra","extra:"+extraId,here)
    }
}

internal class LocalDreamLedger(private val store:LocalPersistence){
    private val json=Json{ignoreUnknownKeys=true;encodeDefaults=true;explicitNulls=true}
    data class Claim(val cid:String,val id:String,val revision:String,val model:String,val config:DreamConfig,val slot:LocalDreamSlot,val startedAt:Long)
    private fun key(cid:String)="local.dream.settings."+cid
    private fun JsonObject.str(k:String)=getValue(k).jsonPrimitive.content
    private fun JsonObject.rows(k:String)=getValue(k).jsonArray.map{it.jsonObject}
    private fun save(s:LocalPersistence,cid:String,value:DreamSettings)=s.put(key(cid),json.encodeToString(DreamSettings.serializer(),value.copy(running=false)))
    private fun draft(s:LocalPersistence,cid:String)=s.get(key(cid)).takeIf{it.isNotBlank()}?.let{json.decodeFromString(DreamSettings.serializer(),it)}?:DreamSettings()
    private fun live(s:LocalPersistence,cid:String)=RemoteCacheStore(s,strictReads=true).conversations().any{it.id==cid&&it.roomType=="main"&&it.source=="coast"&&it.deletedAt==null}
    private fun active(h:JsonObject)=h.rows("runs").firstOrNull{it.str("status")=="running"}
    fun active(cid:String)=store.readConsistent{s->active(LocalDreamArchive(s).runtimeHistory(cid))!=null}
    fun settings(cid:String)=store.readConsistent{s->draft(s,cid).copy(running=active(LocalDreamArchive(s).runtimeHistory(cid))!=null)}
    fun configure(cid:String,request:DreamSettingsRequest,enableAllowed:Boolean,now:Long=System.currentTimeMillis()):DreamSettings?=store.readConsistent{s->
        if(!live(s,cid))return@readConsistent null
        val old=draft(s,cid)
        if(old.revision!=request.revision)return@readConsistent null
        val running=active(LocalDreamArchive(s).runtimeHistory(cid))!=null
        if(request.action=="disarm"){
            val next=old.copy(enabled=false,revision=UUID.randomUUID().toString(),armedAt=null,extraAt=null,extraId=null)
            save(s,cid,next);return@readConsistent next.copy(running=running)
        }
        if(running||request.action !in setOf("save","arm"))return@readConsistent null
        val cfg=requireNotNull(request.config);val e=requireNotNull(cfg.execution)
        val model=request.modelId.orEmpty().trim()
        require(model.isNotBlank()&&model.length<=180)
        val clock=Regex("([01][0-9]|2[0-3]):[0-5][0-9]")
        require(clock.matches(cfg.dailyTime));ZoneId.of(cfg.timeZone)
        cfg.quietHours?.let{require(clock.matches(it.start)&&clock.matches(it.end))}
        require(e.tokenBudget in 1..1000000&&e.outputLimit in 1..65536&&e.toolBudget in 0..128&&e.readTurns in 1..400&&e.extraPerDay in 0..128&&e.invitation.isNotBlank()&&e.invitation.length<=16000)
        val arm=request.action=="arm"
        if(arm&&(!enableAllowed||!request.confirmExecution||!model.startsWith("local:")||'/' !in model))return@readConsistent null
        val next=DreamSettings(revision=UUID.randomUUID().toString(),enabled=arm,config=cfg,modelId=model,armedAt=if(arm)now else null)
        save(s,cid,next);next
    }
    private fun authorized(s:LocalPersistence,c:Claim,h:JsonObject):Boolean{
        val a=draft(s,c.cid)
        return a.enabled&&a.revision==c.revision&&a.modelId==c.model&&live(s,c.cid)&&active(h)?.str("claim_id")==c.id
    }
    fun authorized(c:Claim)=store.readConsistent{s->authorized(s,c,LocalDreamArchive(s).runtimeHistory(c.cid))}
    // Caller must own the process generation gate, including recovery. A
    // process-dead reservation becomes interrupted and consumes its slot.
    fun recover(cid:String,now:Long)=store.readConsistent{s->
        val initial=active(LocalDreamArchive(s).runtimeHistory(cid))?:return@readConsistent false
        s.atomic{staged->
            val a=LocalDreamArchive(staged);val h=a.runtimeHistory(cid);val r=active(h)?:return@atomic false
            if(r.str("claim_id")!=initial.str("claim_id"))return@atomic false
            val result=buildJsonObject{put("reason","process_interrupted");put("total_tokens",JsonNull);put("reported_cost",JsonNull);put("extra_scheduled",false)}
            val row=JsonObject(r+mapOf("status" to JsonPrimitive("interrupted"),"updated_at" to JsonPrimitive(maxOf(now,r["started_at"]!!.jsonPrimitive.long)),
                "result_json" to JsonPrimitive(result.toString())))
            a.writeRuntimeHistory(cid,JsonObject(h+("runs" to JsonArray(h.rows("runs").map{if(it==r)row else it}))))
            val current=draft(staged,cid)
            if(r.str("kind")=="extra"&&r.str("slot_key")=="extra:"+current.extraId)
                save(staged,cid,current.copy(extraId=null,extraAt=null))
            true
        }
    }
    fun claim(cid:String,expectedRevision:String,expectedModel:String,now:Long):Claim?=store.readConsistent{s->
        if(!live(s,cid)||LocalReplyRunStore(s).active(cid))return@readConsistent null
        val a=draft(s,cid);val cfg=a.config?:return@readConsistent null
        if(a.revision!=expectedRevision||a.modelId!=expectedModel||!a.enabled)return@readConsistent null
        val archive=LocalDreamArchive(s);val h=archive.runtimeHistory(cid)
        if(active(h)!=null)return@readConsistent null
        val runs=h.rows("runs")
        val slot=LocalDreamSchedule.candidate(a,runs.map{it.str("slot_key")}.toSet(),now)?:return@readConsistent null
        if(slot.kind=="extra"&&runs.count{it.str("kind")=="extra"&&it.str("local_day")==slot.day}>=requireNotNull(cfg.execution).extraPerDay)return@readConsistent null
        val claim=Claim(cid,UUID.randomUUID().toString(),expectedRevision,expectedModel,cfg,slot,now)
        val row=buildJsonObject{put("claim_id",claim.id);put("conversation_id",cid);put("slot_key",slot.key);put("local_day",slot.day);put("kind",slot.kind);put("model_id",expectedModel);put("status","running");put("started_at",now);put("updated_at",now);put("result_json",JsonNull)}
        archive.writeRuntimeHistory(cid,JsonObject(h+("runs" to JsonArray(runs+row))));claim
    }
    private fun mutate(c:Claim,permission:Boolean=true,block:(JsonObject)->JsonObject?):Boolean=store.readConsistent{s->
        val a=LocalDreamArchive(s);val h=a.runtimeHistory(c.cid)
        if(active(h)?.str("claim_id")!=c.id||permission&&!authorized(s,c,h))return@readConsistent false
        val next=block(h)?:return@readConsistent false
        a.writeRuntimeHistory(c.cid,next);true
    }
    fun reserveStep(c:Claim,index:Int,now:Long)=mutate(c){h->
        val rows=h.rows("steps");val prior=rows.filter{it.str("claim_id")==c.id}
        if(index!=prior.size||prior.any{it.str("status")!="completed"}||index>requireNotNull(c.config.execution).toolBudget)return@mutate null
        val row=buildJsonObject{put("claim_id",c.id);put("step_index",index);put("status","claimed");put("receipt_json",JsonNull);put("started_at",now);put("finished_at",JsonNull)}
        JsonObject(h+("steps" to JsonArray(rows+row)))
    }
    fun recordStep(c:Claim,index:Int,success:Boolean,receipt:JsonObject,now:Long)=mutate(c,false){h->
        val rows=h.rows("steps");val old=rows.singleOrNull{it.str("claim_id")==c.id&&it.str("step_index")==index.toString()&&it.str("status")=="claimed"}?:return@mutate null
        val row=JsonObject(old+mapOf("status" to JsonPrimitive(if(success)"completed"else "failed"),"receipt_json" to JsonPrimitive(receipt.toString()),"finished_at" to JsonPrimitive(now)))
        JsonObject(h+("steps" to JsonArray(rows.map{if(it==old)row else it})))
    }
    fun toolClaimed(c:Claim,callId:String,name:String)=store.readConsistent{s->
        val h=LocalDreamArchive(s).runtimeHistory(c.cid)
        authorized(s,c,h)&&LocalDreamToolPolicy.allowed(c,name)&&h.rows("tools").any{r->
            r.str("claim_id")==c.id&&r.str("tool_name")==name&&r.str("status")=="claimed"&&
                callId==c.id+":"+r.str("step_index")+":"+r.str("call_index")}
    }
    fun reserveTool(c:Claim,step:Int,index:Int,name:String,now:Long)=mutate(c){h->
        val e=requireNotNull(c.config.execution)
        if(!LocalDreamToolPolicy.allowed(c,name))return@mutate null
        val rows=h.rows("tools")
        if(rows.count{it.str("claim_id")==c.id}>=e.toolBudget||rows.any{it.str("claim_id")==c.id&&it.str("step_index")==step.toString()&&it.str("call_index")==index.toString()}||
            h.rows("steps").none{it.str("claim_id")==c.id&&it.str("step_index")==step.toString()&&it.str("status")=="completed"})return@mutate null
        val row=buildJsonObject{put("claim_id",c.id);put("step_index",step);put("call_index",index);put("tool_name",name);put("status","claimed");put("receipt_json",JsonNull);put("started_at",now);put("finished_at",JsonNull)}
        JsonObject(h+("tools" to JsonArray(rows+row)))
    }
    fun recordTool(c:Claim,step:Int,index:Int,ok:Boolean,count:Int?,now:Long,recordId:String?=null)=mutate(c,false){h->
        val rows=h.rows("tools");val old=rows.singleOrNull{it.str("claim_id")==c.id&&it.str("step_index")==step.toString()&&it.str("call_index")==index.toString()&&it.str("status")=="claimed"}?:return@mutate null
        val receipt=buildJsonObject{put("ok",ok);count?.let{put("count",it)};recordId?.takeIf{it.matches(Regex("[A-Za-z0-9_.:-]{1,160}"))}?.let{put("record_id",it)}}
        val row=JsonObject(old+mapOf("status" to JsonPrimitive(if(ok)"completed"else "failed"),"receipt_json" to JsonPrimitive(receipt.toString()),"finished_at" to JsonPrimitive(now)))
        JsonObject(h+("tools" to JsonArray(rows.map{if(it==old)row else it})))
    }
    fun note(c:Claim,body:String,now:Long)=mutate(c){h->
        if(c.config.execution?.writeNote!=true||body.isBlank()||body.length>16000||h.rows("notes").any{it.str("claim_id")==c.id})return@mutate null
        val row=buildJsonObject{put("claim_id",c.id);put("conversation_id",c.cid);put("model_id",c.model);put("body",body);put("created_at",now)}
        JsonObject(h+("notes" to JsonArray(h.rows("notes")+row)))
    }
    fun previous(c:Claim)=store.readConsistent{s->LocalDreamArchive(s).runtimeHistory(c.cid).rows("runs").filter{it.str("claim_id")!=c.id}.maxByOrNull{it["started_at"]!!.jsonPrimitive.long}}
    fun finish(c:Claim,status:String,result:JsonObject,extra:Long?,now:Long):Boolean=store.atomic{s->
        require(status in setOf("completed","failed","cancelled","interrupted"))
        val a=LocalDreamArchive(s);val h=a.runtimeHistory(c.cid);val r=active(h)
        if(r?.str("claim_id")!=c.id)return@atomic false
        val old=draft(s,c.cid);val auth=authorized(s,c,h)
        val finalStatus=if(status=="completed"&&!auth)"cancelled"else status
        var next=old
        if(old.revision==c.revision&&c.slot.kind=="extra"&&c.slot.key=="extra:"+old.extraId)next=next.copy(extraAt=null,extraId=null)
        if(next.extraAt!=null&&LocalDreamSchedule.day(next.extraAt!!,c.config.timeZone)<LocalDreamSchedule.day(now,c.config.timeZone)&&old.revision==c.revision)next=next.copy(extraAt=null,extraId=null)
        val extraAllowed=auth&&finalStatus=="completed"&&extra!=null&&extra>now&&next.extraAt==null&&c.config.allowExtra&&
            h.rows("runs").count{it.str("kind")=="extra"&&it.str("local_day")==LocalDreamSchedule.day(extra,c.config.timeZone)}<requireNotNull(c.config.execution).extraPerDay
        if(extraAllowed)next=next.copy(extraAt=extra,extraId=c.id)
        val out=JsonObject(result+("extra_scheduled" to JsonPrimitive(extraAllowed)))
        val row=JsonObject(r+mapOf("status" to JsonPrimitive(finalStatus),"updated_at" to JsonPrimitive(maxOf(now,c.startedAt)),"result_json" to JsonPrimitive(out.toString())))
        a.writeRuntimeHistory(c.cid,JsonObject(h+("runs" to JsonArray(h.rows("runs").map{if(it==r)row else it}))))
        if(next!=old)save(s,c.cid,next)
        true
    }
}
