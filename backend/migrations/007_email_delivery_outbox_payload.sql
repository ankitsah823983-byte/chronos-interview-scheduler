
BEGIN;

ALTER TABLE email_delivery_jobs
  ADD COLUMN IF NOT EXISTS subject TEXT,
  ADD COLUMN IF NOT EXISTS text_body TEXT,
  ADD COLUMN IF NOT EXISTS html_body TEXT,
  ADD COLUMN IF NOT EXISTS sending_started_at TIMESTAMPTZ;

ALTER TABLE email_delivery_jobs
  DROP CONSTRAINT IF EXISTS email_delivery_jobs_status_check;

ALTER TABLE email_delivery_jobs
  ADD CONSTRAINT email_delivery_jobs_status_check
  CHECK (
    status IN ('pending', 'sending', 'sent', 'failed', 'uncertain')
  );

COMMIT;
