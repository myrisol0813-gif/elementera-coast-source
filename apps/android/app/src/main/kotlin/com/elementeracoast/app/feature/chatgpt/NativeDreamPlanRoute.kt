package com.elementeracoast.app.feature.chatgpt

import com.elementeracoast.app.core.local.LocalPersistence
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.JsonObject

/** Immutable, request-local binding. A different connection or revised grant
 * is never substituted after the autonomous claim has been admitted. */
internal class NativeDreamPlanBinding(
    val grant:NativeDreamPlanProtocol.Grant,
    val authorized:()->Boolean,
    val send:suspend (JsonObject,Set<String>,suspend ()->Boolean)->NativeDreamPlanProtocol.Step
)

/** Native only. Catalog fetch is not inference. It occurs only after a
 * device-local grant exists, and the account is rechecked after fetching. */
internal class NativeDreamPlanRoute(private val store:LocalPersistence,private val account:ChatGptPlanRepository){
    private val grants=NativeDreamPlanGrants(store)
    fun status(window:String,revision:String?,model:String?):String=
        grants.status(window,revision,model,account.currentAccount(),account.wakeConnectionEpoch())
    fun revoke(window:String)=grants.revoke(window)
    suspend fun grant(window:String,revision:String,model:String,accepted:Boolean,requestLimit:Int):Boolean{
        if(!accepted||NativeDreamPlanProtocol.slug(model)==null||requestLimit !in 1..129)return false
        val current=account.currentAccount()?:return false
        val epoch=account.wakeConnectionEpoch()?:return false
        val names=account.models().map{it.slug}.toSet()
        val after=account.currentAccount()?:return false
        if(current.subject!=after.subject||current.clientId!=after.clientId||current.hostId!=after.hostId||account.wakeConnectionEpoch()!=epoch)return false
        return grants.grant(window,revision,model,after,epoch,names,accepted,requestLimit)
    }
    suspend fun open(window:String,revision:String,model:String):NativeDreamPlanBinding?{
        val current=account.currentAccount()?:return null
        val epoch=account.wakeConnectionEpoch()?:return null
        val grant=grants.resolve(window,revision,model,current,epoch)?:return null
        fun authorized()=grants.resolve(window,revision,model,account.currentAccount(),account.wakeConnectionEpoch())==grant
        val names=try{account.models().map{it.slug}.toSet()}catch(e:CancellationException){throw e}catch(_:Exception){return null}
        if(!authorized()||grant.model !in names)return null
        val transport=NativeDreamPlanTransport(account)
        return NativeDreamPlanBinding(grant,::authorized){body,exposed,check->
            try{
                transport.request(grant,window,revision,model,body,exposed){authorized()&&check()}
            }catch(e:NativeDreamPlanFailure){
                // A quota error pauses all windows for this account connection.
                // Never pause a new account which replaced the original grant.
                if(e.reason in setOf("plan_usage_limit","plan_authorization_unavailable","plan_usage_unavailable")&&authorized()){
                    grants.pause(current,epoch)
                }
                throw e
            }
        }
    }
}
