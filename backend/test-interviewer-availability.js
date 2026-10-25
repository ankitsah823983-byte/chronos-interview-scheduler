const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const bcrypt = require("bcryptjs");
const pool = require("./db");

const API = "http://localhost:5000/api";

const suffix = randomUUID();
const password = `Availability-Test-${randomUUID()}!`;

const interviewerEmail = `availability-${suffix}@example.test`;
const coordinatorEmail = `coordinator-${suffix}@example.test`;

const testNames = [];
const failures = [];

let interviewerId;
let interviewerUserId;
let coordinatorUserId;
let coordinatorCookie;

let draftEventId;
let publishedEventId;
let unassignedEventId;

let interviewerCookie;

function test(name, fn) {
  testNames.push({ name, fn });
}

async function request(path, options = {}, cookie = null) {
  const headers = {
    ...(options.body !== undefined
      ? { "Content-Type": "application/json" }
      : {}),
    ...(options.headers || {}),
  };

  if (cookie) {
    headers.Cookie = cookie;
  }

  const response = await fetch(`${API}${path}`, {
    ...options,
    headers,
    body:
      options.body !== undefined
        ? JSON.stringify(options.body)
        : undefined,
  });

  let body;

  try {
    body = await response.json();
  } catch {
    body = null;
  }

  return { response, body };
}

async function login(email) {
  const result = await request("/auth/login", {
    method: "POST",
    body: { email, password },
  });

  assert.equal(
    result.response.status,
    200,
    `Login failed: ${JSON.stringify(result.body)}`
  );

  assert.equal(result.body.success, true);

  const setCookie = result.response.headers.get("set-cookie");

  assert.ok(setCookie, "Login response did not set a session cookie.");

  return setCookie.split(";")[0];
}

async function createEvent(name, status, assigned) {
  const result = await pool.query(
    `INSERT INTO recruitment_events
       (event_name, event_date, status)
     VALUES ($1, $2, $3)
     RETURNING event_id`,
    [name, "2027-01-15", status]
  );

  const eventId = result.rows[0].event_id;

  if (assigned) {
    await pool.query(
      `INSERT INTO event_interviewers
         (event_id, interviewer_id, max_interviews_per_day)
       VALUES ($1, $2, 2)`,
      [eventId, interviewerId]
    );
  }

  const times =
    status === "published" ? ["10:00"] : ["10:00", "10:30", "11:00"];

  for (const time of times) {
    await pool.query(
      `INSERT INTO event_time_slots (event_id, slot_time)
       VALUES ($1, $2::time)`,
      [eventId, time]
    );
  }

  return eventId;
}

async function setup() {
  const passwordHash = await bcrypt.hash(password, 10);

  const interviewerResult = await pool.query(
    `INSERT INTO interviewers (full_name, email)
     VALUES ($1, $2)
     RETURNING interviewer_id`,
    ["Availability Test Interviewer", interviewerEmail]
  );

  interviewerId = interviewerResult.rows[0].interviewer_id;

  const interviewerUserResult = await pool.query(
    `INSERT INTO user_accounts
       (full_name, email, password_hash, role, interviewer_id)
     VALUES ($1, $2, $3, 'interviewer', $4)
     RETURNING user_id`,
    [
      "Availability Test Interviewer",
      interviewerEmail,
      passwordHash,
      interviewerId,
    ]
  );

  interviewerUserId = interviewerUserResult.rows[0].user_id;

  const coordinatorResult = await pool.query(
    `INSERT INTO user_accounts
       (full_name, email, password_hash, role)
     VALUES ($1, $2, $3, 'coordinator')
     RETURNING user_id`,
    ["Availability Test Coordinator", coordinatorEmail, passwordHash]
  );

  coordinatorUserId = coordinatorResult.rows[0].user_id;

  draftEventId = await createEvent(
    `Availability Draft ${suffix}`,
    "draft",
    true
  );

  publishedEventId = await createEvent(
    `Availability Published ${suffix}`,
    "published",
    true
  );

  unassignedEventId = await createEvent(
    `Availability Unassigned ${suffix}`,
    "draft",
    false
  );

  interviewerCookie = await login(interviewerEmail);
  coordinatorCookie = await login(coordinatorEmail);
}

