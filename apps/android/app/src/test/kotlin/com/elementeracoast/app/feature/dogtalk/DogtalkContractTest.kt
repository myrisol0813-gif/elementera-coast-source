package com.elementeracoast.app.feature.dogtalk

import com.elementeracoast.app.core.model.RoomType
import java.lang.reflect.Modifier
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DogtalkContractTest {
    @Test
    fun dogtalkUiStateKeepsExactlyFourEditableContractFields() {
        val instanceFields = DogtalkUiState::class.java.declaredFields
            .filterNot { it.isSynthetic || Modifier.isStatic(it.modifiers) }
            .map { it.name }
            .toSet()

        assertEquals(setOf("body", "trueCore", "weather", "readMode"), instanceFields)
        assertEquals(listOf("body", "true_core", "weather", "read_mode"), DogtalkContractFields)
    }

    @Test
    fun readModeContractMatchesThreeModePwaCopy() {
        assertEquals(
            listOf(
                "不需要，放着就好",
                "另一位屋主困惑时可以看一点",
                "这次希望另一位屋主直接读一下"
            ),
            DogtalkReadMode.entries.map { it.label }
        )
        assertEquals(
            listOf("keep_private", "when_confused", "read_now"),
            DogtalkReadMode.entries.map { it.wireValue }
        )
        assertEquals(
            listOf(DogtalkReadMode.KeepPrivate, DogtalkReadMode.WhenConfused, DogtalkReadMode.ReadNow),
            DogtalkReadMode.entries
        )
    }

    @Test
    fun allThreeRoomTypesMapToTheSharedDogtalkScope() {
        assertEquals(DogtalkScope.Main, DogtalkScope.from(RoomType.Main))
        assertEquals(DogtalkScope.Radio, DogtalkScope.from(RoomType.Radio))
        assertEquals(DogtalkScope.Lighthouse, DogtalkScope.from(RoomType.Lighthouse))
        assertEquals(listOf("conversation", "radio", "lighthouse"), DogtalkScope.entries.map { it.wireValue })
        assertEquals(3, DogtalkScope.entries.size)
    }

    @Test
    fun privateAndDormantSemanticsStayOutOfCurrentModelSubmission() {
        assertTrue(DogtalkReadMode.KeepPrivate.futureSemantics.contains("不给模型看"))
        assertTrue(DogtalkReadMode.WhenConfused.futureSemantics.contains("不会提交给模型"))
        assertTrue(DogtalkReadMode.ReadNow.futureSemantics.contains("下一次发送一次"))
    }
}
