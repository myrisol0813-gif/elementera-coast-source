package com.elementeracoast.app.core.local

import android.content.Context
import com.elementeracoast.app.BuildConfig
import com.elementeracoast.app.core.auth.AndroidKeystoreAuthStore
import com.elementeracoast.app.core.network.*
import com.elementeracoast.app.core.remote.*
import com.elementeracoast.app.feature.chatgpt.*
import java.io.File
import java.security.SecureRandom
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.*
import kotlinx.serialization.json.*

/** Only device authorization is stored here, outside the online cache and
 * portable archive. Online content is always read/written at the real server. */
internal class OnlineDreamDevice private constructor(private val context:Context){
    private val store=FileLocalPersistence(File(context.noBackupFilesDir,"coast-online-dream-device-v1"))
    private val account=ChatGptPlanRepository(ChatGptSecureStore(context,false))
    private val plan=NativeDreamPlanRoute(store,account)
    private val auth=AndroidKeystoreAuthStore(context)
    private val json=Json{ignoreUnknownKeys=true;encodeDefaults=true;explicitNulls=true}
    internal class Registration(val cid:String,val revision:String,val model:String,val key:String){
        override fun toString()="OnlineDreamRegistration(redacted)"
    }
    private fun rows(s:LocalPersistence)=s.get("registrations","{}").let{Json.parseToJsonElement(it).jsonObject}
    private fun JsonObject.str(key:String)=(get(key) as? JsonPrimitive)?.contentOrNull.orEmpty()
    fun registrations():List<Registration> = store.readConsistent{s->rows(s).mapNotNull{(cid,item)->
        val v=item as? JsonObject?:return@mapNotNull null
        val revision=v.str("revision");val model=v.str("model");val key=v.str("key")
        if(revision.isBlank()||NativeDreamPlanProtocol.slug(model)==null||!key.matches(Regex("[a-f0-9]{64}")))null else Registration(cid,revision,model,key)
    }}
    private fun put(r:Registration)=store.readConsistent{s->
        s.put("registrations",JsonObject(rows(s)+(r.cid to buildJsonObject{put("revision",r.revision);put("model",r.model);put("key",r.key)})).toString())
    }
    private fun remove(cid:String)=store.readConsistent{s->s.put("registrations",JsonObject(rows(s)-cid).toString());plan.revoke(cid)}
    private fun removeIfCurrent(r:Registration)=store.readConsistent{s->
        val current=rows(s)[r.cid] as? JsonObject
        if(current!=null&&current.str("revision")==r.revision&&current.str("key")==r.key)remove(r.cid)
    }
    private fun key()=ByteArray(32).also{SecureRandom().nextBytes(it)}.joinToString(""){"%02x".format(it.toInt() and 255)}
    private fun active()=BuildConfig.LOCAL_DREAM_PLAN_EXECUTION_ENABLED&&!NativeWorkspace.localSelected(context)&&!com.elementeracoast.app.core.tour.SourceVisitGate.isActive&&auth.load()?.isExpired()==false
    fun preferredModel():String=ChatGptSecureStore(context,false).preferredModel()?.let{NativeDreamPlanProtocol.PREFIX+it}.orEmpty()
    fun status(cid:String,value:DreamSettingsResponse):DreamSettingsResponse{
        val a=value.settings
        val r=registrations().firstOrNull{it.cid==cid&&it.revision==a.revision&&it.model==a.modelId}
        val state=if(r==null)"not_authorized" else plan.status(cid,a.revision,a.modelId)
        return value.copy(planExecutionAvailable=value.planExecutionAvailable&&BuildConfig.LOCAL_DREAM_PLAN_EXECUTION_ENABLED,planStatus=state,planRequestLimit=plan.requestLimit(cid,a.revision,a.modelId))
    }
    suspend fun save(api:CoastApiClient,value:DreamSettingsRequest):DreamSettingsResponse=withContext(Dispatchers.IO){
        val cid=value.conversationId
        // Disarm locally first so a lost server response cannot restart work.
        if(value.action=="disarm"){remove(cid);OnlineDreamWorker.sync(context);return@withContext api.saveDreamSettings(value)}
        if(value.action!="arm"||NativeDreamPlanProtocol.slug(value.modelId.orEmpty())==null){
            val result=api.saveDreamSettings(value)
            if(result.ok){remove(cid);OnlineDreamWorker.sync(context)}
            return@withContext result
        }
        check(active()&&value.confirmExecution&&value.confirmPlanSoftBudget){"当前设备未连接在线海岸或未确认套餐授权。"}
        val model=requireNotNull(value.modelId)
        val deviceKey=key()
        val saved=api.saveDreamSettings(value.copy(deviceKey=deviceKey))
        if(!saved.ok)return@withContext saved
        val revision=requireNotNull(saved.settings.revision)
        // The server revision is authoritative. No provider request until
        // the independent device account grant has been verified and saved.
        try{
            check(plan.grant(cid,revision,model,value.confirmPlanSoftBudget,value.planRequestLimit)){"套餐账号或模型无法完成独立授权。"}
            put(Registration(cid,revision,model,deviceKey))
            OnlineDreamWorker.sync(context)
        }catch(e:Exception){
            withContext(NonCancellable){
                remove(cid)
                runCatching{api.saveDreamSettings(DreamSettingsRequest(cid,revision,"disarm"))}
                OnlineDreamWorker.sync(context)
            }
            throw e
        }
        status(cid,saved)
    }
    fun api():CoastApiClient{
        val config=CoastApiConfig(BuildConfig.COAST_API_BASE_URL)
        val http=CoastHttpClient(config,auth).client.newBuilder()
            .retryOnConnectionFailure(false).callTimeout(180,TimeUnit.SECONDS).build()
        return CoastApiClient(config,http)
    }
    fun diagnostics(cid:String):List<JsonObject> = listOf("check","attempt").mapNotNull{kind->
        runCatching{json.parseToJsonElement(store.get("diagnostic."+kind+"."+cid)).jsonObject}.getOrNull()
    }
    private fun diagnostic(r:Registration,kind:String,phase:String,reason:String?=null,step:Int?=null,claim:String?=null,http:Int?=null){
        // Never let optional diagnostics affect a billable activity.
        runCatching{store.put("diagnostic."+kind+"."+r.cid,WakeDiagnostic.entry(phase,System.currentTimeMillis(),reason,step,claim,http).toString())}
    }
    fun recordCheckFailure(r:Registration,error:Throwable){diagnostic(r,"check","preflight_failed",WakeDiagnostic.reason(error),http=WakeDiagnostic.http(error))}
    private fun stillRegistered(r:Registration)=active()&&registrations().any{it.cid==r.cid&&it.revision==r.revision&&it.model==r.model&&it.key==r.key}
    suspend fun execute(api:CoastApiClient,r:Registration):Boolean{
        if(!stillRegistered(r))return false
        diagnostic(r,"check","settings_fetch")
        val remote=try{api.dreamSettings(r.cid)}catch(e:CoastApiException){
            if(e.status==404){removeIfCurrent(r);return false};throw e
        }
        if(!remote.settings.enabled||remote.settings.revision!=r.revision||remote.settings.modelId!=r.model){removeIfCurrent(r);return false}
        if(!remote.planExecutionAvailable){diagnostic(r,"check","preflight_failed","server_gate_disabled");return false}
        if(plan.status(r.cid,r.revision,r.model)!="authorized"){diagnostic(r,"check","preflight_failed","plan_not_authorized");return false}
        diagnostic(r,"check","catalog_check")
        val binding=plan.open(r.cid,r.revision,r.model)?:run{diagnostic(r,"check","preflight_failed","plan_binding_unavailable");return false}
        if(!stillRegistered(r)||!binding.authorized())return false
        var claimId:String?=null
        suspend fun action(name:String,body:JsonObject=JsonObject(emptyMap())):JsonObject=api.dreamDeviceAction(buildJsonObject{
            put("conversation_id",r.cid);put("revision",r.revision);put("modelId",r.model);put("deviceKey",r.key);put("action",name)
            claimId?.let{put("claim_id",it)};body.forEach{(k,v)->put(k,v)}
        })
        fun JsonObject.ok()=get("ok")?.jsonPrimitive?.booleanOrNull==true
        diagnostic(r,"check","claim_request")
        val admitted=try{action("claim")}catch(e:CancellationException){throw e}catch(e:Exception){
            diagnostic(r,"attempt","claim_response_unconfirmed",WakeDiagnostic.reason(e),http=WakeDiagnostic.http(e));return false
        }
        if(!admitted.ok()){diagnostic(r,"check","claim_not_admitted",admitted.str("reason"));return false}
        claimId=try{admitted.getValue("claim").jsonObject.getValue("claimId").jsonPrimitive.content}catch(e:Exception){
            diagnostic(r,"attempt","claim_response_unconfirmed","claim_decode_error");return false
        }
        val claim=requireNotNull(claimId)
        fun notice(kind:String,body:String?=null){LocalDreamNotifications.post(context,r.cid,claim,kind,body,localMode=false)}
        notice("start")
        var completed=false;var reason="plan_incomplete";var noteNotified=false
        var phase="device_received";var stepIndex:Int?=null;var httpStatus:Int?=null
        fun mark(value:String){phase=value;diagnostic(r,"attempt",phase,step=stepIndex,claim=claim)}
        var inFlight:Int?=null
        var cancellation:CancellationException?=null
        suspend fun authorized()=stillRegistered(r)&&binding.authorized()&&action("heartbeat").ok()
        try{
            mark("device_received")
            // New servers acknowledge delivery. Older servers may not support
            // this diagnostic action; the existing authorization gate remains authoritative.
            try{action("received")}catch(e:CancellationException){throw e}catch(_:Exception){}
            val cfg=json.decodeFromJsonElement(DreamConfig.serializer(),admitted.getValue("settings"))
            val e=requireNotNull(cfg.execution)
            val limit=admitted.getValue("requestLimit").jsonPrimitive.int
            check(limit==binding.grant.requestLimit)
            val offered=admitted.getValue("tools").jsonArray
            val instructions=admitted.getValue("instructions").jsonPrimitive.content
            val session=NativeDreamPlanSession(binding.grant,instructions,e.tokenBudget,e.outputLimit){body,tools->binding.send(body,tools){authorized()}}
            var results=emptyList<JsonObject>()
            var usedTools=0L
            coroutineScope{
                val running=currentCoroutineContext()[Job]!!
                val heartbeat=launch{
                    while(isActive){
                        delay(15000)
                        if(!runCatching{authorized()}.getOrDefault(false)){running.cancel(CancellationException("wake authorization ended"));break}
                    }
                }
                try{
                    for(i in 0..e.toolBudget){
                        ensureActive()
                        if(!session.canContinue()){reason="plan_step_or_soft_budget_limit";break}
                        stepIndex=i;mark("request_prepare")
                        val tools=if(usedTools>=e.toolBudget||i==e.toolBudget||i+1>=limit)JsonArray(emptyList())else offered
                        val step=session.step(i,tools,results,reserve={
                            mark("request_reserved")
                            val reply=action("reserve",buildJsonObject{put("step",i)})
                            if(!reply.ok())throw NativeDreamPlanFailure("reserve_"+WakeDiagnostic.code(reply.str("reason")))
                            inFlight=i;mark("provider_wait")
                            true
                        },authorize={authorized()})
                        val raw=step.normalized
                        val choice=raw.getValue("choices").jsonArray.first().jsonObject
                        val calls=choice.getValue("message").jsonObject.getValue("tool_calls").jsonArray
                        val finish=choice.getValue("finish_reason").jsonPrimitive.content
                        // Once delivery starts, an uncertain response must
                        // never be sent again (tools may already have written).
                        inFlight=null;mark("step_delivery")
                        val response=action("step",buildJsonObject{
                            put("step",i);put("finish",finish);put("usage",raw["usage"]?:JsonNull);put("calls",calls)
                        })
                        if(!response.ok())throw NativeDreamPlanFailure("step_"+WakeDiagnostic.code(response.str("reason")))
                        results=response.getValue("results").jsonArray.map{it.jsonObject}
                        usedTools+=calls.size.toLong()
                        if(!noteNotified&&results.any{it.str("name")=="dream_write_note"}){
                            val n=runCatching{api.dreamNotes(r.cid).items.firstOrNull{it.claimId==claim}}.getOrNull()
                            if(n!=null){notice("note",n.body);noteNotified=true}
                        }
                        if(finish=="stop"){completed=true;reason="ended";break}
                        if(response["canContinue"]?.jsonPrimitive?.booleanOrNull!=true){reason="plan_step_or_soft_budget_limit";break}
                    }
                }finally{heartbeat.cancelAndJoin()}
            }
        }catch(e:CancellationException){cancellation=e;reason="authorization_or_task_ended"}
        catch(e:Exception){reason=WakeDiagnostic.reason(e);httpStatus=WakeDiagnostic.http(e)}
        finally{
            withContext(NonCancellable){
                diagnostic(r,"attempt",phase,reason,stepIndex,claim,httpStatus)
                inFlight?.let{i->runCatching{action("step",buildJsonObject{put("step",i);put("finish","failed");put("reason",reason);httpStatus?.let{put("http_status",it)};put("usage",JsonNull);put("calls",JsonArray(emptyList()))})}}
                val settled=runCatching{action("finish",buildJsonObject{put("completed",completed);put("reason",reason);put("phase",phase)})}.getOrNull()
                if(settled?.ok()!=true)diagnostic(r,"check","finish_unconfirmed",settled?.str("reason")?:"finish_response_unconfirmed",stepIndex,claim)
                // Read back the persisted note even if the last tool response
                // was interrupted; never send a notification for unsaved text.
                if(!noteNotified){val n=runCatching{api.dreamNotes(r.cid).items.firstOrNull{it.claimId==claim}}.getOrNull();if(n!=null)notice("note",n.body)}
                if(settled?.ok()==true&&settled.str("status")!="completed")notice("failure")
            }
        }
        cancellation?.let{throw it}
        return true
    }
    companion object{
        @Volatile private var instance:OnlineDreamDevice?=null
        @Synchronized fun get(context:Context):OnlineDreamDevice=instance?:OnlineDreamDevice(context.applicationContext).also{instance=it}
    }
}
