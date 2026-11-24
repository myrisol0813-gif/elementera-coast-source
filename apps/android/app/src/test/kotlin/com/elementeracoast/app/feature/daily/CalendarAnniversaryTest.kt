package com.elementeracoast.app.feature.daily

import java.time.LocalDate
import org.junit.Assert.*
import org.junit.Test

class CalendarAnniversaryTest {
    private fun date(value: String) = LocalDate.parse(value)

    @Test fun startDayIsDayOneAndMilestoneUsesCivilDays() {
        val elapsed = CalendarAnniversary(date("2026-11-24"), "elapsed")
        assertEquals(1L, elapsed.status(date("2026-11-24")).days)
        assertEquals(2L, elapsed.status(date("2026-11-25")).days)
        assertEquals("upcoming", elapsed.status(date("2026-11-23")).phase)
        val milestone = CalendarAnniversary(date("2026-11-24"), "milestone", 100)
        assertEquals(date("2027-03-03"), milestone.calendarDay)
        assertEquals("today", milestone.status(date("2027-03-03")).phase)
        assertEquals("past", milestone.status(date("2027-03-04")).phase)
    }

    @Test fun leapDayDoesNotMoveToFebruary28() {
        val yearly = CalendarAnniversary(date("2024-02-29"), "yearly")
        assertEquals(date("2028-02-29"), yearly.status(date("2025-02-28")).day)
        assertEquals("today", yearly.status(date("2024-02-29")).phase)
        assertEquals("no_future_occurrence", CalendarAnniversary(date("2196-02-29"), "yearly").status(date("2196-03-01")).phase)
    }

    @Test fun invalidTargetsAreRejected() {
        assertTrue(runCatching { CalendarAnniversary(date("2026-11-24"), "milestone", 0) }.isFailure)
        assertTrue(runCatching { CalendarAnniversary(date("2200-12-31"), "milestone", 2) }.isFailure)
        assertTrue(runCatching { CalendarAnniversary(date("2026-11-24"), "elapsed", 3) }.isFailure)
    }
}
