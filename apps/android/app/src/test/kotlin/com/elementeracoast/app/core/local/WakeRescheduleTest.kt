package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.remote.DreamConfig
import com.elementeracoast.app.core.remote.DreamExecutionConfig
import com.elementeracoast.app.core.remote.DreamSettings
import java.time.Instant
import org.junit.Assert.*
import org.junit.Test

class WakeRescheduleTest {
    private fun t(value:String)=Instant.parse(value).toEpochMilli()
    private val original=DreamConfig(timeZone="Asia/Shanghai",dailyTime="09:00",execution=DreamExecutionConfig(invitation="fixture"))

    @Test fun clockChangeCreatesNewSlotButUnchangedSaveDoesNot(){
        val used=setOf("daily:2026-11-28")
        val first=DreamSettings(enabled=true,config=original,armedAt=t("2026-11-28T00:00:00Z"))
        assertNull(LocalDreamSchedule.candidate(first,used,t("2026-11-28T01:01:00Z")))
        val edited=LocalDreamSchedule.withScheduleIdentity(original.copy(dailyTime="10:00"),original)
        assertNotNull(edited.scheduleEpoch)
        val next=first.copy(config=edited,armedAt=t("2026-11-28T01:02:00Z"))
        assertNull(LocalDreamSchedule.candidate(next,used,t("2026-11-28T01:59:59Z")))
        val slot=requireNotNull(LocalDreamSchedule.candidate(next,used,t("2026-11-28T02:00:00Z")))
        assertEquals("daily:2026-11-28:"+edited.scheduleEpoch,slot.key)
        val resaved=LocalDreamSchedule.withScheduleIdentity(edited.copy(execution=original.execution!!.copy(tokenBudget=9999)),edited)
        assertEquals(edited.scheduleEpoch,resaved.scheduleEpoch)
        assertNull(LocalDreamSchedule.candidate(next.copy(config=resaved),used+slot.key,t("2026-11-28T02:01:00Z")))
        assertNotEquals(edited.scheduleEpoch,LocalDreamSchedule.withScheduleIdentity(edited.copy(dailyTime="11:00"),edited).scheduleEpoch)
    }

    @Test fun restoringOrEnablingAfterMissedTimeDoesNotReplay(){
        val cfg=LocalDreamSchedule.withScheduleIdentity(original.copy(dailyTime="10:00"),original)
        val s=DreamSettings(enabled=true,config=cfg,armedAt=t("2026-11-28T02:01:00Z"))
        assertNull(LocalDreamSchedule.candidate(s,emptySet(),t("2026-11-28T03:00:00Z")))
        assertNotNull(LocalDreamSchedule.candidate(s,emptySet(),t("2026-11-29T02:00:00Z")))
    }
}
