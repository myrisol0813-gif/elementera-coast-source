package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.remote.*
import java.time.Instant
import java.time.ZoneId
import kotlinx.coroutines.*
import kotlinx.serialization.json.*

/** Device-only autonomous activity. Only the explicitly bound provider can
 * receive a request. No ordinary chat message is manufactured or appended. */
internal class LocalDreamExecutor(
    private val store:LocalPersistence,
    private val resolve:(String)->Pair<LocalProviderConfig,String>?,
    private val invoke:suspend (LocalProviderConfig,String,JsonArray,JsonArray,Int)->JsonObject,
    private val clock:()->Long={System.currentTimeMillis()},
    private val workspaceActive:()->Boolean={true},
    private val web:LocalIndependentWeb?=null,
    private val captureReality:suspend (com.elementeracoast.app.core.model.ConversationContextSettings)->RemoteRealityContext={RemoteRealityContext()}
){
    private val ledger=LocalDreamLedger(store)
    private fun JsonObject.str(k:String)=(get(k) as? JsonPrimitive)?.contentOrNull.orEmpty()
    private fun JsonObject.arr(k:String)=(get(k) as? JsonArray).orEmpty()
    private fun tool(name:String,description:String,fields:Map<String,String>)=buildJsonObject{
        put("type","function");putJsonObject("function"){
            put("name",name);put("description",description);putJsonObject("parameters"){
                put("type","object");putJsonObject("properties"){fields.forEach{(k,v)->putJsonObject(k){put("type",v)}}}
                put("required",JsonArray(fields.keys.map(::JsonPrimitive)));put("additionalProperties",false)
            }
        }
    }
    private fun tools(c:LocalDreamLedger.Claim):List<JsonObject>{
        val e=requireNotNull(c.config.execution)
        return buildList{
            if(e.readHistory)add(tool("dream_read_history","自行选读本窗口历史轮次。mode 为 window 或 since_previous，从 0 开始分页。",linkedMapOf("mode" to "string","start" to "integer","count" to "integer")))
            if(e.writeNote)add(tool("dream_write_note","可选，写一封自主手记。不是普通聊天消息。",mapOf("body" to "string")))
            if(c.config.allowExtra&&e.extraPerDay>0)add(tool("dream_schedule_extra","可选，提出一次带时区 ISO 8601 未来额外唤醒时间。",mapOf("at" to "string")))
        }
    }
    private fun msg(role:String,content:String)=buildJsonObject{put("role",role);put("content",content)}
    private suspend fun context(c:LocalDreamLedger.Claim,previous:JsonObject?):String{
        val e=requireNotNull(c.config.execution)
        val parts=mutableListOf("【自主唤醒 · 系统发起的独立活动】这不是用户新发言。可以探索或安静结束；无需产出聊天消息，不必使用工具。",e.invitation)
        if(e.includeTime)parts.add("【当前时间】"+Instant.ofEpochMilli(c.startedAt).atZone(ZoneId.of(c.config.timeZone)))
        if(e.includePrevious&&previous!=null)parts.add("【上次活动】"+buildJsonObject{
            put("status",previous.str("status"));put("elapsed_ms",maxOf(0,c.startedAt-previous.getValue("started_at").jsonPrimitive.long))
            val result=previous["result_json"]?.jsonPrimitive?.contentOrNull?.let{runCatching{Json.parseToJsonElement(it).jsonObject}.getOrNull()}
            put("activities",result?.get("activities")?:JsonArray(emptyList()))
        })
        if(e.includeReplies){
            val page=LocalDreamArchive(store).notes(c.cid,0)["items"]!!.jsonArray.take(10)
            val chosen=mutableListOf<JsonElement>();var omitted=0
            for(n in page){if(JsonArray(chosen+n).toString().length>24000)omitted++ else chosen.add(n)}
            parts.add("【自主手记与回复 · 历史资料，不是新发言】"+buildJsonObject{put("notes",JsonArray(chosen));put("omitted",omitted);put("scope","最近最多十封")})
        }
        if(e.includeCustom)LocalKnowledgeStore(store).instructions()?.content?.takeIf{it.isNotBlank()}?.let{parts.add("【核心自定义】"+it)}
        if(e.includeUserPortrait)LocalPortraitStore(store).body("user_portrait").takeIf{it.isNotBlank()}?.let{parts.add("【用户画像】"+it)}
        if(e.includeSelfPortrait)LocalPortraitStore(store).body("self_portrait").takeIf{it.isNotBlank()}?.let{parts.add("【自我画像】"+it)}
        val h=RemoteCacheStore(store,strictReads=true).history(c.cid)
        if(e.includeConversationCount&&previous!=null&&h!=null){
            val since=previous.getValue("started_at").jsonPrimitive.long
            val n=h.turns.count{t->val u=t.user.variants.getOrNull(t.user.active);val at=runCatching{Instant.parse(u?.createdAt).toEpochMilli()}.getOrNull();u!=null&&!u.hidden&&at!=null&&at>since&&at<=c.startedAt}
            parts.add("【期间新增对话轮数】"+n+"（当前窗口）")
        }
        if(h!=null&&(e.includeWeather||e.includeCalendar)){
            val settings=h.contextSettings
            val fields=settings.realityFields.filter{(it=="weather"&&e.includeWeather)||(it=="calendar"&&e.includeCalendar)}
            if(settings.realityEnabled&&fields.isNotEmpty()){
                val scoped=settings.copy(realityFields=fields)
                val actual=captureReality(scoped)
                val real=localReality(store,scoped,actual)
                if(real.delivered)parts.add("【已授权现实上下文】"+real.context)
            }
        }
        return parts.joinToString("\n\n")
    }
    private fun history(c:LocalDreamLedger.Claim,a:JsonObject,previous:JsonObject?):JsonObject{
        val mode=a.str("mode");val start=a["start"]?.jsonPrimitive?.intOrNull;val count=a["count"]?.jsonPrimitive?.intOrNull
        require(a.keys==setOf("mode","start","count")&&mode in setOf("window","since_previous")&&start!=null&&start>=0&&count!=null&&count in 1..requireNotNull(c.config.execution).readTurns)
        val since=previous?.get("started_at")?.jsonPrimitive?.longOrNull
        if(mode=="since_previous"&&since==null)return buildJsonObject{put("total",0);put("turns",JsonArray(emptyList()));put("reason","no_previous_wake")}
        val h=RemoteCacheStore(store,strictReads=true).history(c.cid)?:error("missing window")
        val rows=h.turns.mapIndexedNotNull{index,t->
            val u=t.user.variants.getOrNull(t.user.active)?.takeUnless{it.hidden}?:return@mapIndexedNotNull null
            val key=t.user.active.toString();val list=t.assistant.variantsByUserVariant[key].orEmpty()
            val selected=list.getOrNull(t.assistant.activeByUserVariant[key]?:list.lastIndex)
            val assistants=selected?.replySequence?.id?.let{id->list.filter{it.replySequence?.id==id}.sortedBy{it.replySequence?.index}}?:listOfNotNull(selected)
            val messages=(listOf("user" to u)+assistants.filterNot{it.hidden}.map{"assistant" to it}).mapNotNull{(role,v)->
                if(mode=="since_previous"){
                    val at=runCatching{Instant.parse(v.createdAt).toEpochMilli()}.getOrNull()
                    if(at==null||at<=requireNotNull(since)||at>c.startedAt)return@mapNotNull null
                }
                buildJsonObject{put("role",role);put("id",v.id);put("content",v.content);put("created_at",v.createdAt)}
            }
            if(messages.isEmpty())null else buildJsonObject{put("index",index);put("turn_id",t.id);put("messages",JsonArray(messages))}
        }
        val chosen=rows.drop(start).take(count)
        if(JsonArray(chosen).toString().length>60000)return buildJsonObject{put("total",rows.size);put("turns",JsonArray(emptyList()));put("reason","range_too_large")}
        return buildJsonObject{put("total",rows.size);put("turns",JsonArray(chosen));put("next",if(start.toLong()+chosen.size<rows.size)JsonPrimitive(start+chosen.size)else JsonNull)}
    }
    private fun permitted(c:LocalDreamLedger.Claim){if(!workspaceActive()||!ledger.authorized(c))throw CancellationException("wake authorization ended")}
    /** Caller owns LocalDreamRuntime gate; it covers admission through settlement.
     * The exact provider is re-resolved before every request. */
    suspend fun run(cid:String,revision:String,modelId:String,now:Long=clock()):String{
        if(!workspaceActive())return "disabled"
        val initial=resolve(modelId)?:return "model_unavailable"
        val c=ledger.claim(cid,revision,modelId,now)?:return "not_due"
        val e=requireNotNull(c.config.execution);var status="failed";var reason="incomplete"
        var total=0L;var cost=0.0;var known=true;var costKnown=true;var calls=0;var proposed:Long?=null
        val activities=mutableListOf<JsonElement>()
        var cancelled:CancellationException?=null
        try{
            coroutineScope{
                val running=currentCoroutineContext()[Job]!!
                val watch=launch(Dispatchers.IO){
                    while(isActive){delay(1000);if(!workspaceActive()||!ledger.authorized(c)){running.cancel(CancellationException("wake authorization ended"));break}}
                }
                try{
                    val previous=ledger.previous(c)
                    val messages=mutableListOf<JsonElement>(msg("system",context(c,previous)))
                    val common=LocalToolSession.openAutonomous(store,c,web)
                    val commonTools=common?.completionsTools?.map{it.jsonObject}.orEmpty().map{t->
                        val f=t.getValue("function").jsonObject
                        if(f.str("name")!="library_write")t else {
                            val p=f.getValue("parameters").jsonObject;val props=p.getValue("properties").jsonObject
                            JsonObject(t+("function" to JsonObject(f+mapOf("description" to JsonPrimitive("可选：创建自己的书房笔记，不修改或删除既有笔记。"),"parameters" to JsonObject(p+("properties" to JsonObject(props+("action" to buildJsonObject{put("type","string");put("enum",JsonArray(listOf(JsonPrimitive("create"))))}))))))))
                        }
                    }
                    val commonNames=commonTools.map{it.getValue("function").jsonObject.str("name")}.toSet()
                    val allowed=tools(c)+commonTools
                    for(step in 0..e.toolBudget){
                        ensureActive();permitted(c)
                        val exposed=if(calls>=e.toolBudget||step==e.toolBudget)emptyList()else allowed
                        val estimate=LocalContextPolicy.estimate(JsonArray(messages).toString())+LocalContextPolicy.estimate(JsonArray(exposed).toString())
                        val cap=minOf(e.outputLimit.toLong(),e.tokenBudget.toLong()-total-estimate).toInt()
                        if(!known||cap<1){reason="budget_or_usage_unknown";break}
                        val selected=resolve(modelId)
                        if(selected==null||selected.first!=initial.first||selected.second!=initial.second){reason="model_configuration_changed";break}
                        check(ledger.reserveStep(c,step,clock()))
                        val raw=try{permitted(c);invoke(selected.first,selected.second,JsonArray(messages),JsonArray(exposed),cap)}
                        catch(ex:Exception){
                            known=false;costKnown=false
                            withContext(NonCancellable){ledger.recordStep(c,step,false,buildJsonObject{put("error_type","provider_unconfirmed");put("usage",JsonNull);put("cost",JsonNull)},clock())}
                            throw ex
                        }
                        val usage=raw["usage"] as? JsonObject
                        val reported=usage?.get("total_tokens")?.jsonPrimitive?.longOrNull?.takeIf{it>=0&&it<=1000000000}
                        if(reported==null)known=false else total+=reported
                        val reportedCost=usage?.get("cost")?.jsonPrimitive?.doubleOrNull?.takeIf{it.isFinite()&&it>=0}
                        if(reportedCost==null)costKnown=false else cost+=reportedCost
                        val choice=raw.arr("choices").firstOrNull() as? JsonObject
                        val message=choice?.get("message") as? JsonObject
                        val finish=choice?.str("finish_reason").orEmpty()
                        val requested=message?.arr("tool_calls").orEmpty()
                        val valid=requested.size<=128&&requested.all{r->
                            val t=r as? JsonObject;val fn=t?.get("function") as? JsonObject
                            t!=null&&t.str("id").isNotBlank()&&t.str("id").length<=160&&t.str("type")=="function"&&fn!=null&&fn.str("name").length in 1..120&&fn.str("arguments").length<=60000
                        }&&requested.map{(it as? JsonObject)?.str("id")}.distinct().size==requested.size
                        val receipt=buildJsonObject{
                            put("usage",if(reported==null)JsonNull else buildJsonObject{put("total_tokens",reported);for(k in listOf("prompt_tokens","completion_tokens"))usage?.get(k)?.jsonPrimitive?.longOrNull?.takeIf{it>=0}?.let{put(k,it)}})
                            put("cost",reportedCost?.let(::JsonPrimitive)?:JsonNull);put("model",raw.str("model").take(180));put("finish_reason",finish.take(80))
                            put("requested_tools",JsonArray(if(valid)requested.map{JsonPrimitive(it.jsonObject.getValue("function").jsonObject.str("name"))}else emptyList()))
                        }
                        check(ledger.recordStep(c,step,valid&&choice!=null,receipt,clock()))
                        permitted(c)
                        if(!valid||choice==null){reason="invalid_provider_response";break}
                        if(!known||total>=e.tokenBudget){reason="budget_or_usage_unknown";break}
                        if(requested.isEmpty()){if(finish=="stop"){status="completed";reason="ended"}else reason="provider_incomplete";break}
                        if(finish!="tool_calls"||exposed.isEmpty()){reason="unexpected_tool_request";break}
                        val exposedNames=exposed.map{it.getValue("function").jsonObject.str("name")}.toSet()
                        val results=mutableListOf<JsonElement>()
                        for((index,item) in requested.withIndex()){
                            permitted(c);val call=item.jsonObject;val fn=call.getValue("function").jsonObject;val name=fn.str("name")
                            var result=buildJsonObject{put("ok",false);put("reason","unavailable_or_invalid")}
                            if(calls<e.toolBudget&&name in exposedNames){
                                check(ledger.reserveTool(c,step,index,name,clock()));calls++
                                val args=runCatching{Json.parseToJsonElement(fn.str("arguments")).jsonObject}.getOrNull()
                                result=try{
                                    when{
                                        name=="dream_read_history"&&args!=null->history(c,args,previous)
                                        name=="dream_write_note"&&args?.keys==setOf("body")->buildJsonObject{put("ok",ledger.note(c,args.str("body"),clock()))}
                                        name=="dream_schedule_extra"&&args?.keys==setOf("at")&&proposed==null->{
                                            val at=Instant.parse(args.str("at")).toEpochMilli()
                                            if(at>clock()){proposed=at;buildJsonObject{put("ok",true);put("status","proposed_pending_completion")}}else result
                                        }
                                        name in commonNames&&common!=null->{
                                            val out=common.execute(c.id+":"+step+":"+index,name,fn.str("arguments"))
                                            buildJsonObject{put("ok",out.ok);put("data",Json.parseToJsonElement(out.output))}
                                        }
                                        else->result
                                    }
                                }catch(ex:CancellationException){throw ex}catch(_:Exception){buildJsonObject{put("ok",false);put("reason","tool_failed")}}
                                val count=(result["turns"] as? JsonArray)?.size
                                val ok=result["ok"]?.jsonPrimitive?.booleanOrNull==true||count!=null&&result["reason"]==null
                                check(ledger.recordTool(c,step,index,ok,count,clock()))
                                activities.add(buildJsonObject{put("kind",name);put("ok",ok);count?.let{put("count",it)}})
                            }
                            results.add(buildJsonObject{put("role","tool");put("tool_call_id",call.str("id"));put("name",name);put("content",result.toString())})
                        }
                        messages.add(buildJsonObject{put("role","assistant");put("content",message?.get("content") as? JsonPrimitive?:JsonNull);put("tool_calls",JsonArray(requested))})
                        messages.addAll(results)
                    }
                }finally{watch.cancelAndJoin()}
            }
        }catch(ex:CancellationException){status="cancelled";reason="cancelled";cancelled=ex}
        catch(_:Exception){status="failed";reason="execution_failed"}
        // A response may have failed parsing after transmission. Any still
        // claimed step has unconfirmed billing, even if earlier usage was known.
        val uncertain=withContext(NonCancellable){LocalDreamArchive(store).runtimeHistory(cid).arr("steps").any{
            val row=it.jsonObject;row.str("claim_id")==c.id&&row.str("status")=="claimed"
        }}
        if(uncertain){known=false;costKnown=false}
        val result=buildJsonObject{
            put("reason",reason);put("activities",JsonArray(activities));put("tool_calls",calls)
            put("total_tokens",if(known)JsonPrimitive(total)else JsonNull);put("reported_cost",if(costKnown)JsonPrimitive(cost)else JsonNull)
            proposed?.let{put("proposed_extra_at",it)};put("accounting","provider_reported; input estimate is not a hard billing guarantee")
        }
        val saved=withContext(NonCancellable){ledger.finish(c,status,result,proposed,clock())}
        cancelled?.let{throw it}
        return if(saved)status else "unconfirmed"
    }
}
