BEGIN;

CREATE TABLE IF NOT EXISTS user_accounts (
    user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    full_name TEXT NOT NULL
        CHECK (length(trim(full_name)) > 0),

    email TEXT NOT NULL
        CHECK (length(trim(email)) > 0),

    password_hash TEXT NOT NULL
        CHECK (length(trim(password_hash)) > 0),

    role TEXT NOT NULL
        CHECK (role IN ('candidate', 'interviewer', 'coordinator')),

    candidate_id UUID
        REFERENCES candidates(candidate_id)
        ON DELETE RESTRICT,

    interviewer_id UUID
        REFERENCES interviewers(interviewer_id)
        ON DELETE RESTRICT,

    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT user_accounts_candidate_unique
        UNIQUE (candidate_id),

    CONSTRAINT user_accounts_interviewer_unique
        UNIQUE (interviewer_id),

    CONSTRAINT user_accounts_role_profile_check
        CHECK (
            (
                role = 'candidate'
                AND candidate_id IS NOT NULL
                AND interviewer_id IS NULL
            )
            OR
            (
                role = 'interviewer'
                AND candidate_id IS NULL
                AND interviewer_id IS NOT NULL
            )
            OR
            (
                role = 'coordinator'
                AND candidate_id IS NULL
                AND interviewer_id IS NULL
            )
        )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_accounts_normalized_email
    ON user_accounts (lower(trim(email)));

CREATE INDEX IF NOT EXISTS idx_user_accounts_role_active
    ON user_accounts (role, is_active);

COMMIT;