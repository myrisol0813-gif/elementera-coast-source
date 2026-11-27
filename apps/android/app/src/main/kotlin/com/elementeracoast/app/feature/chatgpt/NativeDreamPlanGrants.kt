package com.elementeracoast.app.feature.chatgpt

import com.elementeracoast.app.core.local.LocalPersistence
import com.elementeracoast.app.core.local.ArchiveV2Chunks
import kotlinx.serialization.json.*
import java.util.UUID

/** Device-only authorization. The portable archive never enumerates these
 * keys. No account identity, OAuth token or authorization is exported. */
internal class NativeDreamPlanGrants(private val store:LocalPersistence){
    private val safe=Regex("[A-Za-z0-9_.:-]{1,180}")
    private fun key(window:String)="local.dream.plan.grant."+window.also{require(safe.matches(it))}
    private fun identity(account:ChatGptConnection,epoch:String):String=
        ArchiveV2Chunks.digest(JsonArray(listOf(account.subject,account.clientId,account.hostId,epoch).map(::JsonPrimitive)).toString().encodeToByteArray())
    private fun pauseKey(identity:String)="local.dream.plan.fence."+identity
    private fun row(window:String,s:LocalPersistence=store):JsonObject?=
        s.get(key(window)).takeIf{it.isNotBlank()}?.let{runCatching{Json.parseToJsonElement(it).jsonObject}.getOrNull()}
    private fun JsonObject.str(k:String)=(get(k) as? JsonPrimitive)?.contentOrNull.orEmpty()
    fun grant(window:String,revision:String,modelId:String,account:ChatGptConnection,epoch:String,
              advertised:Set<String>,accepted:Boolean,requestLimit:Int):Boolean=store.readConsistent{s->
        val model=NativeDreamPlanProtocol.slug(modelId)?:return@readConsistent false
        if(!safe.matches(window)||!safe.matches(revision)||epoch.isBlank()||!accepted||requestLimit !in 1..129)return@readConsistent false
        val grant=NativeDreamPlanProtocol.Grant(window,revision,account.subject,account.clientId,model,true,requestLimit)
        if(!NativeDreamPlanProtocol.permitted(grant,window,revision,account,modelId,advertised))return@readConsistent false
        val identity=identity(account,epoch)
        s.put(key(window),buildJsonObject{
            put("revision",revision);put("model",model);put("identity",identity);put("fence",s.get(pauseKey(identity),"0"));put("request_limit",requestLimit)
        }.toString());true
    }
    fun resolve(window:String,revision:String,modelId:String,account:ChatGptConnection?,epoch:String?):NativeDreamPlanProtocol.Grant?=store.readConsistent{s->
        val a=account?:return@readConsistent null
        if(epoch.isNullOrBlank())return@readConsistent null
        val model=NativeDreamPlanProtocol.slug(modelId)?:return@readConsistent null
        val r=row(window,s)?:return@readConsistent null
        val identity=identity(a,epoch)
        val count=(r["request_limit"] as? JsonPrimitive)?.intOrNull?:return@readConsistent null
        if(r.str("identity")!=identity||r.str("revision")!=revision||r.str("model")!=model||r.str("fence")!=s.get(pauseKey(identity),"0")||count !in 1..129)return@readConsistent null
        val g=NativeDreamPlanProtocol.Grant(window,revision,a.subject,a.clientId,model,true,count)
        g.takeIf{NativeDreamPlanProtocol.permitted(it,window,revision,a,modelId,setOf(model))}
    }
    fun status(window:String,revision:String?,modelId:String?,account:ChatGptConnection?,epoch:String?):String=store.readConsistent{s->
        if(account==null||epoch.isNullOrBlank())return@readConsistent "account_disconnected"
        val r=row(window,s)?:return@readConsistent "not_authorized"
        val identity=identity(account,epoch)
        if(r.str("identity")!=identity||r.str("revision")!=revision||r.str("model")!=modelId?.let(NativeDreamPlanProtocol::slug))return@readConsistent "authorization_changed"
        if(r.str("fence")!=s.get(pauseKey(identity),"0"))return@readConsistent "paused"
        if(resolve(window,revision.orEmpty(),modelId.orEmpty(),account,epoch)==null)"not_authorized" else "authorized"
    }
    fun revoke(window:String)=store.remove(key(window))
    /** Invalidate all grants belonging to the same account connection. A new
     * explicit grant reopens only its own window, never all older windows. */
    fun pause(account:ChatGptConnection,epoch:String){
        require(epoch.isNotBlank())
        store.put(pauseKey(identity(account,epoch)),UUID.randomUUID().toString())
    }
}
