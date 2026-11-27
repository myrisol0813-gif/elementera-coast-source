package com.elementeracoast.app.core.restbox

import org.junit.Assert.*
import org.junit.Test

class LegacyStudioRecoveryTest {
    @Test fun chromiumEncodingMarkersAreDecodedWithoutGuessing() {
        val ascii="""{"version":1,"room":"living"}"""
        assertEquals(ascii,LegacyStudioRecovery.decode(byteArrayOf(1)+ascii.toByteArray(Charsets.ISO_8859_1)))
        val chinese="""{"room":"书房","note":"小狼🌊"}"""
        assertEquals(chinese,LegacyStudioRecovery.decode(byteArrayOf(0)+chinese.toByteArray(Charsets.UTF_16LE)))
        for(raw in listOf(byteArrayOf(),byteArrayOf(2,1),byteArrayOf(0,1),byteArrayOf(0,0,0xD8.toByte()))){
            assertThrows(Exception::class.java){LegacyStudioRecovery.decode(raw)}
        }
    }

    @Test fun motionUsesIndependentPeriodsAndSignedDelay() {
        val t=NativeMotionTrack("chime","opacity",1000.0,-250.0,false,listOf("0",".25",".5",".75"))
        assertEquals(".25",t.frame(0))
        assertEquals(".5",t.frame(250))
        assertEquals("0",t.frame(750))
        val delayed=t.copy(delayMs=200.0,alternate=true)
        assertNull(delayed.frame(199))
        assertEquals("0",delayed.frame(200))
        assertEquals(".75",delayed.frame(1200))
    }
}
