ALTER TABLE email_delivery_jobs
DROP CONSTRAINT IF EXISTS email_delivery_jobs_status_check;

ALTER TABLE email_delivery_jobs
ADD CONSTRAINT email_delivery_jobs_status_check
CHECK (status IN ('pending', 'sending', 'sent', 'failed'));
