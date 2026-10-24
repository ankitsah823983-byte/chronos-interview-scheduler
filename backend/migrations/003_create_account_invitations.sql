BEGIN;

CREATE TABLE account_invitations (
    invitation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    email TEXT NOT NULL
        CHECK (email = lower(trim(email)))
        CHECK (length(trim(email)) > 0),

    role TEXT NOT NULL
        CHECK (role IN ('candidate', 'interviewer')),

    candidate_id UUID
        REFERENCES candidates(candidate_id)
        ON DELETE CASCADE,

    interviewer_id UUID
        REFERENCES interviewers(interviewer_id)
        ON DELETE CASCADE,

    token_hash TEXT NOT NULL UNIQUE
        CHECK (length(trim(token_hash)) > 0),

    expires_at TIMESTAMPTZ NOT NULL,

    redeemed_at TIMESTAMPTZ,

    revoked_at TIMESTAMPTZ,

    created_by_user_id UUID NOT NULL
        REFERENCES user_accounts(user_id)
        ON DELETE RESTRICT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT account_invitations_profile_role_check
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
        ),

    CONSTRAINT account_invitations_redemption_check
        CHECK (
            redeemed_at IS NULL
            OR revoked_at IS NULL
        )
);

CREATE INDEX idx_account_invitations_pending_email
    ON account_invitations (email, role)
    WHERE redeemed_at IS NULL
      AND revoked_at IS NULL;

CREATE INDEX idx_account_invitations_expiry
    ON account_invitations (expires_at)
    WHERE redeemed_at IS NULL
      AND revoked_at IS NULL;

COMMIT;