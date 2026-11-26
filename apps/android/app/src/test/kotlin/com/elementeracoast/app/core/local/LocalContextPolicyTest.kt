package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.remote.RemoteChatMessage
import org.junit.Assert.*
import org.junit.Test

class LocalContextPolicyTest {
    @Test fun mixedScriptEstimateMatchesOnline(){
        assertEquals(4,LocalContextPolicy.estimate("中文abcde🙂"))
        assertEquals(2,LocalContextPolicy.estimate("かな"))
    }
    @Test fun trimsOptionalSourcesAndKeepsCurrentAndPortraits(){
        val input=listOf(RemoteChatMessage("user","旧".repeat(600)),RemoteChatMessage("assistant","答".repeat(600)),
            RemoteChatMessage("user","旧".repeat(600)),RemoteChatMessage("assistant","答".repeat(600)),
            RemoteChatMessage("user","最新"))
        val r=LocalContextPolicy.assemble("核心","用户正文","自我正文",LocalContextPolicy.formatSoil("土".repeat(800),listOf("余思")),
            List(4){"记".repeat(900)},List(4){"词".repeat(900)},"狗话","","","",input,1800)
        assertEquals(0,r.memoryCount);assertEquals(0,r.worldbookCount);assertTrue(r.trimmed>0)
        assertEquals("最新",r.visible.last().content)
        val system=r.messages.first().content
        assertTrue(system.contains("核心"));assertTrue(system.contains("用户正文"));assertTrue(system.contains("自我正文"))
        assertTrue(system.indexOf("用户正文")<system.indexOf("自我正文"))
        assertFalse(system.contains("记".repeat(900)))
    }
    @Test fun shortReplyModePreservesEnabledSoilWhenItFits(){
        val input=listOf(RemoteChatMessage("user","嗯"))
        val paper=LocalContextPolicy.formatSoil("原有纸条",listOf("余思"))
        fun assemble(mode:String)=LocalContextPolicy.assemble("","","",paper,emptyList(),emptyList(),"","","",mode,input,6000)
        val normal=assemble("")
        val short=assemble("当前对话开启了短句模式。")
        assertEquals(normal.soil,short.soil)
        assertTrue(short.soil.contains("原有纸条"))
        assertTrue(short.messages.first().content.contains("短句模式"))
    }
    @Test fun mandatoryOverflowIsVisibleWithoutSilentTruncation(){
        val body="像".repeat(2200)
        val r=LocalContextPolicy.assemble("自定义",body,"自我","",emptyList(),emptyList(),"","","","",
            listOf(RemoteChatMessage("user","最新")),1800)
        assertTrue(r.over);assertTrue(r.messages.first().content.contains(body))
        assertEquals("最新",r.visible.last().content)
    }
    @Test fun comfortTrimsWholeHumanTurnsNotIndividualGroupReplies(){
        val input=listOf(RemoteChatMessage("user","旧".repeat(1500)),RemoteChatMessage("assistant","答".repeat(1500)),
            RemoteChatMessage("user","group question"),RemoteChatMessage("assistant","one"),RemoteChatMessage("assistant","two"),RemoteChatMessage("assistant","three"),RemoteChatMessage("user","current"))
        val result=LocalContextPolicy.assemble("","","","",emptyList(),emptyList(),"","","","",input,1800)
        assertEquals(listOf("group question","one","two","three","current"),result.visible.map{it.content})
        assertEquals(2,result.trimmed)
    }

}
