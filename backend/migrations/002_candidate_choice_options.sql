-- Chronos: allow multiple candidate-selectable options per interview task.
-- Apply after 001_rebuild_chronos_schema.sql.
-- This migration is additive: existing schedules remain valid and each existing
-- scheduled_interviews row becomes an option for its task.

BEGIN;

-- A task may now have multiple time/interviewer/room alternatives.
ALTER TABLE scheduled_interviews
    DROP CONSTRAINT IF EXISTS scheduled_interviews_event_id_task_id_key;

-- Keep existing statuses and add a state for options that lost a booking race
-- or conflict with a confirmed booking elsewhere in the event.
ALTER TABLE scheduled_interviews
    DROP CONSTRAINT IF EXISTS scheduled_interviews_status_check;

ALTER TABLE scheduled_interviews
    ADD CONSTRAINT scheduled_interviews_status_check
    CHECK (status IN ('draft', 'published', 'booked', 'unavailable', 'cancelled'));

-- Even though a task can have many alternatives, at most one may be booked.
CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduled_one_booked_option_per_task
    ON scheduled_interviews (event_id, task_id)
    WHERE status = 'booked';

-- Support candidate option lists, coordinator review, and availability checks
-- during an atomic booking transaction.
CREATE INDEX IF NOT EXISTS idx_scheduled_event_task_status
    ON scheduled_interviews (event_id, task_id, status);

CREATE INDEX IF NOT EXISTS idx_scheduled_event_status_start_end
    ON scheduled_interviews (event_id, status, start_time, end_time);

CREATE INDEX IF NOT EXISTS idx_scheduled_event_room_time
    ON scheduled_interviews (event_id, room_id, start_time, end_time);

CREATE INDEX IF NOT EXISTS idx_scheduled_interviewers_event_interviewer
    ON scheduled_interview_interviewers (event_id, interviewer_id, schedule_id);

COMMIT;
