const readline = require("node:readline");
const { randomUUID } = require("node:crypto");
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

  if (!input.isTTY || typeof input.setRawMode !== "function") {
    return ask(prompt);
  }

  output.write(prompt);

  return new Promise((resolve, reject) => {
    let password = "";
    const previousRawMode = input.isRaw;

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
          finish(new Error("Setup cancelled."));
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

    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

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
    console.log("\nChronos — Test Candidate Setup\n");

    const name = await ask("Your candidate name: ");
    const email = (await ask("Your email ID: ")).toLowerCase();
    const password = await askHidden("Choose a password: ");

    const eventNameInput =
      (await ask("Test event name [Chronos Candidate Booking Demo]: ")) ||
      "Chronos Candidate Booking Demo";

    const dateInput = await ask(
      "Event date YYYY-MM-DD [2027-01-15]: "
    );

    const eventDate = dateInput || "2027-01-15";
    const suffix = randomUUID().slice(0, 8);
    const eventName = `${eventNameInput} - ${suffix}`;
    const interviewerEmail = `booking-demo-${randomUUID()}@example.test`;

    if (!name) {
      throw new Error("Candidate name is required.");
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

    // Prevent accidental conflicts with an existing account or profile.
    const emailCheck = await client.query(
      `SELECT
         EXISTS (
           SELECT 1 FROM user_accounts
           WHERE lower(trim(email)) = $1
         )
         OR EXISTS (
           SELECT 1 FROM candidates
           WHERE lower(trim(email)) = $1
         )
         OR EXISTS (
           SELECT 1 FROM interviewers
           WHERE lower(trim(email)) = $1
         ) AS "emailUsed"`,
      [email]
    );

    if (emailCheck.rows[0].emailUsed) {
      throw new Error(
        "This email already exists in an account or profile. " +
          "Use a different test email; no existing account was changed."
      );
    }

    // Create the candidate profile and link the login account to it.
    const candidateResult = await client.query(
      `INSERT INTO candidates (full_name, email)
       VALUES ($1, $2)
       RETURNING candidate_id`,
      [name, email]
    );

    const candidateId = candidateResult.rows[0].candidate_id;

    await client.query(
      `INSERT INTO user_accounts
         (full_name, email, password_hash, role, candidate_id)
       VALUES ($1, $2, $3, 'candidate', $4)`,
      [name, email, passwordHash, candidateId]
    );

    // Create an event that is already published for the browser test.
    const eventResult = await client.query(
      `INSERT INTO recruitment_events
         (event_name, event_date, status)
       VALUES ($1, $2, 'published')
       RETURNING event_id`,
      [eventName, eventDate]
    );

    const eventId = eventResult.rows[0].event_id;

    await client.query(
      `INSERT INTO event_candidates (event_id, candidate_id)
       VALUES ($1, $2)`,
      [eventId, candidateId]
    );

    // Create event time slots.
    await client.query(
      `INSERT INTO event_time_slots (event_id, slot_time)
       VALUES ($1, '10:00'), ($1, '10:30')`,
      [eventId]
    );

    // Create an interviewer profile assigned to this event.
    const interviewerResult = await client.query(
      `INSERT INTO interviewers (full_name, email)
       VALUES ($1, $2)
       RETURNING interviewer_id`,
      ["Chronos Demo Interviewer", interviewerEmail]
    );

    const interviewerId = interviewerResult.rows[0].interviewer_id;

    await client.query(
      `INSERT INTO event_interviewers
         (event_id, interviewer_id, max_interviews_per_day)
       VALUES ($1, $2, 2)`,
      [eventId, interviewerId]
    );

    // Add a room and an interview task for this candidate.
    const roomResult = await client.query(
      `INSERT INTO rooms (event_id, room_name)
       VALUES ($1, $2)
       RETURNING room_id`,
      [eventId, `Demo Room ${suffix}`]
    );

    const roomId = roomResult.rows[0].room_id;

    const taskResult = await client.query(
      `INSERT INTO interview_tasks
         (event_id, candidate_id, round_name, duration_slots)
       VALUES ($1, $2, $3, 1)
       RETURNING task_id`,
      [eventId, candidateId, "Coding Interview"]
    );

    const taskId = taskResult.rows[0].task_id;

    // The candidate can see and confirm this published interview.
    const scheduleResult = await client.query(
      `INSERT INTO scheduled_interviews
         (event_id, task_id, room_id, start_time, end_time, status)
       VALUES ($1, $2, $3, '10:00', '10:30', 'published')
       RETURNING schedule_id`,
      [eventId, taskId, roomId]
    );

    const scheduleId = scheduleResult.rows[0].schedule_id;

    await client.query(
      `INSERT INTO scheduled_interview_interviewers
         (event_id, schedule_id, interviewer_id)
       VALUES ($1, $2, $3)`,
      [eventId, scheduleId, interviewerId]
    );

    await client.query("COMMIT");
    transactionStarted = false;

    console.log("\nTest candidate created successfully! ✅");
    console.log(`Name: ${name}`);
    console.log(`Email: ${email}`);
    console.log(`Event: ${eventName}`);
    console.log(`Date: ${eventDate}`);
    console.log(`Interview ID: ${scheduleId}`);
    console.log("Interview time: 10:00–10:30");
    console.log("Initial booking status: published");
    console.log("\nUse the email and password you entered to log in.");
    console.log("The password has not been printed.");
  } catch (error) {
    if (client && transactionStarted) {
      await client.query("ROLLBACK").catch(() => {});
    }

    console.error("\nSetup failed:", error.message);
    process.exitCode = 1;
  } finally {
    if (client) {
      client.release();
    }

    await pool.end();
  }
}

main().catch(async (error) => {
  console.error("Unexpected error:", error.message);
  process.exitCode = 1;
  await pool.end();
});