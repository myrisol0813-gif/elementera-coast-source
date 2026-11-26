package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.network.RemoteReplyRunRequest
import com.elementeracoast.app.core.remote.*
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.time.Instant
import java.security.MessageDigest

/** Device-only ledger. History and completed-step receipt publish in the same
 * atomic generation. Reserved/claimed steps never replay on process recovery.
 * No API key, provider response body or duplicated chat text is stored here. */
internal class LocalReplyRunStore(private val store:LocalPersistence){
    @Serializable data class Usage(val messageId:String,val toolCalls:Int?,val totalTokens:Long?,val continueRequested:Boolean)
    @Serializable data class Row(val sequenceId:String,val turnId:String,val userId:String,val status:String,
        val max:Int,val tools:Int,val tokens:Int,val historyHash:String,val updatedAt:Long,
        val pendingId:String?=null,val pendingState:String?=null,val receipts:List<Usage> = emptyList(),
        val soilState:String?=null)
    data class Claim(val index:Int,val mayContinue:Boolean,val tools:Int,val tokens:Int,val history:RemoteHistory,val previous:List<RemoteVariant>)
    // This registry describes only work currently owned by this process.
    // No periodic full-file rewrite, and process death clears it; durable
    // stale recovery then uses the persisted timestamp as before.
    private val json=Json{ignoreUnknownKeys=true;encodeDefaults=true}
    private val id=Regex("[A-Za-z0-9_.:-]{1,160}")
    private fun checkIds(vararg ids:String)=require(ids.all(id::matches)){"连续回复身份无效。"}
    private fun activeKey(cid:String)="local.reply.active.$cid"
    private fun rowKey(cid:String,seq:String)="local.reply.run.$cid.$seq"
    private fun get(s:LocalPersistence,cid:String,seq:String):Row?=s.get(rowKey(cid,seq)).takeIf{it.isNotBlank()}?.let{json.decodeFromString(Row.serializer(),it)}
    private fun put(s:LocalPersistence,cid:String,row:Row)=s.put(rowKey(cid,row.sequenceId),json.encodeToString(Row.serializer(),row))
    private fun cache(s:LocalPersistence)=RemoteCacheStore(s,strictReads=true)
    private fun hash(h:RemoteHistory):String=MessageDigest.getInstance("SHA-256").digest(json.encodeToString(RemoteHistory.serializer(),h).toByteArray()).joinToString(""){"%02x".format(it)}
    private fun branch(h:RemoteHistory,tid:String,uid:String):Pair<RemoteTurn,List<RemoteVariant>>{
        val t=h.turns.singleOrNull{it.id==tid}?:error("连续回复原轮次不存在。")
        require(t.user.variants.getOrNull(t.user.active)?.let{it.id==uid&&!it.hidden}==true&&t.turnType!="landing")
        return t to t.assistant.variantsByUserVariant[t.user.active.toString()].orEmpty()
    }
    private fun history(s:LocalPersistence,cid:String,row:Row):RemoteHistory?{
        val c=cache(s)
        if(c.conversations().none{it.id==cid&&it.deletedAt==null&&it.roomType in setOf("main","radio")})return null
        return c.history(cid)?.takeIf{hash(it)==row.historyHash&&it.contextSettings.replySequenceEnabled}
    }
    private fun remaining(row:Row):Pair<Int,Int>?{
        var tools=row.tools;var tokens=row.tokens.toLong()
        for(r in row.receipts){
            val n=r.toolCalls?:return null;val t=r.totalTokens?:return null
            if(n<0||t<0)return null
            tools=(tools-n.coerceAtMost(tools)).coerceAtLeast(0);tokens=(tokens-t.coerceAtMost(tokens)).coerceAtLeast(0)
        }
        return tools to tokens.toInt()
    }
    fun active(cid:String):Boolean=store.readConsistent{s->
        val seq=s.get(activeKey(cid));seq.isNotBlank()&&get(s,cid,seq)?.status=="running"
    }
    fun recover(cid:String,now:Long=System.currentTimeMillis()):Boolean=store.atomic{s->
        val seq=s.get(activeKey(cid));val row=seq.takeIf{it.isNotBlank()}?.let{get(s,cid,it)}
        if(row==null||row.status!="running"||isLive(cid,seq)||row.updatedAt>=now-30*60*1000L)return@atomic false
        settleIn(s,cid,row,"interrupted",now)
    }
    fun acquire(request:RemoteReplyRunRequest):Boolean=store.readConsistent{s->
        val cid=request.conversationId;val seq=request.sequenceId
        checkIds(cid,seq,request.turnId,request.userVariantId)
        val old=s.get(activeKey(cid))
        if(get(s,cid,seq)!=null||old.isNotBlank()&&get(s,cid,old)?.status=="running")return@readConsistent false
        val c=cache(s);val h=c.history(cid)?:return@readConsistent false
        if(c.conversations().none{it.id==cid&&it.deletedAt==null&&it.roomType in setOf("main","radio")}||!h.contextSettings.replySequenceEnabled)return@readConsistent false
        val (_,list)=branch(h,request.turnId,request.userVariantId)
        val cfg=h.contextSettings.normalized()
        val max=minOf(request.budget.maxMessages,cfg.replySequenceMaxMessages?:request.budget.maxMessages,20-list.size)
        if(max<1||list.any{it.replySequence?.id==seq||it.finishReason in setOf("image_pending","image_tool_ready","sticker_tool_ready","image_saved","sticker_saved")})return@readConsistent false
        val row=Row(seq,request.turnId,request.userVariantId,"running",max,
            minOf(request.budget.toolBudget,cfg.replySequenceToolBudget?:request.budget.toolBudget),
            minOf(request.budget.tokenBudget,cfg.replySequenceTokenBudget?:request.budget.tokenBudget),hash(h),System.currentTimeMillis())
        s.atomic{staged->put(staged,cid,row);staged.put(activeKey(cid),seq)}
        true
    }
    fun maxMessages(cid:String,seq:String):Int=store.readConsistent{s->requireNotNull(get(s,cid,seq)).max}
    fun reserve(cid:String,seq:String,mid:String,index:Int):Boolean=store.readConsistent{s->
        checkIds(cid,seq,mid)
        val r=get(s,cid,seq)?:return@readConsistent false
        if(r.status!="running"||r.pendingId!=null||index!=r.receipts.size||index>=r.max||index>0&&!r.receipts.last().continueRequested)return@readConsistent false
        if((remaining(r)?.second?:0)<=0)return@readConsistent false
        val h=history(s,cid,r)?:return@readConsistent false
        val (_,list)=branch(h,r.turnId,r.userId)
        if(list.size>=20||h.turns.any{t->t.assistant.variantsByUserVariant.values.flatten().any{it.id==mid}}||list.filter{it.replySequence?.id==seq}.map{it.id}!=r.receipts.map{it.messageId})return@readConsistent false
        put(s,cid,r.copy(pendingId=mid,pendingState="reserved",updatedAt=System.currentTimeMillis()));true
    }
    fun claim(cid:String,seq:String,mid:String):Claim?=store.readConsistent{s->
        val r=get(s,cid,seq)?:return@readConsistent null
        if(r.status!="running"||r.pendingId!=mid||r.pendingState!="reserved")return@readConsistent null
        val budget=remaining(r)?:return@readConsistent null
        if(budget.second<=0)return@readConsistent null
        val h=history(s,cid,r)?:return@readConsistent null
        val (_,list)=branch(h,r.turnId,r.userId)
        if(list.size>=20)return@readConsistent null
        put(s,cid,r.copy(pendingState="claimed",updatedAt=System.currentTimeMillis()))
        Claim(r.receipts.size,r.receipts.size+1<r.max&&list.size+1<20,budget.first,budget.second,h,list.filter{it.replySequence?.id==seq})
    }
    // Every media mutation runs inside the original binary-store transaction.
    // These helpers operate on its staged store, not a second transaction.
    fun allowsMedia(cid:String,tid:String,uid:String,mid:String,seq:String?):Boolean=store.readConsistent{s->
        if(seq==null)return@readConsistent !LocalReplyRunStore(s).active(cid)
        val r=get(s,cid,seq)?:return@readConsistent false
        r.status=="running"&&r.pendingState=="claimed"&&r.pendingId==mid&&r.turnId==tid&&r.userId==uid&&history(s,cid,r)!=null
    }
    fun syncMediaHistory(cid:String,seq:String?){
        if(seq==null)return
        val row=requireNotNull(get(store,cid,seq))
        require(row.status=="running"&&row.pendingState=="claimed")
        val h=requireNotNull(cache(store).history(cid))
        put(store,cid,row.copy(historyHash=hash(h),updatedAt=System.currentTimeMillis()))
    }
    fun reserveMedia(cid:String,seq:String,mid:String,model:String,image:Boolean):Boolean=store.atomic{s->
        val r=get(s,cid,seq)?:return@atomic false
        if(!LocalReplyRunStore(s).allowsMedia(cid,r.turnId,r.userId,mid,seq))return@atomic false
        val h=history(s,cid,r)?:return@atomic false
        val(t,list)=branch(h,r.turnId,r.userId)
        if(list.size>=20||h.turns.any{v->(v.user.variants+v.assistant.variantsByUserVariant.values.flatten()).any{it.id==mid}})return@atomic false
        val key=t.user.active.toString()
        val now=Instant.now().toString()
        val slot=RemoteVariant(mid,"",now,modelId=model,finishReason=if(image)"image_tool_ready"else "sticker_tool_ready",generationSource="chat")
        val next=t.copy(assistant=t.assistant.copy(variantsByUserVariant=t.assistant.variantsByUserVariant+(key to (list+slot))))
        cache(s).putHistory(cid,h.copy(updatedAt=now,turns=h.turns.map{if(it.id==t.id)next else it}))
        LocalReplyRunStore(s).syncMediaHistory(cid,seq)
        true
    }
    fun commit(cid:String,seq:String,variant:RemoteVariant,usage:Usage):Pair<RemoteHistory,Usage>?=store.atomic{s->
        val r=get(s,cid,seq)?:return@atomic null
        if(r.status!="running"||r.pendingId!=variant.id||r.pendingState!="claimed"||usage.messageId!=variant.id)return@atomic null
        val budget=remaining(r)?:return@atomic null
        val h=history(s,cid,r)?:return@atomic null
        val (turn,list)=branch(h,r.turnId,r.userId)
        val slotIndex=list.indexOfFirst{it.id==variant.id}
        val slot=list.getOrNull(slotIndex)
        if(slot!=null&&(slotIndex!=list.lastIndex||slot.replySequence!=null||slot.finishReason !in setOf("image_tool_ready","sticker_tool_ready","image_saved","sticker_saved","image_failed")))return@atomic null
        val originals=slot?.attachments.orEmpty().filter{it.imageGeneration?.messageId==variant.id||it.stickerDelivery?.messageId==variant.id}
        if((slot==null&&list.size>=20)||(variant.content.isBlank()&&originals.isEmpty()))return@atomic null
        val known=usage.toolCalls?.let{it in 0..budget.first}==true&&usage.totalTokens?.let{it>=0}==true
        val receipt=usage.copy(toolCalls=usage.toolCalls.takeIf{known},totalTokens=usage.totalTokens.takeIf{known},
            continueRequested=known&&usage.totalTokens!!<budget.second&&usage.continueRequested&&variant.finishReason=="stop")
        val key=turn.user.active.toString()
        val saved=variant.copy(createdAt=slot?.createdAt?:variant.createdAt,attachments=originals,replySequence=RemoteReplySequence(seq,r.receipts.size),archiveRetainedDeskSlip=true)
        val next=turn.copy(assistant=turn.assistant.copy(activeByUserVariant=turn.assistant.activeByUserVariant+(key to if(slot==null)list.size else slotIndex),
            variantsByUserVariant=turn.assistant.variantsByUserVariant+(key to if(slot==null)list+saved else list.map{if(it.id==saved.id)saved else it})))
        val c=cache(s)
        c.putHistory(cid,h.copy(updatedAt=Instant.now().toString(),archiveStorageUpdatedAt=null,turns=h.turns.map{if(it.id==turn.id)next else it}))
        val canonical=requireNotNull(c.history(cid))
        put(s,cid,r.copy(historyHash=hash(canonical),pendingId=null,pendingState=null,receipts=r.receipts+receipt,updatedAt=System.currentTimeMillis()))
        canonical to receipt
    }
    fun settle(cid:String,seq:String,status:String):Boolean=store.atomic{s->
        val r=get(s,cid,seq)?:return@atomic false
        settleIn(s,cid,r,status,System.currentTimeMillis())
    }
    private fun settleIn(s:LocalPersistence,cid:String,r:Row,status:String,now:Long):Boolean{
        require(status in setOf("completed","limit_reached","permission_or_budget","reservation_lost","failed","cancelled","interrupted"))
        if(r.status!="running"||r.pendingId!=null&&status in setOf("completed","limit_reached"))return false
        var nextHash=r.historyHash
        if(r.pendingId!=null){
            val h=history(s,cid,r)?:return false
            val(t,list)=branch(h,r.turnId,r.userId)
            val slot=list.firstOrNull{it.id==r.pendingId}
            if(slot!=null&&slot.replySequence==null){
                if(slot.finishReason !in setOf("image_tool_ready","sticker_tool_ready","image_pending","image_saved","sticker_saved","image_failed"))return false
                val originals=slot.attachments.filter{it.imageGeneration?.messageId==slot.id||it.stickerDelivery?.messageId==slot.id}
                val keep=originals.isNotEmpty()||slot.finishReason in setOf("image_pending","image_failed")
                val replacement=if(keep)slot.copy(
                    finishReason=if(originals.isEmpty())"image_failed" else if(originals.any{it.imageGeneration!=null})"image_saved_interrupted" else "sticker_saved_interrupted",
                    errorDetail=if(originals.isEmpty())"绘图未确认完成；不会自动重试，供应商可能已计费。"else "图片原件已保存，连续回复文字未确认完成。",
                    replySequence=RemoteReplySequence(r.sequenceId,r.receipts.size))else null
                val key=t.user.active.toString()
                val updated=list.flatMap{if(it.id==slot.id)listOfNotNull(replacement)else listOf(it)}
                val active=if(keep)updated.lastIndex else (t.assistant.activeByUserVariant[key]?:0).coerceIn(0,maxOf(0,updated.lastIndex))
                val next=t.copy(assistant=t.assistant.copy(variantsByUserVariant=t.assistant.variantsByUserVariant+(key to updated),activeByUserVariant=t.assistant.activeByUserVariant+(key to active)))
                val c=cache(s);c.putHistory(cid,h.copy(updatedAt=Instant.ofEpochMilli(now).toString(),turns=h.turns.map{if(it.id==t.id)next else it}))
                nextHash=hash(requireNotNull(c.history(cid)))
            }
        }
        put(s,cid,r.copy(status=status,historyHash=nextHash,updatedAt=now));return true
    }
    fun claimSoil(cid:String,seq:String):Boolean=store.readConsistent{s->
        val r=get(s,cid,seq)?:return@readConsistent false
        if(r.status=="running"||r.soilState!=null||r.receipts.isEmpty()||active(cid))return@readConsistent false
        val h=history(s,cid,r)?:return@readConsistent false
        val(t,list)=branch(h,r.turnId,r.userId)
        if(list.getOrNull(t.assistant.activeByUserVariant[t.user.active.toString()]?:-1)?.id!=r.receipts.last().messageId)return@readConsistent false
        put(s,cid,r.copy(soilState="claimed"));true
    }
    fun finishSoil(cid:String,seq:String,status:String)=store.readConsistent{s->
        require(status in setOf("done","failed","skipped"))
        val r=get(s,cid,seq)?:return@readConsistent false
        if(r.soilState!="claimed")return@readConsistent false
        put(s,cid,r.copy(soilState=status));true
    }
    companion object{
        private val live=java.util.concurrent.ConcurrentHashMap.newKeySet<Pair<String,String>>()
        fun markLive(cid:String,seq:String):Boolean=live.add(cid to seq)
        fun unmarkLive(cid:String,seq:String){live.remove(cid to seq)}
        private fun isLive(cid:String,seq:String):Boolean=live.contains(cid to seq)
        fun protect(old:RemoteHistory,next:RemoteHistory,deleteRevision:String?){
            for(t in old.turns){
                val incoming=next.turns.firstOrNull{it.id==t.id}
                for((key,list) in t.assistant.variantsByUserVariant){
                    val uid=t.user.variants.getOrNull(key.toIntOrNull()?:-1)?.id
                    val newKey=incoming?.user?.variants?.indexOfFirst{it.id==uid}?:-1
                    val variants=incoming?.assistant?.variantsByUserVariant?.get(newKey.toString()).orEmpty()
                    for(group in list.filter{it.replySequence!=null}.groupBy{it.replySequence!!.id}.values){
                        val matches=group.map{v->variants.firstOrNull{it.id==v.id}}
                        if(matches.all{it==null}&&deleteRevision!=null&&deleteRevision==old.updatedAt)continue
                        require(matches.withIndex().all{(i,v)->v!=null&&v.replySequence==group[i].replySequence&&v.content==group[i].content&&v.finishReason==group[i].finishReason}){"连续回复历史已经变化；请按整组操作。"}
                    }
                }
            }
        }
    }
}
