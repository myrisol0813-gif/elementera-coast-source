package com.elementeracoast.app.feature.daily

import java.time.LocalDate
import java.time.temporal.ChronoUnit

/** Civil calendar dates; no timezone or wall-clock arithmetic in the domain. */
internal data class CalendarAnniversary(
    val startDay: LocalDate,
    val mode: String,
    val targetDays: Int? = null,
    val pinned: Boolean = false,
) {
    init {
        require(startDay.year in 1900..2200 && mode in setOf("elapsed", "milestone", "yearly"))
        require(if (mode == "milestone") targetDays != null && targetDays in 1..109938 else targetDays == null)
        require(calendarDay.year in 1900..2200)
    }
    val calendarDay: LocalDate
        get() = if (mode == "milestone") startDay.plusDays(requireNotNull(targetDays).toLong() - 1L) else startDay
    val recurrence: String get() = if (mode == "yearly") "yearly" else "none"

    fun status(today: LocalDate): CalendarAnniversaryStatus {
        require(today.year in 1900..2200)
        if (mode == "elapsed") {
            val days = ChronoUnit.DAYS.between(startDay, today)
            return CalendarAnniversaryStatus(if (days < 0) "upcoming" else "elapsed",
                if (days < 0) -days else days + 1, startDay)
        }
        val day = if (mode == "yearly") {
            (maxOf(today.year, startDay.year)..2200).asSequence().mapNotNull { year ->
                runCatching { LocalDate.of(year, startDay.monthValue, startDay.dayOfMonth) }.getOrNull()
            }.firstOrNull { !it.isBefore(today) }
        } else calendarDay
        if (day == null) return CalendarAnniversaryStatus("no_future_occurrence", null, null)
        val days = ChronoUnit.DAYS.between(today, day)
        return CalendarAnniversaryStatus(if (days > 0) "upcoming" else if (days < 0) "past" else "today",
            kotlin.math.abs(days), day)
    }
}

internal data class CalendarAnniversaryStatus(val phase: String, val days: Long?, val day: LocalDate?)
