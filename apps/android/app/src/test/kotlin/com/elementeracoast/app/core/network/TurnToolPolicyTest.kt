package com.elementeracoast.app.core.network

import org.junit.Test
import org.junit.Assert.*

class TurnToolPolicyTest {
    @Test fun ordinaryReadingCanExceedOldLimit() {
        assertTrue(TurnToolPolicy.canExecute(12))
        assertTrue(TurnToolPolicy.canExecute(23))
        assertFalse(TurnToolPolicy.canExecute(24))
        assertTrue(TurnToolPolicy.finalOnly(2,24))
        assertTrue(TurnToolPolicy.finalOnly(24,1))
        assertFalse(TurnToolPolicy.finalOnly(23,23))
    }
    @Test fun olderServerLimitStillRespected() {
        assertFalse(TurnToolPolicy.canExecute(12,12))
        assertTrue(TurnToolPolicy.finalOnly(2,12,12))
    }
}
