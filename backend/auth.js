
const express = require("express");
const bcrypt = require("bcryptjs");
const { createHash } = require("node:crypto");
const pool = require("./db");

const router = express.Router();

const MIN_PASSWORD_LENGTH = 12;
const BCRYPT_ROUNDS = 12;

function publicUser(row) {
  return {
    userId: row.userId,
    fullName: row.fullName,
    email: row.email,
    role: row.role,
    candidateId: row.candidateId || null,
    interviewerId: row.interviewerId || null,
  };
}

function isValidEmail(email) {
  return (
    typeof email === "string" &&
    email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  );
}

function isValidPassword(password) {
  return (
    typeof password === "string" &&
    password.length >= MIN_PASSWORD_LENGTH &&
    Buffer.byteLength(password, "utf8") <= 72
  );
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function destroySession(req) {
  return new Promise((resolve, reject) => {
    if (!req.session) {
      resolve();
      return;
    }

    req.session.destroy((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

// Public registration creates candidate accounts only.
// Existing candidate/interviewer profiles must be claimed through invitations.
router.post("/register", async (req, res) => {
  const { fullName, email: suppliedEmail, password, role } =
    req.body || {};

  if (
    typeof fullName !== "string" ||
    fullName.trim().length === 0 ||
    fullName.trim().length > 150 ||
    !isValidEmail(suppliedEmail) ||
    !isValidPassword(password)
  ) {
    return res.status(400).json({
      success: false,
      error:
        "Provide a valid full name, email, and password of 12–72 UTF-8 bytes.",
    });
  }

  if (role !== undefined && role !== "candidate") {
    return res.status(400).json({
      success: false,
      error:
        "Public registration is available for candidate accounts only.",
    });
  }

  const normalizedEmail = suppliedEmail.trim().toLowerCase();
  const normalizedName = fullName.trim();
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  let client;

  try {
    client = await pool.connect();
    await client.query("BEGIN");

    const existingAccount = await client.query(
      `SELECT user_id
       FROM user_accounts
       WHERE lower(trim(email)) = $1
       FOR UPDATE`,
      [normalizedEmail]
    );

    if (existingAccount.rowCount > 0) {
      await client.query("ROLLBACK");

      return res.status(409).json({
        success: false,
        error: "An account with this email already exists.",
      });
    }

    const existingCandidate = await client.query(
      `SELECT candidate_id
       FROM candidates
       WHERE lower(trim(email)) = $1
       LIMIT 1`,
      [normalizedEmail]
    );

    if (existingCandidate.rowCount > 0) {
      await client.query("ROLLBACK");

      return res.status(409).json({
        success: false,
        error:
          "A candidate profile already uses this email. " +
          "Contact the coordinator to link your account.",
      });
    }

    const candidateResult = await client.query(
      `INSERT INTO candidates (full_name, email)
       VALUES ($1, $2)
       RETURNING candidate_id`,
      [normalizedName, normalizedEmail]
    );

    const candidateId = candidateResult.rows[0].candidate_id;

    const accountResult = await client.query(
      `INSERT INTO user_accounts
         (full_name, email, password_hash, role, candidate_id)
       VALUES ($1, $2, $3, 'candidate', $4)
       RETURNING
         user_id AS "userId",
         full_name AS "fullName",
         email,
         role,
         candidate_id AS "candidateId",
         interviewer_id AS "interviewerId"`,
      [
        normalizedName,
        normalizedEmail,
        passwordHash,
        candidateId,
      ]
    );

    await client.query("COMMIT");

    return res.status(201).json({
      success: true,
      user: publicUser(accountResult.rows[0]),
    });
  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Registration rollback failed:", rollbackError.message);
      }
    }

    if (error.code === "23505") {
      return res.status(409).json({
        success: false,
        error: "An account or candidate profile with this email already exists.",
      });
    }

    console.error("Registration failed:", error.message);

    return res.status(500).json({
      success: false,
      error: "Could not create the account.",
    });
  } finally {
    if (client) {
      client.release();
    }
  }
});

// Log in and establish a fresh server-side session.
router.post("/login", async (req, res) => {
  const { email: suppliedEmail, password } = req.body || {};

  if (
    !isValidEmail(suppliedEmail) ||
    typeof password !== "string" ||
    password.length === 0
  ) {
    return res.status(400).json({
      success: false,
      error: "Enter a valid email and password.",
    });
  }

  try {
    const normalizedEmail = suppliedEmail.trim().toLowerCase();

    const result = await pool.query(
      `SELECT
         user_id AS "userId",
         full_name AS "fullName",
         email,
         password_hash AS "passwordHash",
         role,
         candidate_id AS "candidateId",
         interviewer_id AS "interviewerId",
         is_active AS "isActive"
       FROM user_accounts
       WHERE lower(trim(email)) = $1
       LIMIT 1`,
      [normalizedEmail]
    );

    if (result.rowCount === 0 || !result.rows[0].isActive) {
      return res.status(401).json({
        success: false,
        error: "Invalid email or password.",
      });
    }

    const account = result.rows[0];
    const passwordMatches = await bcrypt.compare(
      password,
      account.passwordHash
    );

    if (!passwordMatches) {
      return res.status(401).json({
        success: false,
        error: "Invalid email or password.",
      });
    }

    await regenerateSession(req);

    req.session.userId = account.userId;
    await saveSession(req);

    return res.json({
      success: true,
      user: publicUser(account),
    });
  } catch (error) {
    console.error("Login failed:", error.message);

    return res.status(500).json({
      success: false,
      error: "Could not complete login.",
    });
  }
});

// Redeem a one-time invitation and link the account to the existing profile.
// POST /api/auth/redeem-invitation
router.post("/redeem-invitation", async (req, res) => {
  const { token, password } = req.body || {};

  if (
    typeof token !== "string" ||
    !/^[A-Za-z0-9_-]{40,60}$/.test(token) ||
    !isValidPassword(password)
  ) {
    return res.status(400).json({
      success: false,
      error:
        "Provide a valid invitation token and a password of 12–72 UTF-8 bytes.",
    });
  }

  const tokenHash = createHash("sha256").update(token).digest("hex");
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  let client;

  try {
    client = await pool.connect();
    await client.query("BEGIN");

    // Locking the invitation makes redemption single-use under concurrency.
    const invitationResult = await client.query(
      `SELECT
         invitation_id AS "invitationId",
         email,
         role,
         candidate_id AS "candidateId",
         interviewer_id AS "interviewerId",
         expires_at AS "expiresAt",
         redeemed_at AS "redeemedAt",
         revoked_at AS "revokedAt"
       FROM account_invitations
       WHERE token_hash = $1
       FOR UPDATE`,
      [tokenHash]
    );

    if (invitationResult.rowCount === 0) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        success: false,
        error: "Invalid invitation token.",
      });
    }

    const invitation = invitationResult.rows[0];

    if (
      invitation.redeemedAt ||
      invitation.revokedAt ||
      new Date(invitation.expiresAt).getTime() <= Date.now()
    ) {
      await client.query("ROLLBACK");

      return res.status(410).json({
        success: false,
        error: "This invitation has expired, been revoked or already used.",
      });
    }

    let profileResult;

    if (invitation.role === "candidate") {
      profileResult = await client.query(
        `SELECT
           candidate_id AS id,
           full_name AS "fullName",
           lower(trim(email)) AS email
         FROM candidates
         WHERE candidate_id = $1
         FOR UPDATE`,
        [invitation.candidateId]
      );
    } else if (invitation.role === "interviewer") {
      profileResult = await client.query(
        `SELECT
           interviewer_id AS id,
           full_name AS "fullName",
           lower(trim(email)) AS email
         FROM interviewers
         WHERE interviewer_id = $1
         FOR UPDATE`,
        [invitation.interviewerId]
      );
    } else {
      await client.query("ROLLBACK");

      return res.status(409).json({
        success: false,
        error: "This invitation has an unsupported role.",
      });
    }

    if (profileResult.rowCount === 0) {
      await client.query("ROLLBACK");

      return res.status(409).json({
        success: false,
        error: "The invited profile no longer exists.",
      });
    }

    const profile = profileResult.rows[0];

    // Do not let a previously issued invitation claim a profile whose email
    // has changed since the invitation was created.
    if (profile.email !== invitation.email) {
      await client.query("ROLLBACK");

      return res.status(409).json({
        success: false,
        error:
          "The profile email has changed. Ask the coordinator for a new invitation.",
      });
    }

    const existingAccountResult = await client.query(
      `SELECT user_id
       FROM user_accounts
       WHERE lower(trim(email)) = $1
          OR ($2::uuid IS NOT NULL AND candidate_id = $2)
          OR ($3::uuid IS NOT NULL AND interviewer_id = $3)
       LIMIT 1`,
      [
        invitation.email,
        invitation.role === "candidate" ? invitation.candidateId : null,
        invitation.role === "interviewer" ? invitation.interviewerId : null,
      ]
    );

    if (existingAccountResult.rowCount > 0) {
      await client.query("ROLLBACK");

      return res.status(409).json({
        success: false,
        error: "This profile or email already has an account.",
      });
    }

    const accountResult = await client.query(
      `INSERT INTO user_accounts
         (
           full_name,
           email,
           password_hash,
           role,
           candidate_id,
           interviewer_id
         )
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING
         user_id AS "userId",
         full_name AS "fullName",
         email,
         role,
         candidate_id AS "candidateId",
         interviewer_id AS "interviewerId"`,
      [
        profile.fullName,
        invitation.email,
        passwordHash,
        invitation.role,
        invitation.role === "candidate" ? invitation.candidateId : null,
        invitation.role === "interviewer" ? invitation.interviewerId : null,
      ]
    );

    await client.query(
      `UPDATE account_invitations
       SET redeemed_at = now()
       WHERE invitation_id = $1`,
      [invitation.invitationId]
    );

    await client.query("COMMIT");

    return res.status(201).json({
      success: true,
      user: publicUser(accountResult.rows[0]),
    });
  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error(
          "Invitation redemption rollback failed:",
          rollbackError.message
        );
      }
    }

    if (error.code === "23505") {
      return res.status(409).json({
        success: false,
        error: "This profile or email already has an account.",
      });
    }

    console.error("Invitation redemption failed:", error.message);

    return res.status(500).json({
      success: false,
      error: "Could not redeem the invitation.",
    });
  } finally {
    if (client) {
      client.release();
    }
  }
});