test("Rejects requests without authentication", async () => {
  const { response } = await request("/interviewer/events");

  assert.equal(response.status, 401);
});

test("Rejects coordinator access to interviewer availability", async () => {
  const { response } = await request(
    "/interviewer/events",
    {},
    coordinatorCookie
  );

  assert.equal(response.status, 403);
});

test("Lists only events assigned to the interviewer", async () => {
  const { response, body } = await request(
    "/interviewer/events",
    {},
    interviewerCookie
  );

  assert.equal(response.status, 200);
  assert.equal(body.success, true);

  const ids = body.events.map((event) => event.eventId);

  assert.ok(ids.includes(draftEventId));
  assert.ok(ids.includes(publishedEventId));
  assert.ok(!ids.includes(unassignedEventId));
});

test("Loads valid slots before the first submission", async () => {
  const { response, body } = await request(
    `/interviewer/events/${draftEventId}/availability`,
    {},
    interviewerCookie
  );

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.event.hasSubmitted, false);
  assert.deepEqual(body.availableSlots, []);
  assert.deepEqual(
    body.timeSlots.map((slot) => slot.time),
    ["10:00", "10:30", "11:00"]
  );
});

test("Rejects access to an event not assigned to this interviewer", async () => {
  const { response } = await request(
    `/interviewer/events/${unassignedEventId}/availability`,
    {},
    interviewerCookie
  );

  assert.equal(response.status, 404);
});

test("Rejects invalid time formats", async () => {
  const { response } = await request(
    `/interviewer/events/${draftEventId}/availability`,
    {
      method: "POST",
      body: { availableSlots: ["25:00"] },
    },
    interviewerCookie
  );

  assert.equal(response.status, 400);
});

test("Rejects duplicate selected slots", async () => {
  const { response } = await request(
    `/interviewer/events/${draftEventId}/availability`,
    {
      method: "POST",
      body: { availableSlots: ["10:00", "10:00"] },
    },
    interviewerCookie
  );

  assert.equal(response.status, 400);
});

test("Rejects slots that do not belong to the event", async () => {
  const { response } = await request(
    `/interviewer/events/${draftEventId}/availability`,
    {
      method: "POST",
      body: { availableSlots: ["12:00"] },
    },
    interviewerCookie
  );

  assert.equal(response.status, 400);
});

test("Submits selected slots", async () => {
  const { response, body } = await request(
    `/interviewer/events/${draftEventId}/availability`,
    {
      method: "POST",
      body: { availableSlots: ["10:00", "11:00"] },
    },
    interviewerCookie
  );

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.deepEqual(body.availableSlots, ["10:00", "11:00"]);
  assert.ok(body.submittedAt);

  const submission = await pool.query(
    `SELECT submitted_at
     FROM interviewer_availability_submissions
     WHERE event_id = $1 AND interviewer_id = $2`,
    [draftEventId, interviewerId]
  );

  assert.equal(submission.rowCount, 1);

  const selections = await pool.query(
    `SELECT to_char(slot_time, 'HH24:MI') AS time
     FROM interviewer_availability_submission_slots
     WHERE event_id = $1 AND interviewer_id = $2
     ORDER BY slot_time`,
    [draftEventId, interviewerId]
  );

  assert.deepEqual(
    selections.rows.map((row) => row.time),
    ["10:00", "11:00"]
  );
});

test("Reloads submitted availability correctly", async () => {
  const { response, body } = await request(
    `/interviewer/events/${draftEventId}/availability`,
    {},
    interviewerCookie
  );

  assert.equal(response.status, 200);
  assert.equal(body.event.hasSubmitted, true);
  assert.deepEqual(body.availableSlots, ["10:00", "11:00"]);
});

