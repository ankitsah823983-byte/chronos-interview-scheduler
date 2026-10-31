BEGIN;

CREATE TABLE IF NOT EXISTS user_notifications (
    notification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL
        REFERENCES user_accounts(user_id)
        ON DELETE CASCADE,

    event_id UUID
        REFERENCES recruitment_events(event_id)
        ON DELETE CASCADE,

    notification_type TEXT NOT NULL
        CHECK (length(trim(notification_type)) > 0),

    title TEXT NOT NULL
        CHECK (length(trim(title)) > 0),

    message TEXT NOT NULL
        CHECK (length(trim(message)) > 0),

    dedupe_key TEXT NOT NULL
        CHECK (length(trim(dedupe_key)) > 0),

    read_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT user_notifications_user_dedupe_unique
        UNIQUE (user_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_user_notifications_inbox
    ON user_notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_notifications_unread
    ON user_notifications (user_id, created_at DESC)
    WHERE read_at IS NULL;

COMMIT;
