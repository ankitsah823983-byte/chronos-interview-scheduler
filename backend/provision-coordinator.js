const bcrypt = require("bcryptjs");
const pool = require("./db");

const BCRYPT_ROUNDS = 12;

async function main() {
  const fullName = process.env.COORDINATOR_NAME?.trim();
  const email = process.env.COORDINATOR_EMAIL?.trim().toLowerCase();
  const password = process.env.COORDINATOR_PASSWORD;

  if (!fullName || fullName.length > 150) {
    throw new Error("Set a valid COORDINATOR_NAME environment variable.");
  }

  if (
    !email ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new Error("Set a valid COORDINATOR_EMAIL environment variable.");
  }

  if (
    typeof password !== "string" ||
    password.length < 12 ||
    Buffer.byteLength(password, "utf8") > 72
  ) {
    throw new Error(
      "The coordinator password must be 12–72 UTF-8 bytes."
    );
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Serialize this bootstrap operation to prevent simultaneous creation.
    await client.query("SELECT pg_advisory_xact_lock($1)", [74026101]);

    const existingCoordinator = await client.query(
      `SELECT user_id
       FROM user_accounts
       WHERE role = 'coordinator'
       LIMIT 1`
    );

    if (existingCoordinator.rowCount > 0) {
      throw new Error(
        "A coordinator account already exists. Bootstrap creation is disabled."
      );
    }

    const existingAccount = await client.query(
      `SELECT user_id
       FROM user_accounts
       WHERE lower(trim(email)) = $1
       LIMIT 1`,
      [email]
    );

    if (existingAccount.rowCount > 0) {
      throw new Error("An account with this email already exists.");
    }

    const existingProfile = await client.query(
      `SELECT 1
       FROM candidates
       WHERE lower(trim(email)) = $1
       UNION ALL
       SELECT 1
       FROM interviewers
       WHERE lower(trim(email)) = $1
       LIMIT 1`,
      [email]
    );

    if (existingProfile.rowCount > 0) {
      throw new Error(
        "This email is already associated with a candidate or interviewer profile."
      );
    }

    const result = await client.query(
      `INSERT INTO user_accounts
         (full_name, email, password_hash, role)
       VALUES ($1, $2, $3, 'coordinator')
       RETURNING user_id AS "userId", full_name AS "fullName", email, role`,
      [fullName, email, passwordHash]
    );

    await client.query("COMMIT");

    console.log("Coordinator account created successfully.");
    console.log({
      userId: result.rows[0].userId,
      fullName: result.rows[0].fullName,
      email: result.rows[0].email,
      role: result.rows[0].role,
    });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Rollback failed:", rollbackError.message);
    }

    throw error;
  } finally {
    client.release();
  }
}

main()
  .catch((error) => {
    console.error("Coordinator provisioning failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });