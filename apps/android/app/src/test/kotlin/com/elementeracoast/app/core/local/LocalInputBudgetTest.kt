package com.elementeracoast.app.core.local

import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class LocalInputBudgetTest {
    @Test fun autoReservesOutputAndToolsAndManualIsClampedOnlyWhenKnown(){
        val entry=buildJsonObject{
            put("context_length",128000);putJsonObject("top_provider"){put("context_length",64000)}
            putJsonObject("architecture"){putJsonArray("input_modalities"){add("text");add("image")}}
        }
        val auto=LocalInputBudget.resolve(0,8000,true,entry)
        assertEquals(49600,auto.comfort)
        assertEquals(55744,auto.wireLimit)
        assertEquals(true,auto.vision)
        assertEquals(12000,LocalInputBudget.resolve(12000,8000,true,entry).comfort)
        assertEquals(49600,LocalInputBudget.resolve(90000,8000,true,entry).comfort)
        assertEquals(18000,LocalInputBudget.resolve(0,8000,true,null).comfort)
        assertEquals(90000,LocalInputBudget.resolve(90000,8000,true,null).comfort)
        assertNull(LocalInputBudget.resolve(0,8000,true,null).wireLimit)
        assertNull(LocalInputBudget.resolve(0,8000,true,null).vision)
        assertTrue(runCatching{LocalInputBudget.resolve(0,8000,true,buildJsonObject{put("context_length",8192)})}.isFailure)
    }
}
