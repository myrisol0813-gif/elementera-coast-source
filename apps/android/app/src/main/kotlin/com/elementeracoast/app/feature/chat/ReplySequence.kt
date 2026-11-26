package com.elementeracoast.app.feature.chat

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext

/** Transport-independent sequential execution. Adapter owns exact durable
 * reservation, provider calls, canonical commits and cumulative budget.
 * Never split one response or manufacture a user message. */
internal object ReplySequence {
    data class Identity(val conversationId:String,val turnId:String,val userVariantId:String,val sequenceId:String)
    data class Step(val identity:Identity,val messageId:String,val index:Int,val mayContinue:Boolean)
    data class Response<T>(val value:T,val successful:Boolean,val continueRequested:Boolean)
    data class Saved<T>(val id:String,val value:T)
    data class Receipt<T>(val identity:Identity,val status:String,val pending:Step?,val messages:List<Saved<T>>)
    private val id=Regex("[A-Za-z0-9_.:-]{1,160}")
    fun selectedGroup(variants:List<com.elementeracoast.app.core.remote.RemoteVariant>,activeIndex:Int):List<com.elementeracoast.app.core.remote.RemoteVariant>{
        val active=variants.getOrNull(activeIndex)?:return emptyList()
        val seq=active.replySequence?:return listOf(active)
        val group=variants.filter{it.replySequence?.id==seq.id}.sortedBy{it.replySequence!!.index}
        require(group.withIndex().all{(i,v)->v.replySequence!!.index==i}){"invalid_reply_sequence_group"}
        return group
    }
    data class Alternative(val messages:List<com.elementeracoast.app.core.remote.RemoteVariant>,val activeIndex:Int)
    fun alternatives(variants:List<com.elementeracoast.app.core.remote.RemoteVariant>):List<Alternative>{
        val seen=mutableSetOf<String>()
        return buildList {
            variants.forEachIndexed { index, variant ->
                if(seen.add(variant.id)){
                    val group=selectedGroup(variants,index)
                    seen.addAll(group.map{it.id})
                    add(Alternative(group,variants.indexOf(group.last())))
                }
            }
        }
    }
    data class Budget(val enabled:Boolean,val maxMessages:Int,val toolBudget:Int,val tokenBudget:Int)
    data class Usage(val toolCalls:Int?,val totalTokens:Long?)
    data class Remaining(val known:Boolean,val tools:Int,val tokens:Long)
    fun resolveBudget(global:com.elementeracoast.app.feature.wolf.BasicSettings,
        window:com.elementeracoast.app.core.model.ConversationContextSettings,usedVariants:Int):Budget{
        require(usedVariants>=0)
        val settings=window.normalized()
        fun choose(override:Int?,value:Int,fallback:Int,range:IntRange)=
            override?.takeIf{it in range}?:value.takeIf{it in range}?:fallback
        val count=if(settings.replySequenceEnabled)choose(settings.replySequenceMaxMessages,global.replySequenceMaxMessages,3,1..20)else 1
        return Budget(settings.replySequenceEnabled,minOf(count,(20-usedVariants).coerceAtLeast(0)),
            choose(settings.replySequenceToolBudget,global.replySequenceToolBudget,24,0..128),
            choose(settings.replySequenceTokenBudget,global.replySequenceTokenBudget,48000,1..1000000))
    }
    fun remainingBudget(budget:Budget,receipts:List<Usage>):Remaining{
        var tools=budget.toolBudget
        var tokens=budget.tokenBudget.toLong()
        for(r in receipts){
            val calls=r.toolCalls?:return Remaining(false,0,0)
            val count=r.totalTokens?:return Remaining(false,0,0)
            if(calls<0||count<0)return Remaining(false,0,0)
            tools=(tools-calls.coerceAtMost(tools)).coerceAtLeast(0)
            tokens=(tokens-count.coerceAtMost(tokens)).coerceAtLeast(0)
        }
        return Remaining(true,tools,tokens)
    }
    fun limit(n:Int)=n.also{require(it in 1..20){"invalid_reply_sequence_limit"}}

    suspend fun <T> run(identity:Identity,maxMessages:Int,newId:()->String,
        acquire:suspend(Identity)->Boolean,reserve:suspend(Step)->Boolean,
        invoke:suspend(Step,List<Saved<T>>)->Response<T>,commit:suspend(Step,Response<T>)->Saved<T>?,
        settle:suspend(Receipt<T>)->Unit,organize:suspend(Receipt<T>)->Unit,
        canContinue:suspend(Identity,List<Saved<T>>)->Boolean={_,_->true},
        cancelled:()->Boolean={false}):Receipt<T>{
        require(listOf(identity.conversationId,identity.turnId,identity.userVariantId,identity.sequenceId).all(id::matches))
        val max=limit(maxMessages)
        if(cancelled())return Receipt(identity,"cancelled",null,emptyList())
        if(!acquire(identity))return Receipt(identity,"not_acquired",null,emptyList())
        val saved=mutableListOf<Saved<T>>();val ids=mutableSetOf<String>()
        var pending:Step?=null;var status="completed";var cancellation:CancellationException?=null
        try{
            for(index in 0 until max){
                if(cancelled()){status="cancelled";break}
                if(index>0&&!canContinue(identity,saved.toList())){status="permission_or_budget";break}
                val mid=newId();require(id.matches(mid)&&ids.add(mid)){"duplicate_reply_message_id"}
                val step=Step(identity,mid,index,index+1<max)
                if(!reserve(step)){status="reservation_lost";break}
                pending=step
                if(cancelled()){status="cancelled";break}
                val result=invoke(step,saved.toList())
                val committed=commit(step,result);require(committed?.id==mid){"reply_commit_unconfirmed"}
                saved.add(requireNotNull(committed));pending=null
                if(cancelled()){status="cancelled";break}
                if(!result.successful||!result.continueRequested)break
                if(index+1==max)status="limit_reached"
            }
        }catch(e:CancellationException){status="cancelled";cancellation=e}
        catch(e:Exception){status=if(cancelled())"cancelled" else "failed"}
        val receipt=Receipt(identity,status,pending,saved.toList())
        // Only persist terminal state on coroutine cancellation. Do not launch
        // new provider work in a NonCancellable block or pretend it organized.
        withContext(NonCancellable){settle(receipt)}
        cancellation?.let{throw it}
        if(saved.isNotEmpty())organize(receipt)
        return receipt
    }
}
