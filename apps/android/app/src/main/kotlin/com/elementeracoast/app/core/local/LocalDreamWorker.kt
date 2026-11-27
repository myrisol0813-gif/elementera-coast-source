package com.elementeracoast.app.core.local

import android.content.Context
import androidx.work.*
import com.elementeracoast.app.BuildConfig
import com.elementeracoast.app.core.remote.RemoteCacheStore
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*

internal object RemoteCacheRecovery{
    fun recoverWakeClaims(store:LocalPersistence){
        val ledger=LocalDreamLedger(store)
        RemoteCacheStore(store,strictReads=true).conversations().forEach{ledger.recover(it.id,System.currentTimeMillis())}
    }
}

/** Periodic Android scheduling is best-effort, not an alarm clock or a service
 * that keeps an imaginary model alive. No exact alarm permission, no cloud
 * transport, no provider request until the owner arms a specific window. */
class LocalDreamWorker(context:Context,params:WorkerParameters):CoroutineWorker(context,params){
    override suspend fun doWork():Result=withContext(Dispatchers.IO){
        if(!BuildConfig.LOCAL_DREAM_EXECUTION_ENABLED||!NativeWorkspace.localSelected(applicationContext))return@withContext Result.success()
        val lease=LocalDreamRuntime.acquire()?:return@withContext Result.success()
        try{
            if(!NativeWorkspace.localSelected(applicationContext))return@withContext Result.success()
            NativeWorkspace.initialize(applicationContext)
            if(!NativeWorkspace.isLocal)return@withContext Result.success()
            val store=NativeWorkspace.persistence(applicationContext)
            val ledger=LocalDreamLedger(store)
            val provider=LocalProviderStore(applicationContext)
            val client=LocalProviderClient()
            val executor=LocalDreamExecutor(store,provider::resolve,client::dreamRequest,workspaceActive={
                NativeWorkspace.localSelected(applicationContext)&&NativeWorkspace.isLocal&&NativeWorkspace.persistence(applicationContext)===store
            },web=LocalIndependentWeb(applicationContext),captureReality={settings->com.elementeracoast.app.feature.chat.AndroidRealityContextSource(applicationContext,store,true).capture(settings)},voice=LocalVoiceProvider(applicationContext),imageProvider=provider::resolveImageProvider,modelBudget={p,m,output->client.inputBudget(p,m,0,output,true)})
            val windows=RemoteCacheStore(store,strictReads=true).conversations().filter{it.roomType=="main"&&it.source=="coast"&&it.deletedAt==null}
            val now=System.currentTimeMillis()
            // No previous in-flight wake can be alive while this lease is held.
            windows.forEach{ledger.recover(it.id,now)}
            val eligible=windows.mapNotNull{w->
                val a=ledger.settings(w.id)
                val history=LocalDreamArchive(store).runtimeHistory(w.id)["runs"]!!.jsonArray.map{it.jsonObject}
                val used=history.map{it.getValue("slot_key").jsonPrimitive.content}.toSet()
                if(LocalDreamSchedule.candidate(a,used,now)==null||a.revision==null||a.modelId==null)null
                else Triple(w.id,a,history.maxOfOrNull{it.getValue("started_at").jsonPrimitive.long}?:0L)
            }.sortedBy{it.third}
            // One active window per worker tick. A bounded tick cannot turn
            // many overdue windows into a burst of automatic provider calls.
            for((cid,a,_) in eligible){
                val outcome=executor.run(cid,requireNotNull(a.revision),requireNotNull(a.modelId),now)
                if(outcome !in setOf("not_due","model_unavailable","disabled"))break
            }
            Result.success()
        }catch(e:CancellationException){throw e}
        catch(_:Exception){Result.failure()}
        finally{lease.close()}
    }
    companion object{
        private const val JOB="coast-local-autonomous-wake"
        fun sync(context:Context){
            // Scheduling errors are not model errors; authorization remains
            // persisted and can be revoked even if Android refuses a job.
            val manager=WorkManager.getInstance(context.applicationContext)
            val enabled=BuildConfig.LOCAL_DREAM_EXECUTION_ENABLED&&NativeWorkspace.localSelected(context)&&NativeWorkspace.isLocal&&runCatching{
                val store=NativeWorkspace.persistence(context)
                val ledger=LocalDreamLedger(store)
                RemoteCacheStore(store,strictReads=true).conversations().any{ledger.settings(it.id).enabled}
            }.getOrDefault(false)
            if(!enabled){manager.cancelUniqueWork(JOB);return}
            val request=PeriodicWorkRequestBuilder<LocalDreamWorker>(15,TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build()
            manager.enqueueUniquePeriodicWork(JOB,ExistingPeriodicWorkPolicy.KEEP,request)
        }
    }
}