test("Resubmission replaces previous selections", async () => {
  const { response, body } = await request(
    `/interviewer/events/${draftEventId}/availability`,
    {
      method: "POST",
      body: { availableSlots: ["10:30"] },
    },
    interviewerCookie
  );

  assert.equal(response.status, 200);
  assert.deepEqual(body.availableSlots, ["10:30"]);

  const selected = await pool.query(
    `SELECT to_char(slot_time, 'HH24:MI') AS time
     FROM interviewer_availability_submission_slots
     WHERE event_id = $1 AND interviewer_id = $2
     ORDER BY slot_time`,
    [draftEventId, interviewerId]
  );

  assert.deepEqual(selected.rows.map((row) => row.time), ["10:30"]);
});

test("Allows an intentional empty submission", async () => {
  const { response, body } = await request(
    `/interviewer/events/${draftEventId}/availability`,
    {
      method: "POST",
      body: { availableSlots: [] },
    },
    interviewerCookie
  );

  assert.equal(response.status, 200);
  assert.deepEqual(body.availableSlots, []);

  const { body: reloadBody } = await request(
    `/interviewer/events/${draftEventId}/availability`,
    {},
    interviewerCookie
  );

  assert.equal(reloadBody.event.hasSubmitted, true);
  assert.deepEqual(reloadBody.availableSlots, []);

  const availability = await pool.query(
    `SELECT 1
     FROM interviewer_availability
     WHERE event_id = $1 AND interviewer_id = $2`,
    [draftEventId, interviewerId]
  );

  assert.equal(availability.rowCount, 0);
});

test("Does not allow changing a published event", async () => {
  const { response } = await request(
    `/interviewer/events/${publishedEventId}/availability`,
    {
      method: "POST",
      body: { availableSlots: ["10:00"] },
    },
    interviewerCookie
  );

  assert.equal(response.status, 409);
});

async function cleanup() {
  if (interviewerCookie) {
    try {
      await request(
        "/auth/logout",
        { method: "POST" },
        interviewerCookie
      );
    } catch {}
  }

  if (coordinatorCookie) {
    try {
      await request(
        "/auth/logout",
        { method: "POST" },
        coordinatorCookie
      );
    } catch {}
  }

  if (interviewerUserId || coordinatorUserId) {
    await pool.query(
      `DELETE FROM user_accounts
       WHERE user_id = ANY($1::uuid[])`,
      [[interviewerUserId, coordinatorUserId].filter(Boolean)]
    );
  }

  for (const eventId of [
    draftEventId,
    publishedEventId,
    unassignedEventId,
  ]) {
    if (eventId) {
      await pool.query(
        "DELETE FROM recruitment_events WHERE event_id = $1",
        [eventId]
      );
    }
  }

  if (interviewerId) {
    await pool.query(
      "DELETE FROM interviewers WHERE interviewer_id = $1",
      [interviewerId]
    );
  }
}

async function main() {
  let fatalError = null;

  try {
    await setup();

    console.log("\nChronos interviewer availability tests\n");

    for (const item of testNames) {
      try {
        await item.fn();
        console.log(`PASS: ${item.name}`);
      } catch (error) {
        failures.push({ name: item.name, error });
        console.error(`FAIL: ${item.name}`);
        console.error(error.message);
      }
    }
  } catch (error) {
    fatalError = error;
    console.error("Test setup failed:", error);
  } finally {
    try {
      await cleanup();
    } catch (error) {
      fatalError ||= error;
      console.error("Test cleanup failed:", error);
    }

    await pool.end();
  }

  console.log(
    `\nTest summary: ${testNames.length - failures.length} passed, ` +
      `${failures.length} failed.`
  );

  if (fatalError || failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});