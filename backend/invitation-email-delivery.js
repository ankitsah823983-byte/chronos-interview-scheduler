const pool = require("./db");
const { sendEmail } = require("./email-service");
const { decryptInvitationToken } = require("./invitation-token-crypto");

const MAX_ATTEMPTS = Math.max(1, Number(process.env.EMAIL_DELIVERY_MAX_ATTEMPTS) || 5);
const STALE_SENDING_MS = Math.max(
  60000,
  Number(process.env.EMAIL_DELIVERY_STALE_SENDING_MS) || 15 * 60 * 1000
);
const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000;

function backoffMilliseconds(attempts) {
  return Math.min(60_000 * (2 ** Math.max(0, Math.min(Number(attempts) - 1, 16))), MAX_BACKOFF_MS);
}

function deliveryOutcomeMayBeUnknown(error) {
  const command = String(error?.command || "").toUpperCase();
  return ["DATA", ".", "END"].includes(command);
}


async function deliverInvitationEmail(invitationId) {
  const claim = await pool.query(
    `UPDATE account_invitations
     SET email_delivery_status = 'sending',
         email_delivery_attempts = email_delivery_attempts + 1,
         email_sending_started_at = now(),
         email_last_error = NULL
     WHERE invitation_id = $1
       AND token_ciphertext IS NOT NULL
       AND email_delivery_status IN ('pending', 'failed')
       AND email_next_attempt_at <= now()
       AND email_delivery_attempts < $2
       AND redeemed_at IS NULL
       AND revoked_at IS NULL
       AND expires_at > now()
     RETURNING invitation_id AS "invitationId", email, role,
               candidate_id AS "candidateId",
               interviewer_id AS "interviewerId",
               token_ciphertext AS "tokenCiphertext",
               email_delivery_attempts AS attempts`,
    [invitationId, MAX_ATTEMPTS]
  );

  if (!claim.rowCount) {
    return {
      sent: false,
      reason: "Invitation is not eligible for delivery",
    };
  }

  const invitation = claim.rows[0];
  let smtpAccepted = false;

  try {
    const token = decryptInvitationToken(invitation.tokenCiphertext);
    const frontendUrl =
      process.env.FRONTEND_URL || "http://localhost:5173";
    const invitationUrl = new URL(frontendUrl);
    invitationUrl.searchParams.set("invite", token);

    let profileName = "there";

    if (invitation.role === "candidate" && invitation.candidateId) {
      const result = await pool.query(
        "SELECT full_name AS name FROM candidates WHERE candidate_id = $1",
        [invitation.candidateId]
      );

      if (result.rowCount) {
        profileName = result.rows[0].name;
      }
    } else if (
      invitation.role === "interviewer" &&
      invitation.interviewerId
    ) {
      const result = await pool.query(
        "SELECT full_name AS name FROM interviewers WHERE interviewer_id = $1",
        [invitation.interviewerId]
      );

      if (result.rowCount) {
        profileName = result.rows[0].name;
      }
    }

    const result = await sendEmail({
      to: invitation.email,
      subject: "You're invited to Chronos Interview Scheduler",
      text: [
        `Hello ${profileName},`,
        "",
        `You have been invited to join Chronos Interview Scheduler as a ${invitation.role}.`,
        "",
        "Open the link below to set up your account:",
        invitationUrl.toString(),
        "",
        "This invitation expires in 24 hours and can only be used once.",
        "",
        "If you weren't expecting this invitation, you can ignore this email.",
        "",
        "Chronos Interview Scheduler",
      ].join("\n"),
    });

    if (result?.skipped) {
      await pool.query(
        `UPDATE account_invitations
         SET email_delivery_status = 'skipped',
             email_last_error = left($2, 1000),
             email_sending_started_at = NULL
         WHERE invitation_id = $1
           AND email_delivery_status = 'sending'`,
        [
          invitationId,
          `Email skipped by email-service (${
            result.reason || "reserved test recipient"
          })`,
        ]
      );

      return { sent: false, skipped: true };
    }

    smtpAccepted = true;

    await pool.query(
      `UPDATE account_invitations
       SET email_delivery_status = 'sent',
           email_sent_at = now(),
           email_last_error = NULL,
           email_sending_started_at = NULL
       WHERE invitation_id = $1
         AND email_delivery_status = 'sending'`,
      [invitationId]
    );

    return { sent: true };
  } catch (error) {
    const uncertain =
      smtpAccepted || deliveryOutcomeMayBeUnknown(error);
    const delayMs = backoffMilliseconds(invitation.attempts);
    const exhausted = invitation.attempts >= MAX_ATTEMPTS;

    await pool.query(
      `UPDATE account_invitations
       SET email_delivery_status = $2,
           email_last_error = left($3, 1000),
           email_next_attempt_at = CASE
             WHEN $2 = 'failed' AND $4 = false
               THEN now() + ($5::double precision * interval '1 millisecond')
             ELSE email_next_attempt_at
           END,
           email_sending_started_at = NULL
       WHERE invitation_id = $1
         AND email_delivery_status = 'sending'`,
      [
        invitationId,
        uncertain ? "uncertain" : "failed",
        error.message || "Invitation email delivery failed",
        exhausted,
        delayMs,
      ]
    );

    if (!uncertain && exhausted) {
      await pool.query(
        `UPDATE account_invitations
         SET email_last_error = left(
           COALESCE(email_last_error, '') || ' (retry limit reached)',
           1000
         )
         WHERE invitation_id = $1
           AND email_delivery_status = 'failed'`,
        [invitationId]
      );
    }

    throw error;
  }
}


async function markStaleInvitationSendsUncertain() {
  const result = await pool.query(
    `UPDATE account_invitations
     SET email_delivery_status = 'uncertain',
         email_last_error = COALESCE(email_last_error,
           'Delivery outcome unknown after worker interruption; manual reconciliation required'),
         email_sending_started_at = NULL
     WHERE email_delivery_status = 'sending'
       AND COALESCE(email_sending_started_at, created_at) < now() - ($1 * interval '1 millisecond')`,
    [STALE_SENDING_MS]
  );
  if (result.rowCount) console.warn(`Marked ${result.rowCount} stale invitation email(s) uncertain; none were resent.`);
}

async function processPendingInvitationEmails() {
  await markStaleInvitationSendsUncertain();
  const result = await pool.query(
    `SELECT invitation_id AS "invitationId"
     FROM account_invitations
     WHERE token_ciphertext IS NOT NULL
       AND email_delivery_status IN ('pending', 'failed')
       AND email_next_attempt_at <= now()
       AND email_delivery_attempts < $1
       AND redeemed_at IS NULL AND revoked_at IS NULL AND expires_at > now()
     ORDER BY created_at
     LIMIT 25`,
    [MAX_ATTEMPTS]
  );
  for (const row of result.rows) {
    try {
      await deliverInvitationEmail(row.invitationId);
    } catch (error) {
      console.error("Invitation email delivery attempt failed:", error.message);
    }
  }
}

module.exports = { deliverInvitationEmail, processPendingInvitationEmails, markStaleInvitationSendsUncertain };
