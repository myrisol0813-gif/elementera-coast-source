package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.remote.*
import org.junit.Assert.*
import org.junit.Test

class LocalDailyCommentTest {
    @Test fun instantContextAndCommitPreserveRealComments() {
        val s=MemoryLocalPersistence();val cache=RemoteCacheStore(s)
        val target=RemoteDailyMoment(id="post",date="2026-11-25",text="今天下雨",comments=listOf(RemoteDailyComment("old",text="旧留言")))
        val past=RemoteDailyMoment(id="past",text="昨天晴天")
        cache.putDailyMoments(listOf(target,past))
        cache.putCustomInstructions(RemoteCustomInstructions(content="测试指令"))
        val p=LocalDailyCommentRun.prepare(s,"post")
        assertTrue(p.system.contains("测试指令"));assertTrue(p.paper.contains("今天下雨"));assertTrue(p.paper.contains("旧留言"));assertTrue(p.paper.contains("昨天晴天"))
        val result=LocalDailyCommentRun.commit(s,p,LocalDailyCommentRun.Generated("记得带伞。听听雨声吧。第三句。","fixture-model",RemoteModelUsage(promptTokens=12)))
        assertEquals(2,result.comments.size)
        assertEquals("记得带伞。听听雨声吧。",result.comments.last().text)
        assertEquals("model_partner",result.comments.last().author)
        assertEquals("fixture-model",result.comments.last().modelId)
        assertEquals(12L,result.comments.last().usage?.promptTokens)
        assertEquals(result,cache.dailyMoments().first())
        assertTrue(runCatching{LocalDailyCommentRun.commit(s,p,LocalDailyCommentRun.Generated("重复","fixture-model"))}.isFailure)
        val fresh=LocalDailyCommentRun.prepare(s,"post")
        cache.putDailyMoments(listOf(past))
        assertTrue(runCatching{LocalDailyCommentRun.commit(s,fresh,LocalDailyCommentRun.Generated("已删除","fixture-model"))}.isFailure)
        assertEquals(listOf(past),cache.dailyMoments())
    }
}
