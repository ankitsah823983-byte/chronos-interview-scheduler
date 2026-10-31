
const { randomBytes, createHash } = require("node:crypto");

const pool = require("./db");
const { encryptInvitationToken } = require("./invitation-token-crypto");
const { deliverInvitationEmail } = require("./invitation-email-delivery");
const { deliverEmail } = require("./email-delivery");

const INVITATION_LIFETIME_HOURS = 24;

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

async function notifyEventParticipants(
  eventId,
  eventName,
  eventDate,
  coordinatorUserId
) {
  const result = await pool.query(
    `SELECT DISTINCT
       'candidate' AS role,
       c.candidate_id AS "profileId",
       c.full_name AS "fullName",
       lower(trim(c.email)) AS email
     FROM event_candidates ec
     JOIN candidates c ON c.candidate_id = ec.candidate_id
     WHERE ec.event_id = $1

     UNION

     SELECT DISTINCT
       'interviewer' AS role,
       i.interviewer_id AS "profileId",
       i.full_name AS "fullName",
       lower(trim(i.email)) AS email
     FROM event_interviewers ei
     JOIN interviewers i ON i.interviewer_id = ei.interviewer_id
     WHERE ei.event_id = $1`,
    [eventId]
  );

  const summary = {
    participants: result.rowCount,
    notificationsCreated: 0,
    invitationsCreated: 0,
    skipped: 0,
    errors: 0,
  };

  const frontendUrl =
    process.env.FRONTEND_URL || "http://localhost:5173";

  for (const participant of result.rows) {
    let client;
    let emailTask = null;

    try {
      if (
        !participant.email ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(participant.email)
      ) {
        console.warn(
          "Skipping participant with invalid email:",
          participant.profileId
        );
        summary.skipped++;
        continue;
      }

      client = await pool.connect();
      await client.query("BEGIN");

      // Serialize processing for the same email to prevent duplicate invitations.
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
        [participant.email]
      );

      const profileColumn =
        participant.role === "candidate"
          ? "candidate_id"
          : "interviewer_id";

      const accountResult = await client.query(
        `SELECT
           user_id AS "userId",
           role,
           ${profileColumn} AS "profileId",
           is_active AS "isActive"
         FROM user_accounts
         WHERE lower(trim(email)) = $1
            OR ${profileColumn} = $2
         FOR UPDATE`,
        [participant.email, participant.profileId]
      );

      if (accountResult.rowCount > 0) {
        const account = accountResult.rows[0];

        // Do not silently link an account to a different role or profile.
        const correctlyLinked =
          accountResult.rowCount === 1 &&
          account.role === participant.role &&
          account.profileId === participant.profileId;

        if (!correctlyLinked) {
          console.warn(
            "Account/profile conflict; no notification or invitation sent:",
            participant.email
          );

          await client.query("COMMIT");
          summary.skipped++;
          continue;
        }

        if (!account.isActive) {
          await client.query("COMMIT");
          summary.skipped++;
          continue;
        }

        const title = `You're assigned to ${eventName}`;

        const message =
          `You have been added to "${eventName}"` +
          (eventDate ? ` scheduled for ${eventDate}` : "") +
          ". Sign in to Chronos to review the event and submit any required availability. The schedule is not confirmed yet.";

        const inserted = await client.query(
          `INSERT INTO user_notifications
             (user_id, event_id, notification_type, title, message, dedupe_key)
           VALUES ($1, $2, 'event_assignment', $3, $4, $5)
           ON CONFLICT (user_id, dedupe_key) DO NOTHING
           RETURNING notification_id`,
          [
            account.userId,
            eventId,
            title,
            message,
            `event-assignment:${eventId}:${account.userId}`,
          ]
        );

        const emailDedupeKey =
          `event-assignment-email:${eventId}:${account.userId}`;

        const emailText =
          `Hello ${participant.fullName},\n\n${message}\n\n` +
          `Sign in to Chronos: ${frontendUrl}\n\nChronos Interview Scheduler`;

        // Persist the email job in the same transaction as the notification.
        let deliveryJob = await client.query(
          `INSERT INTO email_delivery_jobs
             (user_id, event_id, recipient_email, delivery_type, dedupe_key,
              subject, text_body)
           VALUES ($1, $2, $3, 'event_assignment', $4, $5, $6)
           ON CONFLICT (dedupe_key) DO UPDATE
             SET subject = COALESCE(
                   email_delivery_jobs.subject,
                   EXCLUDED.subject
                 ),
                 text_body = COALESCE(
                   email_delivery_jobs.text_body,
                   EXCLUDED.text_body
                 ),
                 updated_at = now()
           WHERE email_delivery_jobs.status IN ('pending', 'failed')
           RETURNING delivery_id AS "deliveryId", status`,
          [
            account.userId,
            eventId,
            participant.email,
            emailDedupeKey,
            title,
            emailText,
          ]
        );

        if (deliveryJob.rowCount === 0) {
          deliveryJob = await client.query(
            `SELECT delivery_id AS "deliveryId", status
             FROM email_delivery_jobs
             WHERE dedupe_key = $1`,
            [emailDedupeKey]
          );
        }

        await client.query("COMMIT");

        if (inserted.rowCount > 0) {
          summary.notificationsCreated++;
        } else {
          summary.skipped++;
        }

        const job = deliveryJob.rows[0];

        if (job && ["pending", "failed"].includes(job.status)) {
          emailTask = {
            type: "event_assignment",
            deliveryId: job.deliveryId,
            status: job.status,
          };
        }
      } else {
        // Reuse a valid invitation instead of creating a new token each time.
        const pending = await client.query(
          `SELECT
             invitation_id,
             token_ciphertext,
             email_delivery_status,
             email_next_attempt_at
           FROM account_invitations
           WHERE lower(trim(email)) = $1
             AND role = $2
             AND ${profileColumn} = $3
             AND redeemed_at IS NULL
             AND revoked_at IS NULL
             AND expires_at > now()
           LIMIT 1
           FOR UPDATE`,
          [
            participant.email,
            participant.role,
            participant.profileId,
          ]
        );

        if (pending.rowCount > 0) {
          const existingInvitation = pending.rows[0];

          await client.query("COMMIT");

          if (
            existingInvitation.token_ciphertext &&
            ["pending", "failed"].includes(
              existingInvitation.email_delivery_status
            ) &&
            new Date(existingInvitation.email_next_attempt_at) <= new Date()
          ) {
            emailTask = {
              type: "invitation",
              invitationId: existingInvitation.invitation_id,
            };
          } else {
            summary.skipped++;
          }

          // Legacy invitations without ciphertext cannot be recovered.
          // Invitations in backoff are left for a later retry.
          if (!emailTask) continue;
        } else {
          // Revoke expired or stale invitations for this profile.
          await client.query(
            `UPDATE account_invitations
             SET revoked_at = now()
             WHERE role = $1
               AND ${profileColumn} = $2
               AND redeemed_at IS NULL
               AND revoked_at IS NULL`,
            [participant.role, participant.profileId]
          );

          const token = randomBytes(32).toString("base64url");

          const expiresAt = new Date(
            Date.now() +
              INVITATION_LIFETIME_HOURS * 60 * 60 * 1000
          );

          const invitationInsert = await client.query(
            `INSERT INTO account_invitations
               (email, role, candidate_id, interviewer_id, token_hash,
                token_ciphertext, email_delivery_status, expires_at,
                created_by_user_id)
             VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8)
             RETURNING invitation_id`,
            [
              participant.email,
              participant.role,
              participant.role === "candidate"
                ? participant.profileId
                : null,
              participant.role === "interviewer"
                ? participant.profileId
                : null,
              hashToken(token),
              encryptInvitationToken(token),
              expiresAt,
              coordinatorUserId,
            ]
          );

          await client.query("COMMIT");

          summary.invitationsCreated++;

          emailTask = {
            type: "invitation",
            invitationId: invitationInsert.rows[0].invitation_id,
          };
        }
      }
    } catch (error) {
      if (client) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          console.error(
            "Participant transaction rollback failed:",
            rollbackError.message
          );
        }
      }

      summary.errors++;

      console.error(
        "Participant assignment processing failed:",
        participant.email,
        error.message
      );
    } finally {
      if (client) {
        client.release();
      }
    }

    // Deliver emails only after the database transaction has committed.
    if (emailTask) {
      try {
        if (emailTask.type === "event_assignment") {
          await deliverEmail(emailTask.deliveryId);
        } else if (emailTask.type === "invitation") {
          await deliverInvitationEmail(emailTask.invitationId);
        }
      } catch (error) {
        summary.errors++;

        console.error(
          "Participant email delivery failed:",
          error.message
        );
      }
    }
  }

  return summary;
}

module.exports = { notifyEventParticipants };
