BEGIN;

-- Track explicit availability submissions, including submissions
-- where the interviewer intentionally selects zero slots.
CREATE TABLE interviewer_availability_submissions (
    event_id UUID NOT NULL
        REFERENCES recruitment_events(event_id)
        ON DELETE CASCADE,

    interviewer_id UUID NOT NULL
        REFERENCES interviewers(interviewer_id)
        ON DELETE CASCADE,

    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (event_id, interviewer_id)
);

-- Store the actual slots selected by the interviewer.
-- Deliberately do not reference event_time_slots here:
-- draft regeneration recreates event slots, but submitted
-- selections must survive that process.
CREATE TABLE interviewer_availability_submission_slots (
    event_id UUID NOT NULL,
    interviewer_id UUID NOT NULL,
    slot_time TIME NOT NULL,

    PRIMARY KEY (event_id, interviewer_id, slot_time),

    FOREIGN KEY (event_id, interviewer_id)
        REFERENCES interviewer_availability_submissions
            (event_id, interviewer_id)
        ON DELETE CASCADE
);

COMMIT;