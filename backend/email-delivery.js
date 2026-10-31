
const pool = require("./db");
const { sendEmail } = require("./email-service");
const { processPendingInvitationEmails } = require("./invitation-email-delivery");

const MAX_ATTEMPTS = Math.max(
  1,
  Number(process.env.EMAIL_DELIVERY_MAX_ATTEMPTS) || 5
);

const POLL_INTERVAL_MS = Math.max(
  5000,
  Number(process.env.EMAIL_DELIVERY_POLL_INTERVAL_MS) || 30000
);

const STALE_SENDING_MS = Math.max(
  60000,
  Number(process.env.EMAIL_DELIVERY_STALE_SENDING_MS) || 15 * 60 * 1000
);

const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000;

let workerTimer = null;
let workerRunning = false;
let activeCycle = Promise.resolve();
let stopping = false;

function backoffMilliseconds(attempts) {
  const exponent = Math.max(0, Math.min(Number(attempts) - 1, 16));

  return Math.min(60_000 * (2 ** exponent), MAX_BACKOFF_MS);
}

async function createDeliveryJob({
  userId = null,
  eventId = null,
  recipientEmail,
  deliveryType,
  dedupeKey,
  subject,
  textBody,
  htmlBody = null,
}) {
  // Account invitations must not be persisted here because their raw
  // activation tokens should not be stored in the retry outbox.
  if (deliveryType !== "event_assignment") {
    throw new Error(
      "Only event-assignment emails may be persisted in the retry outbox."
    );
  }

  if (!recipientEmail || !subject || !textBody) {
    throw new Error(
      "Recipient, subject, and text body are required for an email delivery job."
    );
  }

  if (!dedupeKey) {
    throw new Error("A deduplication key is required.");
  }

  const result = await pool.query(
    `INSERT INTO email_delivery_jobs
       (user_id, event_id, recipient_email, delivery_type, dedupe_key,
        subject, text_body, html_body)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (dedupe_key) DO NOTHING
     RETURNING delivery_id AS "deliveryId", status`,
    [
      userId,
      eventId,
      recipientEmail,
      deliveryType,
      dedupeKey,
      subject,
      textBody,
      htmlBody,
    ]
  );

  if (result.rowCount > 0) {
    return result.rows[0];
  }

  const existing = await pool.query(
    `SELECT delivery_id AS "deliveryId", status
     FROM email_delivery_jobs
     WHERE dedupe_key = $1`,
    [dedupeKey]
  );

  return existing.rows[0] || null;
}

async function deliverEmail(deliveryId, email = null) {
  // Atomic claim: concurrent workers cannot claim the same eligible job.
  const claim = await pool.query(
    `UPDATE email_delivery_jobs
     SET status = 'sending',
         attempts = attempts + 1,
         sending_started_at = now(),
         updated_at = now()
     WHERE delivery_id = $1
       AND delivery_type = 'event_assignment'
       AND status IN ('pending', 'failed')
       AND attempts < $2
       AND next_attempt_at <= now()
     RETURNING delivery_id AS "deliveryId",
               recipient_email AS "recipientEmail",
               subject,
               text_body AS "textBody",
               html_body AS "htmlBody",
               attempts`,
    [deliveryId, MAX_ATTEMPTS]
  );

  if (claim.rowCount === 0) {
    return {
      sent: false,
      reason: "Job is not eligible for delivery",
    };
  }

  const job = claim.rows[0];

  const message = email || {
    to: job.recipientEmail,
    subject: job.subject,
    text: job.textBody,
    ...(job.htmlBody ? { html: job.htmlBody } : {}),
  };

  if (!message.to || !message.subject || !message.text) {
    await pool.query(
      `UPDATE email_delivery_jobs
       SET status = 'failed',
           last_error = 'Missing email payload',
           next_attempt_at = now() + interval '6 hours',
           sending_started_at = NULL,
           updated_at = now()
       WHERE delivery_id = $1
         AND status = 'sending'`,
      [deliveryId]
    );

    return {
      sent: false,
      reason: "Missing email payload",
    };
  }

  let result;

  try {
    result = await sendEmail(message);
  } catch (error) {
    // SMTP may accept a message before the client receives an acknowledgement.
    // Avoid blindly retrying when the outcome may be ambiguous.
    const smtpCommand = String(error.command || "").toUpperCase();

    const outcomeMayBeUnknown = [
      "DATA",
      ".",
      "END",
    ].includes(smtpCommand);

    if (outcomeMayBeUnknown) {
      await pool.query(
        `UPDATE email_delivery_jobs
         SET status = 'uncertain',
             last_error = left($2, 1000),
             sending_started_at = NULL,
             updated_at = now()
         WHERE delivery_id = $1
           AND status = 'sending'`,
        [
          deliveryId,
          error.message || "SMTP delivery outcome is unknown",
        ]
      );

      throw error;
    }

    const delayMs = backoffMilliseconds(job.attempts);
    const exhausted = job.attempts >= MAX_ATTEMPTS;

    await pool.query(
      `UPDATE email_delivery_jobs
       SET status = 'failed',
           last_error = left($2, 1000),
           next_attempt_at = CASE
             WHEN $3 THEN now() + interval '100 years'
             ELSE now() + (
               $4::double precision * interval '1 millisecond'
             )
           END,
           sending_started_at = NULL,
           updated_at = now()
       WHERE delivery_id = $1
         AND status = 'sending'`,
      [
        deliveryId,
        error.message || "Email delivery failed",
        exhausted,
        delayMs,
      ]
    );

    throw error;
  }

  if (result?.skipped) {
    await pool.query(
      `UPDATE email_delivery_jobs
       SET status = 'failed',
           attempts = $2,
           last_error = 'Email skipped by email-service (reserved test recipient)',
           next_attempt_at = now() + interval '100 years',
           sending_started_at = NULL,
           updated_at = now()
       WHERE delivery_id = $1
         AND status = 'sending'`,
      [deliveryId, MAX_ATTEMPTS]
    );

    return {
      sent: false,
      skipped: true,
    };
  }

  // If SMTP succeeds but this database update fails, the row remains
  // "sending". The stale-job handler will mark it "uncertain", not resend it.
  await pool.query(
    `UPDATE email_delivery_jobs
     SET status = 'sent',
         sent_at = now(),
         last_error = NULL,
         sending_started_at = NULL,
         updated_at = now()
     WHERE delivery_id = $1
       AND status = 'sending'`,
    [deliveryId]
  );

  return { sent: true };
}

