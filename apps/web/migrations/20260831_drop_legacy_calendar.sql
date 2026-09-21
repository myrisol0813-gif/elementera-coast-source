DROP TABLE IF EXISTS coast_calendar_changes;
DROP TABLE IF EXISTS coast_calendar_notes;
DROP TABLE IF EXISTS coast_calendar_events;
DROP TABLE IF EXISTS coast_calendar_recurring_seeds;

DELETE FROM schema_migrations WHERE id = 'coast-calendar-v1';
