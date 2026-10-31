
BEGIN;

-- Store the encrypted token separately from its hash.
-- Existing invitations will have NULL ciphertext; their original
-- raw tokens cannot be recovered from token_hash.
ALTER TABLE account_invitations
  ADD COLUMN IF NOT EXISTS token_ciphertext TEXT,
  ADD COLUMN IF NOT EXISTS email_delivery_status TEXT
    NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS email_delivery_attempts INTEGER
    NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS email_last_error TEXT,
  ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_sending_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_next_attempt_at TIMESTAMPTZ
    NOT NULL DEFAULT now();

-- Make the migration safe to rerun without duplicating constraints.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'account_invitations_email_delivery_status_check'
      AND conrelid = 'public.account_invitations'::regclass
  ) THEN
    ALTER TABLE account_invitations
      ADD CONSTRAINT account_invitations_email_delivery_status_check
      CHECK (
        email_delivery_status IN (
          'pending',
          'sending',
          'sent',
          'failed',
          'uncertain',
          'skipped'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'account_invitations_email_delivery_attempts_check'
      AND conrelid = 'public.account_invitations'::regclass
  ) THEN
    ALTER TABLE account_invitations
      ADD CONSTRAINT account_invitations_email_delivery_attempts_check
      CHECK (email_delivery_attempts >= 0);
  END IF;
END $$;

COMMIT;
