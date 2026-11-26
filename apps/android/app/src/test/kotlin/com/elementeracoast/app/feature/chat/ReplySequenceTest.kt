package com.elementeracoast.app.feature.chat

import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class ReplySequenceTest {
    private val identity=ReplySequence.Identity("window","turn","user","sequence")
    @Test fun eachCallFollowsCanonicalCommitAndOrganizesOnce()=runBlocking{
        val events=mutableListOf<String>();var n=0
        val r=ReplySequence.run(identity,3,{(++n).toString()},
            acquire={true},reserve={events.add("reserve:"+it.messageId);true},
            invoke={step,prior->events.add("invoke:"+step.messageId+":"+prior.joinToString(","){it.id});ReplySequence.Response(step.messageId,true,true)},
            commit={step,result->events.add("commit:"+step.messageId);ReplySequence.Saved(step.messageId,result.value)},
            settle={events.add("settle:"+it.status)},organize={events.add("organize:"+it.messages.size)})
        assertEquals("limit_reached",r.status)
        assertEquals(listOf("reserve:1","invoke:1:","commit:1","reserve:2","invoke:2:1","commit:2","reserve:3","invoke:3:1,2","commit:3","settle:limit_reached","organize:3"),events)
    }
    @Test fun failuresDoNotReplayAndPreserveSavedMessages()=runBlocking{
        var n=0;var organized=0;var pending:String?=null
        val r=ReplySequence.run(identity,3,{(++n).toString()},
            acquire={true},reserve={true},
            invoke={step,_->if(step.index==1)error("provider");ReplySequence.Response("first",true,true)},
            commit={step,result->ReplySequence.Saved(step.messageId,result.value)},
            settle={pending=it.pending?.messageId},organize={organized++})
        assertEquals("failed",r.status);assertEquals("2",pending);assertEquals(1,r.messages.size);assertEquals(1,organized);assertEquals(2,n)
    }
    @Test fun revocationStopsBeforeNextReservation()=runBlocking{
        var n=0;var organized=0
        val r=ReplySequence.run(identity,3,{(++n).toString()},
            acquire={true},reserve={true},invoke={_,_->ReplySequence.Response("first",true,true)},
            commit={step,result->ReplySequence.Saved(step.messageId,result.value)},settle={},organize={organized++},canContinue={_,_->false})
        assertEquals("permission_or_budget",r.status);assertEquals(1,n);assertEquals(1,organized)
    }
    @Test fun groupIdentitySurvivesWireFormatWithoutChangingLegacyVariants(){
        val first=com.elementeracoast.app.core.remote.RemoteVariant("first",replySequence=com.elementeracoast.app.core.remote.RemoteReplySequence("group",0))
        val second=first.copy(id="second",replySequence=first.replySequence!!.copy(index=1))
        val old=com.elementeracoast.app.core.remote.RemoteVariant("old")
        val codec=kotlinx.serialization.json.Json{encodeDefaults=true}
        val ser=com.elementeracoast.app.core.remote.RemoteVariant.serializer()
        assertFalse(codec.encodeToString(ser,old).contains("reply_sequence"))
        val decoded=codec.decodeFromString(ser,codec.encodeToString(ser,second))
        assertEquals(second,decoded)
        val rows=listOf(old,first,decoded)
        assertEquals(listOf(first,second),ReplySequence.selectedGroup(rows,2))
        assertEquals(listOf(old),ReplySequence.selectedGroup(rows,0))
        assertTrue(runCatching{ReplySequence.selectedGroup(listOf(second),0)}.isFailure)
    }

    @org.junit.Test
    fun humanBudgetOverridesInheritAndRespectCapacity(){
        val global=com.elementeracoast.app.feature.wolf.BasicSettings(replySequenceMaxMessages=5,replySequenceToolBudget=18,replySequenceTokenBudget=12000)
        val window=com.elementeracoast.app.core.model.ConversationContextSettings(replySequenceEnabled=true,replySequenceMaxMessages=4,replySequenceToolBudget=0,replySequenceTokenBudget=9000)
        val budget=ReplySequence.resolveBudget(global,window,18)
        org.junit.Assert.assertEquals(ReplySequence.Budget(true,2,0,9000),budget)
        org.junit.Assert.assertEquals(1,ReplySequence.resolveBudget(global,window.copy(replySequenceEnabled=false),0).maxMessages)
        org.junit.Assert.assertEquals(0,ReplySequence.resolveBudget(global,window,20).maxMessages)
        org.junit.Assert.assertEquals(ReplySequence.Remaining(true,0,0),ReplySequence.remainingBudget(budget,listOf(ReplySequence.Usage(0,9000))))
        org.junit.Assert.assertFalse(ReplySequence.remainingBudget(budget,listOf(ReplySequence.Usage(0,null))).known)
        org.junit.Assert.assertEquals(5,ReplySequence.resolveBudget(global,window.copy(replySequenceMaxMessages=-1),0).maxMessages)
    }

}
