
BEGIN;

-- This is a clean rebuild of disposable development/test data.
-- Do not execute until the backend is updated to use this schema.

DROP TABLE IF EXISTS scheduled_interview_interviewers CASCADE;
DROP TABLE IF EXISTS scheduled_interviews CASCADE;
DROP TABLE IF EXISTS interview_tasks CASCADE;
DROP TABLE IF EXISTS room_availability CASCADE;
DROP TABLE IF EXISTS rooms CASCADE;
DROP TABLE IF EXISTS interviewer_availability CASCADE;
DROP TABLE IF EXISTS candidate_availability CASCADE;
DROP TABLE IF EXISTS event_interviewers CASCADE;
DROP TABLE IF EXISTS event_candidates CASCADE;
DROP TABLE IF EXISTS interviewer_skills CASCADE;
DROP TABLE IF EXISTS event_time_slots CASCADE;
DROP TABLE IF EXISTS candidates CASCADE;
DROP TABLE IF EXISTS interviewers CASCADE;
DROP TABLE IF EXISTS recruitment_events CASCADE;

-- 1. Recruitment events
CREATE TABLE recruitment_events (
    event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_name TEXT NOT NULL
        CHECK (length(trim(event_name)) > 0),
    event_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'published', 'completed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Event time slots
CREATE TABLE event_time_slots (
    event_id UUID NOT NULL
        REFERENCES recruitment_events(event_id) ON DELETE CASCADE,
    slot_time TIME NOT NULL,
    PRIMARY KEY (event_id, slot_time)
);

-- 3. Persistent candidate profiles
CREATE TABLE candidates (
    candidate_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name TEXT NOT NULL
        CHECK (length(trim(full_name)) > 0),
    email TEXT UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Persistent interviewer profiles
CREATE TABLE interviewers (
    interviewer_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name TEXT NOT NULL
        CHECK (length(trim(full_name)) > 0),
    email TEXT UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. Event participation for candidates
CREATE TABLE event_candidates (
    event_id UUID NOT NULL
        REFERENCES recruitment_events(event_id) ON DELETE CASCADE,
    candidate_id UUID NOT NULL
        REFERENCES candidates(candidate_id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (event_id, candidate_id)
);

-- 6. Event participation and workload limits for interviewers
CREATE TABLE event_interviewers (
    event_id UUID NOT NULL
        REFERENCES recruitment_events(event_id) ON DELETE CASCADE,
    interviewer_id UUID NOT NULL
        REFERENCES interviewers(interviewer_id) ON DELETE CASCADE,
    max_interviews_per_day INTEGER NOT NULL DEFAULT 2
        CHECK (max_interviews_per_day >= 1),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (event_id, interviewer_id)
);

-- 7. Interviewer skills belong to the persistent profile
CREATE TABLE interviewer_skills (
    interviewer_id UUID NOT NULL
        REFERENCES interviewers(interviewer_id) ON DELETE CASCADE,
    skill TEXT NOT NULL
        CHECK (length(trim(skill)) > 0),
    PRIMARY KEY (interviewer_id, skill)
);

-- 8. Candidate availability is event-specific
CREATE TABLE candidate_availability (
    event_id UUID NOT NULL,
    candidate_id UUID NOT NULL,
    slot_time TIME NOT NULL,
    PRIMARY KEY (event_id, candidate_id, slot_time),
    FOREIGN KEY (event_id, candidate_id)
        REFERENCES event_candidates(event_id, candidate_id)
        ON DELETE CASCADE,
    FOREIGN KEY (event_id, slot_time)
        REFERENCES event_time_slots(event_id, slot_time)
        ON DELETE CASCADE
);

-- 9. Interviewer availability is event-specific
CREATE TABLE interviewer_availability (
    event_id UUID NOT NULL,
    interviewer_id UUID NOT NULL,
    slot_time TIME NOT NULL,
    PRIMARY KEY (event_id, interviewer_id, slot_time),
    FOREIGN KEY (event_id, interviewer_id)
        REFERENCES event_interviewers(event_id, interviewer_id)
        ON DELETE CASCADE,
    FOREIGN KEY (event_id, slot_time)
        REFERENCES event_time_slots(event_id, slot_time)
        ON DELETE CASCADE
);

-- 10. Rooms belong to a recruitment event
CREATE TABLE rooms (
    room_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL
        REFERENCES recruitment_events(event_id) ON DELETE CASCADE,
    room_name TEXT NOT NULL
        CHECK (length(trim(room_name)) > 0),
    UNIQUE (event_id, room_id),
    UNIQUE (event_id, room_name)
);

-- 11. Room availability
CREATE TABLE room_availability (
    event_id UUID NOT NULL,
    room_id UUID NOT NULL,
    slot_time TIME NOT NULL,
    PRIMARY KEY (event_id, room_id, slot_time),
    FOREIGN KEY (event_id, room_id)
        REFERENCES rooms(event_id, room_id) ON DELETE CASCADE,
    FOREIGN KEY (event_id, slot_time)
        REFERENCES event_time_slots(event_id, slot_time)
        ON DELETE CASCADE
);

-- 12. Interview tasks
CREATE TABLE interview_tasks (
    task_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL
        REFERENCES recruitment_events(event_id) ON DELETE CASCADE,
    candidate_id UUID NOT NULL,
    round_name TEXT NOT NULL
        CHECK (length(trim(round_name)) > 0),
    duration_slots INTEGER NOT NULL DEFAULT 1
        CHECK (duration_slots >= 1),
    required_skills TEXT[] NOT NULL DEFAULT '{}',
    UNIQUE (event_id, task_id),
    FOREIGN KEY (event_id, candidate_id)
        REFERENCES event_candidates(event_id, candidate_id)
        ON DELETE CASCADE
);

-- 13. Scheduled interviews
-- Interviewer assignments are stored separately so that panels
-- can contain multiple interviewers for one interview.
CREATE TABLE scheduled_interviews (
    schedule_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id UUID NOT NULL
        REFERENCES recruitment_events(event_id) ON DELETE CASCADE,
    task_id UUID NOT NULL,
    room_id UUID NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'published', 'booked', 'cancelled')),
    CHECK (end_time > start_time),
    UNIQUE (event_id, schedule_id),
    UNIQUE (event_id, task_id),
    FOREIGN KEY (event_id, task_id)
        REFERENCES interview_tasks(event_id, task_id)
        ON DELETE CASCADE,
    FOREIGN KEY (event_id, room_id)
        REFERENCES rooms(event_id, room_id)
        ON DELETE RESTRICT
);

-- 14. One or more interviewer assignments per interview
CREATE TABLE scheduled_interview_interviewers (
    event_id UUID NOT NULL,
    schedule_id BIGINT NOT NULL,
    interviewer_id UUID NOT NULL,
    PRIMARY KEY (event_id, schedule_id, interviewer_id),
    FOREIGN KEY (event_id, schedule_id)
        REFERENCES scheduled_interviews(event_id, schedule_id)
        ON DELETE CASCADE,
    FOREIGN KEY (event_id, interviewer_id)
        REFERENCES event_interviewers(event_id, interviewer_id)
        ON DELETE RESTRICT
);

-- Query-supporting indexes
CREATE INDEX idx_event_candidates_candidate
    ON event_candidates(candidate_id);

CREATE INDEX idx_event_interviewers_interviewer
    ON event_interviewers(interviewer_id);

CREATE INDEX idx_candidate_availability_slot
    ON candidate_availability(candidate_id, slot_time);

CREATE INDEX idx_interviewer_availability_slot
    ON interviewer_availability(interviewer_id, slot_time);

CREATE INDEX idx_room_availability_slot
    ON room_availability(room_id, slot_time);

CREATE INDEX idx_interview_tasks_event
    ON interview_tasks(event_id);

CREATE INDEX idx_scheduled_interviews_event_start
    ON scheduled_interviews(event_id, start_time);

CREATE INDEX idx_scheduled_interviewers_interviewer
    ON scheduled_interview_interviewers(interviewer_id);

COMMIT;
