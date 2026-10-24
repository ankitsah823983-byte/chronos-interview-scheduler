
const express = require("express");
const { randomBytes, createHash } = require("node:crypto");
const pool = require("./db");

const router = express.Router();

const INVITATION_LIFETIME_HOURS = 24;

function isValidUuid(value) {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value
    )
  );
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

// POST /api/invitations
// The server mounts this router behind coordinator authorization.
router.post("/", async (req, res) => {
  const { role, candidateId, interviewerId } = req.body || {};

  if (!["candidate", "interviewer"].includes(role)) {
    return res.status(400).json({
      success: false,
      error: "Invitation role must be candidate or interviewer.",
    });
  }

  if (role === "candidate") {
    if (!isValidUuid(candidateId) || interviewerId !== undefined) {
      return res.status(400).json({
        success: false,
        error: "Provide exactly one valid candidate ID.",
      });
    }
  }

  if (role === "interviewer") {
    if (!isValidUuid(interviewerId) || candidateId !== undefined) {
      return res.status(400).json({
        success: false,
        error: "Provide exactly one valid interviewer ID.",
      });
    }
  }

  if (!req.user?.userId) {
    return res.status(401).json({
      success: false,
      error: "Authentication required.",
    });
  }

  let client;

  try {
    client = await pool.connect();
    await client.query("BEGIN");

    let profile;

    if (role === "candidate") {
      const profileResult = await client.query(
        `SELECT
           candidate_id AS id,
           full_name AS "fullName",
           lower(trim(email)) AS email
         FROM candidates
         WHERE candidate_id = $1
         FOR UPDATE`,
        [candidateId]
      );

      if (profileResult.rowCount === 0) {
        await client.query("ROLLBACK");

        return res.status(404).json({
          success: false,
          error: "Candidate profile not found.",
        });
      }

      profile = profileResult.rows[0];
    } else {
      const profileResult = await client.query(
        `SELECT
           interviewer_id AS id,
           full_name AS "fullName",
           lower(trim(email)) AS email
         FROM interviewers
         WHERE interviewer_id = $1
         FOR UPDATE`,
        [interviewerId]
      );

      if (profileResult.rowCount === 0) {
        await client.query("ROLLBACK");

        return res.status(404).json({
          success: false,
          error: "Interviewer profile not found.",
        });
      }

      profile = profileResult.rows[0];
    }

    if (
      typeof profile.email !== "string" ||
      profile.email.length === 0 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)
    ) {
      await client.query("ROLLBACK");

      return res.status(409).json({
        success: false,
        error:
          "The selected profile needs a valid email address before an invitation can be issued.",
      });
    }

    // Prevent linking an existing account to a second or incorrect profile.
    const existingAccount = await client.query(
      `SELECT user_id
       FROM user_accounts
       WHERE lower(trim(email)) = $1
          OR ($2::uuid IS NOT NULL AND candidate_id = $2)
          OR ($3::uuid IS NOT NULL AND interviewer_id = $3)
       LIMIT 1`,
      [
        profile.email,
        role === "candidate" ? profile.id : null,
        role === "interviewer" ? profile.id : null,
      ]
    );

    if (existingAccount.rowCount > 0) {
      await client.query("ROLLBACK");

      return res.status(409).json({
        success: false,
        error: "This profile or email already has an account.",
      });
    }

    // Revoke older unused invitations for this exact profile.
    if (role === "candidate") {
      await client.query(
        `UPDATE account_invitations
         SET revoked_at = now()
         WHERE role = 'candidate'
           AND candidate_id = $1
           AND redeemed_at IS NULL
           AND revoked_at IS NULL`,
        [profile.id]
      );
    } else {
      await client.query(
        `UPDATE account_invitations
         SET revoked_at = now()
         WHERE role = 'interviewer'
           AND interviewer_id = $1
           AND redeemed_at IS NULL
           AND revoked_at IS NULL`,
        [profile.id]
      );
    }

    // Return the raw token only once; persist only its SHA-256 hash.
    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashToken(token);

    const expiresAt = new Date(
      Date.now() + INVITATION_LIFETIME_HOURS * 60 * 60 * 1000
    );

    const insertResult = await client.query(
      `INSERT INTO account_invitations
         (
           email,
           role,
           candidate_id,
           interviewer_id,
           token_hash,
           expires_at,
           created_by_user_id
         )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING
         invitation_id AS "invitationId",
         email,
         role,
         expires_at AS "expiresAt"`,
      [
        profile.email,
        role,
        role === "candidate" ? profile.id : null,
        role === "interviewer" ? profile.id : null,
        tokenHash,
        expiresAt,
        req.user.userId,
      ]
    );

    await client.query("COMMIT");

    return res.status(201).json({
      success: true,
      invitation: insertResult.rows[0],
      token,
    });
  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error(
          "Invitation transaction rollback failed:",
          rollbackError.message
        );
      }
    }

    console.error("Invitation creation failed:", error.message);

    return res.status(500).json({
      success: false,
      error: "Could not create the account invitation.",
    });
  } finally {
    if (client) {
      client.release();
    }
  }
});

module.exports = router;
