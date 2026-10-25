BEGIN;

-- Drop the selected-slot records first because they reference
-- the submission records.
DROP TABLE IF EXISTS interviewer_availability_submission_slots;

DROP TABLE IF EXISTS interviewer_availability_submissions;

COMMIT;