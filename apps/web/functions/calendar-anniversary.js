// Gregorian civil dates, independent of wall-clock time and timezone.
// The caller supplies today's local YYYY-MM-DD; no device clock is read here.
const DAY_MS = 86400000;
export const ANNIVERSARY_MODES = Object.freeze(['elapsed', 'milestone', 'yearly']);

function parseDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError('invalid_day');
  const year = Number(value.slice(0, 4));
  const time = Date.parse(value + 'T00:00:00Z');
  if (year < 1900 || year > 2200 || !Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) {
    throw new RangeError('invalid_day');
  }
  return time;
}

function formatDay(time) {
  const value = new Date(time).toISOString().slice(0, 10);
  parseDay(value);
  return value;
}

export function anniversaryCalendarDay({ startDay, mode, targetDays = null }) {
  const start = parseDay(startDay);
  if (!ANNIVERSARY_MODES.includes(mode)) throw new RangeError('invalid_anniversary_mode');
  if (mode !== 'milestone') {
    if (targetDays !== null) throw new RangeError('unexpected_target_days');
    return startDay;
  }
  if (!Number.isSafeInteger(targetDays) || targetDays < 1 || targetDays > 109938) {
    throw new RangeError('invalid_target_days');
  }
  return formatDay(start + (targetDays - 1) * DAY_MS);
}

export function anniversaryStatus(record, today) {
  const now = parseDay(today);
  const calendarDay = anniversaryCalendarDay(record);
  const start = parseDay(record.startDay);
  if (record.mode === 'elapsed') {
    const difference = (now - start) / DAY_MS;
    return difference < 0
      ? { phase: 'upcoming', days: -difference, day: calendarDay }
      : { phase: 'elapsed', days: difference + 1, day: calendarDay };
  }
  let occurrence = calendarDay;
  if (record.mode === 'yearly') {
    const firstYear = Math.max(Number(record.startDay.slice(0, 4)), Number(today.slice(0, 4)));
    occurrence = null;
    for (let year = firstYear; year <= 2200; year++) {
      const candidate = String(year) + record.startDay.slice(4);
      try {
        if (parseDay(candidate) >= now) { occurrence = candidate; break; }
      } catch (error) {
        if (!(error instanceof RangeError)) throw error;
        // February 29 remains February 29, as in the existing calendar.
      }
    }
    if (occurrence === null) return { phase: 'no_future_occurrence', days: null, day: null };
  }
  const difference = (parseDay(occurrence) - now) / DAY_MS;
  return { phase: difference > 0 ? 'upcoming' : difference < 0 ? 'past' : 'today', days: Math.abs(difference), day: occurrence };
}