// Return the current authenticated identity, if still active.
router.get("/me", async (req, res) => {
  const userId = req.session?.userId;

  if (!userId) {
    return res.status(401).json({
      success: false,
      error: "Authentication required.",
    });
  }

  try {
    const result = await pool.query(
      `SELECT
         user_id AS "userId",
         full_name AS "fullName",
         email,
         role,
         candidate_id AS "candidateId",
         interviewer_id AS "interviewerId",
         is_active AS "isActive"
       FROM user_accounts
       WHERE user_id = $1`,
      [userId]
    );

    if (result.rowCount === 0 || !result.rows[0].isActive) {
      await destroySession(req);

      return res.status(401).json({
        success: false,
        error: "Your account is not active. Please log in again.",
      });
    }

    return res.json({
      success: true,
      user: publicUser(result.rows[0]),
    });
  } catch (error) {
    console.error("Identity lookup failed:", error.message);

    return res.status(500).json({
      success: false,
      error: "Could not verify the authenticated account.",
    });
  }
});

// Destroy the server-side session and clear the browser cookie.
router.post("/logout", async (req, res) => {
  try {
    await destroySession(req);

    res.clearCookie("chronos.sid", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });

    return res.json({
      success: true,
      message: "Logged out successfully.",
    });
  } catch (error) {
    console.error("Logout failed:", error.message);

    return res.status(500).json({
      success: false,
      error: "Could not complete logout.",
    });
  }
});

module.exports = router;