async function markStaleSendingJobsUncertain() {
  const result = await pool.query(
    `UPDATE email_delivery_jobs
     SET status = 'uncertain',
         last_error = COALESCE(
           last_error,
           'Delivery outcome unknown after worker interruption; manual reconciliation required'
         ),
         updated_at = now()
     WHERE status = 'sending'
       AND COALESCE(sending_started_at, updated_at)
           < now() - ($1 * interval '1 millisecond')`,
    [STALE_SENDING_MS]
  );

  if (result.rowCount > 0) {
    console.warn(
      `Marked ${result.rowCount} stale email job(s) uncertain; none were resent.`
    );
  }
}

async function processDeliveryCycle() {
  if (workerRunning || stopping) {
    return;
  }

  workerRunning = true;

  activeCycle = (async () => {
    try {
      await markStaleSendingJobsUncertain();
      await processPendingInvitationEmails();

      const result = await pool.query(
        `SELECT delivery_id AS "deliveryId"
         FROM email_delivery_jobs
         WHERE status IN ('pending', 'failed')
           AND delivery_type = 'event_assignment'
           AND attempts < $1
           AND next_attempt_at <= now()
           AND subject IS NOT NULL
           AND text_body IS NOT NULL
         ORDER BY next_attempt_at, created_at
         LIMIT 25`,
        [MAX_ATTEMPTS]
      );

      for (const row of result.rows) {
        if (stopping) {
          break;
        }

        try {
          await deliverEmail(row.deliveryId);
        } catch (error) {
          console.error(
            "Email delivery attempt failed:",
            error.message
          );
        }
      }
    } catch (error) {
      console.error(
        "Email delivery worker cycle failed:",
        error.message
      );
    } finally {
      workerRunning = false;
    }
  })();

  await activeCycle;
}

function startEmailDeliveryWorker() {
  if (workerTimer) {
    return;
  }

  stopping = false;

  // Opt-in safeguard: queued jobs are not processed automatically unless
  // the environment variable is explicitly enabled.
  if (process.env.EMAIL_DELIVERY_WORKER_ENABLED !== "true") {
    console.log(
      "Email delivery worker disabled; queued jobs will not be processed automatically."
    );
    return;
  }

  void processDeliveryCycle();

  workerTimer = setInterval(
    () => void processDeliveryCycle(),
    POLL_INTERVAL_MS
  );

  if (typeof workerTimer.unref === "function") {
    workerTimer.unref();
  }

  console.log("Email delivery worker enabled.");
}

async function stopEmailDeliveryWorker() {
  stopping = true;

  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }

  await activeCycle;
}

module.exports = {
  createDeliveryJob,
  deliverEmail,
  startEmailDeliveryWorker,
  stopEmailDeliveryWorker,
};
