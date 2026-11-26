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
        assertTrue(LocalReplyRunStore.markLive("cid","seq"))
        try{
            assertFalse(LocalReplyRunStore.markLive("cid","seq"))
            assertFalse(ledger.recover("cid",System.currentTimeMillis()+31*60*1000))
            assertTrue(ledger.active("cid"))
        }finally{LocalReplyRunStore.unmarkLive("cid","seq")}
        assertTrue(ledger.recover("cid",System.currentTimeMillis()+31*60*1000))
        assertNull(ledger.claim("cid","seq","a1"))
        assertNull(ledger.commit("cid","seq",RemoteVariant("a1","late",finishReason="stop"),LocalReplyRunStore.Usage("a1",0,1,false)))
        assertFalse(ledger.acquire(req))
        assertEquals(committed.first,cache.history("cid"))
        assertTrue(ledger.claimSoil("cid","seq"));assertFalse(ledger.claimSoil("cid","seq"));assertTrue(ledger.finishSoil("cid","seq","done"))
        assertTrue(runCatching{LocalReplyRunStore.protect(committed.first,base.history,null)}.isFailure)
        LocalReplyRunStore.protect(committed.first,base.history,committed.first.updatedAt)
    }
    @Test fun mediaSlotAndOriginalsShareOneLedgerTransaction(){
        val store=MemoryLocalPersistence();val cache=RemoteCacheStore(store)
        cache.putConversations(listOf(RemoteConversation("cid","test","main")))
        val base=ChatSyncMapper.appendUser(RemoteHistory(conversationId="cid",contextSettings=ConversationContextSettings(replySequenceEnabled=true,stickerSendEnabled=true,localModelToolsEnabled=true,localModelWriteEnabled=true)),"question")
        cache.putHistory("cid",base.history)
        val uid=base.history.turns.single().user.variants.single().id
        val req=RemoteReplyRunRequest("cid",base.turnId,uid,"seq","model",RemoteReplyRunBudget(2,4,1000),"2026-11-26","2026-11-26 12:00",JsonObject(emptyMap()))
        val png=byteArrayOf(137.toByte(),80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,6,0,0,0)
        val lib=LocalStickerLibrary(store);val sticker=lib.upload("wolf.png","image/png","wolf",png)
        val ledger=LocalReplyRunStore(store)
        assertTrue(ledger.acquire(req));assertTrue(ledger.reserve("cid","seq","a0",0))
        assertFalse(ledger.reserveMedia("cid","seq","a0","model",false))
        assertNotNull(ledger.claim("cid","seq","a0"))
        assertTrue(ledger.reserveMedia("cid","seq","a0","model",false))
        assertFalse(ledger.reserveMedia("cid","seq","a0","model",false))
        assertTrue(runCatching{lib.deliver("cid",base.turnId,uid,"a0",sticker.id,true)}.isFailure)
        val first=lib.deliver("cid",base.turnId,uid,"a0",sticker.id,true,"seq")
        assertTrue(lib.deliver("cid",base.turnId,uid,"a0",sticker.id,true,"seq").reused)
        assertNotNull(ledger.commit("cid","seq",RemoteVariant("a0","",finishReason="stop"),LocalReplyRunStore.Usage("a0",1,100,true)))
        assertTrue(ledger.reserve("cid","seq","a1",1))
        val next=ledger.claim("cid","seq","a1")!!
        assertEquals(first.attachment.id,next.previous.single().attachments.single().id)
        assertTrue(ledger.reserveMedia("cid","seq","a1","model",false))
        val second=lib.deliver("cid",base.turnId,uid,"a1",sticker.id,true,"seq")
        assertTrue(ledger.recover("cid",System.currentTimeMillis()+31*60*1000))
        val group=cache.history("cid")!!.turns.single().assistant.variantsByUserVariant.getValue("0")
        assertEquals(listOf("a0","a1"),group.map{it.id})
        assertEquals(listOf(0,1),group.map{it.replySequence!!.index})
        assertEquals("sticker_saved_interrupted",group.last().finishReason)
        assertEquals(second.attachment.id,group.last().attachments.single().id)
        assertTrue(runCatching{lib.deliver("cid",base.turnId,uid,"a1",sticker.id,true,"seq")}.isFailure)
        assertFalse(ledger.claimSoil("cid","seq"))
    }

    @Test fun storedWindowBudgetCannotIncreaseSubmittedAllowance(){
        val store=MemoryLocalPersistence();val cache=RemoteCacheStore(store)
        cache.putConversations(listOf(RemoteConversation("cid","test","main")))
        val base=ChatSyncMapper.appendUser(RemoteHistory(conversationId="cid",contextSettings=ConversationContextSettings(replySequenceEnabled=true,replySequenceMaxMessages=8,replySequenceToolBudget=24,replySequenceTokenBudget=48000)),"question")
        cache.putHistory("cid",base.history)
        val req=RemoteReplyRunRequest("cid",base.turnId,base.history.turns.single().user.variants.single().id,"seq","model",RemoteReplyRunBudget(1,0,2000),"2026-11-26","2026-11-26 12:00",JsonObject(emptyMap()))
        val ledger=LocalReplyRunStore(store)
        assertTrue(ledger.acquire(req));assertEquals(1,ledger.maxMessages("cid","seq"))
        assertTrue(ledger.reserve("cid","seq","a0",0))
        val c=ledger.claim("cid","seq","a0")!!
        assertFalse(c.mayContinue);assertEquals(0,c.tools);assertEquals(2000,c.tokens)
    }

}
