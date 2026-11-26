package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.network.RemoteReplyRunBudget
import com.elementeracoast.app.core.network.RemoteReplyRunRequest
import com.elementeracoast.app.core.remote.*
import com.elementeracoast.app.core.model.ConversationContextSettings
import com.elementeracoast.app.feature.chat.ChatSyncMapper
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.*
import org.junit.Test

class LocalReplyRunStoreTest {
    @Test fun canonicalCommitAndRecoveryNeverReplay(){
        val store=MemoryLocalPersistence();val cache=RemoteCacheStore(store)
        cache.putConversations(listOf(RemoteConversation("cid","test","main")))
        val base=ChatSyncMapper.appendUser(RemoteHistory(conversationId="cid",contextSettings=ConversationContextSettings(replySequenceEnabled=true,replySequenceToolBudget=0)),"question")
        cache.putHistory("cid",base.history)
        val uid=base.history.turns.single().user.variants.single().id
        val req=RemoteReplyRunRequest("cid",base.turnId,uid,"seq","model",RemoteReplyRunBudget(2,24,1000),"2026-11-26","2026-11-26 12:00",JsonObject(emptyMap()))
        val ledger=LocalReplyRunStore(store)
        assertTrue(ledger.acquire(req));assertFalse(ledger.acquire(req.copy(sequenceId="race")))
        assertTrue(ledger.reserve("cid","seq","a0",0));assertFalse(ledger.reserve("cid","seq","race",0))
        val first=ledger.claim("cid","seq","a0")!!
        assertEquals(0,first.tools);assertTrue(first.previous.isEmpty());assertNull(ledger.claim("cid","seq","a0"))
        val committed=ledger.commit("cid","seq",RemoteVariant("a0","first",finishReason="stop"),LocalReplyRunStore.Usage("a0",0,100,true))!!
        assertEquals(committed.first,cache.history("cid"))
        assertTrue(ledger.reserve("cid","seq","a1",1))
        val second=ledger.claim("cid","seq","a1")!!
        assertEquals(listOf("first"),second.previous.map{it.content});assertEquals(900,second.tokens);assertFalse(second.mayContinue)
        assertTrue(ledger.recover("cid",System.currentTimeMillis()+31*60*1000))
        assertNull(ledger.claim("cid","seq","a1"))
        assertNull(ledger.commit("cid","seq",RemoteVariant("a1","late",finishReason="stop"),LocalReplyRunStore.Usage("a1",0,1,false)))
        assertFalse(ledger.acquire(req))
        assertEquals(committed.first,cache.history("cid"))
        assertTrue(ledger.claimSoil("cid","seq"));assertFalse(ledger.claimSoil("cid","seq"));assertTrue(ledger.finishSoil("cid","seq","done"))
        assertTrue(runCatching{LocalReplyRunStore.protect(committed.first,base.history,null)}.isFailure)
        LocalReplyRunStore.protect(committed.first,base.history,committed.first.updatedAt)
    }
}
