package com.elementeracoast.app.core.model

import org.junit.Assert.assertEquals
import org.junit.Test

class ReplySegmentsTest {
    @Test fun onlyExplicitMarkersSplit() {
        val marker = ReplySegments.MARKER
        assertEquals(listOf("甲\n\n乙"),ReplySegments.split("甲\n\n乙"))
        assertEquals(listOf("甲","乙"),ReplySegments.split("甲\n"+marker+"\n乙"))
        assertEquals("甲\n\n乙",ReplySegments.plain("甲\n"+marker+"\n乙"))
        val code = "```html\n"+marker+"\n```"
        assertEquals(listOf(code),ReplySegments.split(code))
        assertEquals(listOf("甲"),ReplySegments.split("甲\n"+marker.take(8),true))
    }
}
