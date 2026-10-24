
const express = require("express");
const bcrypt = require("bcryptjs");
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
// Coordinator and interviewer accounts require a trusted provisioning flow.
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

    // Do not silently let a public registration claim an existing profile.
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
        console.error(
          "Registration rollback failed:",
          rollbackError.message
        );
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

// Authenticate credentials and establish a fresh server-side session.
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

    if (
      result.rowCount === 0 ||
      !result.rows[0].isActive
    ) {
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

    // Store the user ID only; reload current role and active status from DB.
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

// Return the current authenticated identity, if the account is still active.
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

    if (
      result.rowCount === 0 ||
      !result.rows[0].isActive
    ) {
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
