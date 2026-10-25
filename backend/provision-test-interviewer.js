const readline = require("node:readline");
const bcrypt = require("bcryptjs");
const pool = require("./db");

function ask(prompt) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function askHidden(prompt) {
  const input = process.stdin;
  const output = process.stdout;

  // Fallback for terminals that cannot hide input.
  if (!input.isTTY || typeof input.setRawMode !== "function") {
    return ask(prompt);
  }

  output.write(prompt);

  return new Promise((resolve, reject) => {
    let password = "";
    const previousRawMode = input.isRaw;

    input.setRawMode(true);
    input.resume();

    function finish(error) {
      input.setRawMode(previousRawMode ?? false);
      input.removeListener("data", onData);
      output.write("\n");

      if (error) {
        reject(error);
      } else {
        resolve(password);
      }
    }

    function onData(buffer) {
      for (const character of buffer.toString("utf8")) {
        if (character === "\u0003") {
          finish(new Error("Operation cancelled."));
          return;
        }

        if (character === "\r" || character === "\n") {
          finish();
          return;
        }

        if (character === "\u007f" || character === "\b") {
          if (password.length > 0) {
            password = password.slice(0, -1);
            output.write("\b \b");
          }
          continue;
        }

        if (character >= " " && character !== "\u007f") {
          password += character;
          output.write("*");
        }
      }
    }

    input.on("data", onData);
  });
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const date = new Date(`${value}T00:00:00.000Z`);

  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

async function main() {
  let client;
  let transactionStarted = false;

  try {
    console.log("\nChronos — Test Interviewer Setup\n");

    const name = await ask("Your interviewer name: ");
    const email = (await ask("Your email ID: ")).toLowerCase();
    const password = await askHidden("Choose a password: ");
    const eventName =
      (await ask("Test event name [Chronos Availability Demo]: ")) ||
      "Chronos Availability Demo";

    const eventDateInput = await ask(
      "Event date YYYY-MM-DD [2027-01-15]: "
    );
    const eventDate = eventDateInput || "2027-01-15";

    if (!name) {
      throw new Error("Interviewer name is required.");
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("Enter a valid email address.");
    }

    if (Buffer.byteLength(password, "utf8") < 12) {
      throw new Error("Password must contain at least 12 bytes.");
    }

    if (Buffer.byteLength(password, "utf8") > 72) {
      throw new Error(
        "Password is too long for bcrypt. Use at most 72 UTF-8 bytes."
      );
    }

    if (!isValidDate(eventDate)) {
      throw new Error("Enter a valid date in YYYY-MM-DD format.");
    }

    const passwordHash = await bcrypt.hash(password, 10);

    client = await pool.connect();
    await client.query("BEGIN");
    transactionStarted = true;

    // Avoid reusing an email already associated with another account.
    const accountExists = await client.query(
      `SELECT 1
       FROM user_accounts
       WHERE lower(trim(email)) = $1
       LIMIT 1`,
      [email]
    );

    if (accountExists.rowCount > 0) {
      throw new Error(
        "An account with this email already exists. Use a different email or inspect the existing account first."
      );
    }

    // Never accidentally attach the test account to a candidate profile.
    const candidateExists = await client.query(
      `SELECT 1
       FROM candidates
       WHERE lower(trim(email)) = $1
       LIMIT 1`,
      [email]
    );

    if (candidateExists.rowCount > 0) {
      throw new Error(
        "This email is already associated with a candidate profile. Use another test email."
      );
    }

    const interviewerExists = await client.query(
      `SELECT 1
       FROM interviewers
       WHERE lower(trim(email)) = $1
       LIMIT 1`,
      [email]
    );

    if (interviewerExists.rowCount > 0) {
      throw new Error(
        "An interviewer profile with this email already exists. Inspect that profile before creating another test account."
      );
    }

    const interviewerResult = await client.query(
      `INSERT INTO interviewers (full_name, email)
       VALUES ($1, $2)
       RETURNING interviewer_id`,
      [name, email]
    );

    const interviewerId = interviewerResult.rows[0].interviewer_id;

    await client.query(
      `INSERT INTO user_accounts
         (full_name, email, password_hash, role, interviewer_id)
       VALUES ($1, $2, $3, 'interviewer', $4)`,
      [name, email, passwordHash, interviewerId]
    );

    const eventResult = await client.query(
      `INSERT INTO recruitment_events
         (event_name, event_date, status)
       VALUES ($1, $2, 'draft')
       RETURNING event_id`,
      [eventName, eventDate]
    );

    const eventId = eventResult.rows[0].event_id;

    await client.query(
      `INSERT INTO event_interviewers
         (event_id, interviewer_id, max_interviews_per_day)
       VALUES ($1, $2, 2)`,
      [eventId, interviewerId]
    );

    for (const time of ["10:00", "10:30", "11:00", "11:30"]) {
      await client.query(
        `INSERT INTO event_time_slots (event_id, slot_time)
         VALUES ($1, $2::time)`,
        [eventId, time]
      );
    }

    await client.query("COMMIT");
    transactionStarted = false;

    console.log("\nTest interviewer created successfully! ✅");
    console.log(`Name: ${name}`);
    console.log(`Email: ${email}`);
    console.log(`Event: ${eventName}`);
    console.log(`Date: ${eventDate}`);
    console.log(`Event ID: ${eventId}`);
    console.log("Available slots: 10:00, 10:30, 11:00, 11:30");
    console.log("\nUse the email and password you entered to log in.");
    console.log("The password has not been printed.");
  } catch (error) {
    if (client && transactionStarted) {
      await client.query("ROLLBACK").catch(() => {});
    }

    console.error("\nSetup failed:", error.message);
    process.exitCode = 1;
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

main().catch(async (error) => {
  console.error("Unexpected error:", error.message);
  process.exitCode = 1;
  await pool.end();
});