package com.elementeracoast.app.feature.shell

import org.junit.Assert.*
import org.junit.Test

class GenerationLeaseRegistryTest {
    @Test fun staleCompletionAndNotificationCannotAffectNextGeneration() {
        val r=GenerationLeaseRegistry()
        var first=0;var second=0
        assertTrue(r.acquire(GenerationLeaseRegistry.Lease("first",{first++},{})))
        assertFalse(r.acquire(GenerationLeaseRegistry.Lease("second",{second++},{})))
        r.cancel("first");assertEquals(1,first)
        assertTrue(r.release("first"))
        assertTrue(r.acquire(GenerationLeaseRegistry.Lease("second",{second++},{})))
        assertFalse(r.release("first"));r.cancel("first")
        assertEquals(0,second);assertEquals("second",r.current()?.token)
        r.cancel("second");assertEquals(1,second)
        assertTrue(r.release("second"));assertNull(r.current())
    }
}
