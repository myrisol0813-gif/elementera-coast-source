package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.model.ConversationContextSettings
import com.elementeracoast.app.core.remote.*
import java.time.LocalDateTime
import org.junit.Assert.*
import org.junit.Test

class LocalRealityTest {
    @Test fun onlyEnabledFieldsAreDeliveredAndMissingIsHonest(){
        val store=MemoryLocalPersistence()
        val snapshot=RemoteRealityContext(timezone="UTC",battery=RemoteRealityBattery(71,true),location=RemoteRealityLocation("不应出现的位置"),recentApp=RemoteRealityApp("不应出现的应用"))
        val now=LocalDateTime.parse("2026-11-25T12:34:00")
        val settings=ConversationContextSettings(realityEnabled=true,realityFields=listOf("date","time","battery","weather","calendar"),shortReplyMode=true)
        val receipt=localReality(store,settings,snapshot,now)
        assertEquals(setOf("date","time","battery","calendar"),receipt.deliveredItems.map{it.key}.toSet())
        assertEquals(listOf("天气"),receipt.missing)
        assertFalse(receipt.context.contains("不应出现"))
        assertFalse(localReality(store,settings.copy(realityEnabled=false),snapshot,now).delivered)
        assertTrue(localResponseMode(settings).delivered)
        val cache=RemoteCacheStore(store);val cid="fixture"
        cache.putConversations(listOf(RemoteConversation(cid,"窗口","main","2026-11-25T00:00:00Z","2026-11-25T00:00:00Z")))
        cache.putHistory(cid,RemoteHistory(conversationId=cid,contextSettings=settings))
        val ctx=LocalKnowledgeStore(store).context(listOf(RemoteChatMessage("user","你好")),1800,"main_chat",cid,reality=snapshot)
        assertTrue(ctx.receipt.realityContext.delivered)
        assertTrue(ctx.messages.any{it.content.contains("71%")})
        assertTrue(ctx.messages.any{it.content.contains("短句模式")})
        assertFalse(ctx.messages.any{it.content.contains("不应出现")})
    }
}
