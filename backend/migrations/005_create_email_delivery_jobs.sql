CREATE TABLE IF NOT EXISTS email_delivery_jobs (
    delivery_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES user_accounts(user_id) ON DELETE CASCADE,
    event_id UUID REFERENCES recruitment_events(event_id) ON DELETE CASCADE,
    recipient_email TEXT NOT NULL,
    delivery_type TEXT NOT NULL
        CHECK (delivery_type IN ('event_assignment', 'account_invitation')),
    dedupe_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'sent', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    last_error TEXT,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_delivery_jobs_pending
    ON email_delivery_jobs (next_attempt_at, created_at)
    WHERE status IN ('pending', 'failed');
