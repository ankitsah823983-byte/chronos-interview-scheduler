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
let otherInterviewerId;
let interviewerUserId;
let coordinatorUserId;
let coordinatorCookie;

let draftEventId;
let publishedEventId;
let unassignedEventId;

let interviewerCookie;

let ownCalendarScheduleId;
let otherInterviewerScheduleId;

const calendarCandidateIds = [];

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

  // Create a second interviewer to verify assignment-based privacy.
  const otherInterviewerResult = await pool.query(
    `INSERT INTO interviewers (full_name, email)
     VALUES ($1, $2)
     RETURNING interviewer_id`,
    ["Other Calendar Test Interviewer", `other-${suffix}@example.test`]
  );

  otherInterviewerId = otherInterviewerResult.rows[0].interviewer_id;

  await pool.query(
    `INSERT INTO event_interviewers
       (event_id, interviewer_id, max_interviews_per_day)
     VALUES ($1, $2, 2)
     ON CONFLICT (event_id, interviewer_id) DO NOTHING`,
    [publishedEventId, otherInterviewerId]
  );

  const ownCandidateResult = await pool.query(
    `INSERT INTO candidates (full_name, email)
     VALUES ($1, $2)
     RETURNING candidate_id`,
    ["Calendar Test Candidate Own", `calendar-own-${suffix}@example.test`]
  );

  const ownCandidateId = ownCandidateResult.rows[0].candidate_id;
  calendarCandidateIds.push(ownCandidateId);

  const otherCandidateResult = await pool.query(
    `INSERT INTO candidates (full_name, email)
     VALUES ($1, $2)
     RETURNING candidate_id`,
    ["Calendar Test Candidate Other", `calendar-other-${suffix}@example.test`]
  );

  const otherCandidateId = otherCandidateResult.rows[0].candidate_id;
  calendarCandidateIds.push(otherCandidateId);

  await pool.query(
    `INSERT INTO event_candidates (event_id, candidate_id)
     VALUES ($1, $2), ($1, $3)`,
    [publishedEventId, ownCandidateId, otherCandidateId]
  );

  const ownRoomResult = await pool.query(
    `INSERT INTO rooms (event_id, room_name)
     VALUES ($1, $2)
     RETURNING room_id`,
    [publishedEventId, `Calendar Own Room ${suffix}`]
  );

  const otherRoomResult = await pool.query(
    `INSERT INTO rooms (event_id, room_name)
     VALUES ($1, $2)
     RETURNING room_id`,
    [publishedEventId, `Calendar Other Room ${suffix}`]
  );

  const ownTaskResult = await pool.query(
    `INSERT INTO interview_tasks
       (event_id, candidate_id, round_name, duration_slots)
     VALUES ($1, $2, $3, 1)
     RETURNING task_id`,
    [publishedEventId, ownCandidateId, "Interviewer Calendar Own"]
  );

  const otherTaskResult = await pool.query(
    `INSERT INTO interview_tasks
       (event_id, candidate_id, round_name, duration_slots)
     VALUES ($1, $2, $3, 1)
     RETURNING task_id`,
    [publishedEventId, otherCandidateId, "Other Interviewer Calendar"]
  );

  const ownScheduleResult = await pool.query(
    `INSERT INTO scheduled_interviews
       (event_id, task_id, room_id, start_time, end_time, status)
     VALUES ($1, $2, $3, '10:00', '10:30', 'booked')
     RETURNING schedule_id`,
    [
      publishedEventId,
      ownTaskResult.rows[0].task_id,
      ownRoomResult.rows[0].room_id,
    ]
  );

  ownCalendarScheduleId = String(ownScheduleResult.rows[0].schedule_id);

  await pool.query(
    `INSERT INTO scheduled_interview_interviewers
       (event_id, schedule_id, interviewer_id)
     VALUES ($1, $2, $3)`,
    [publishedEventId, ownCalendarScheduleId, interviewerId]
  );

  const otherScheduleResult = await pool.query(
    `INSERT INTO scheduled_interviews
       (event_id, task_id, room_id, start_time, end_time, status)
     VALUES ($1, $2, $3, '10:00', '10:30', 'booked')
     RETURNING schedule_id`,
    [
      publishedEventId,
      otherTaskResult.rows[0].task_id,
      otherRoomResult.rows[0].room_id,
    ]
  );

  otherInterviewerScheduleId = String(
    otherScheduleResult.rows[0].schedule_id
  );

  await pool.query(
    `INSERT INTO scheduled_interview_interviewers
       (event_id, schedule_id, interviewer_id)
     VALUES ($1, $2, $3)`,
    [publishedEventId, otherInterviewerScheduleId, otherInterviewerId]
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

test("Rejects unauthenticated requests for confirmed interviewer interviews", async () => {
  const { response } = await request("/interviewer/interviews");

  assert.equal(response.status, 401);
});

test("Rejects coordinator access to confirmed interviewer interviews", async () => {
  const { response } = await request(
    "/interviewer/interviews",
    {},
    coordinatorCookie
  );

  assert.equal(response.status, 403);
});

test("Lists only confirmed interviews assigned to the signed-in interviewer", async () => {
  const { response, body } = await request(
    "/interviewer/interviews",
    {},
    interviewerCookie
  );

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.total, 1);
  assert.equal(body.interviews[0].scheduleId, ownCalendarScheduleId);
  assert.equal(
    body.interviews[0].candidateName,
    "Calendar Test Candidate Own"
  );
  assert.equal(body.interviews[0].bookingStatus, "booked");
});

test("Downloads an ICS file for the interviewer's confirmed interview", async () => {
  const response = await fetch(
    `${API}/interviewer/interviews/${ownCalendarScheduleId}/calendar`,
    {
      headers: { Cookie: interviewerCookie },
    }
  );

  const contentType = response.headers.get("content-type") || "";
  const disposition = response.headers.get("content-disposition") || "";
  const calendar = await response.text();
  const unfoldedCalendar = calendar.replace(/\r\n[ \t]/g, "");

  assert.equal(response.status, 200, calendar);
  assert.match(contentType, /text\/calendar/i);
  assert.match(disposition, /attachment/i);
  assert.match(unfoldedCalendar, /BEGIN:VCALENDAR/);
  assert.match(unfoldedCalendar, /BEGIN:VEVENT/);
  assert.match(
    unfoldedCalendar,
    /DTSTART;TZID=Asia\/Kolkata:20270115T100000/
  );
  assert.match(
    unfoldedCalendar,
    /DTEND;TZID=Asia\/Kolkata:20270115T103000/
  );
  assert.match(
    unfoldedCalendar,
    /SUMMARY:.*Interviewer Calendar Own/
  );
  assert.match(
    unfoldedCalendar,
    /Candidate: Calendar Test Candidate Own/
  );
  assert.match(unfoldedCalendar, /END:VCALENDAR/);
});

test("Rejects calendar download for another interviewer's assignment", async () => {
  const { response, body } = await request(
    `/interviewer/interviews/${otherInterviewerScheduleId}/calendar`,
    {},
    interviewerCookie
  );

  assert.equal(response.status, 404);
  assert.equal(body.success, false);
});

test("Rejects calendar download for an interview that is not booked", async () => {
  await pool.query(
    `UPDATE scheduled_interviews
     SET status = 'published'
     WHERE event_id = $1 AND schedule_id = $2`,
    [publishedEventId, ownCalendarScheduleId]
  );

  try {
    const { response, body } = await request(
      `/interviewer/interviews/${ownCalendarScheduleId}/calendar`,
      {},
      interviewerCookie
    );

    assert.equal(response.status, 409);
    assert.equal(body.success, false);
  } finally {
    await pool.query(
      `UPDATE scheduled_interviews
       SET status = 'booked'
       WHERE event_id = $1 AND schedule_id = $2`,
      [publishedEventId, ownCalendarScheduleId]
    );
  }
});

test("Rejects unauthenticated interviewer calendar downloads", async () => {
  const { response } = await request(
    `/interviewer/interviews/${ownCalendarScheduleId}/calendar`
  );

  assert.equal(response.status, 401);
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

  // Delete test accounts first.
  const userIdsToDelete = [
    interviewerUserId,
    coordinatorUserId,
  ].filter(Boolean);

  if (userIdsToDelete.length > 0) {
    await pool.query(
      `DELETE FROM user_accounts
       WHERE user_id = ANY($1::uuid[])`,
      [userIdsToDelete]
    );
  }

  const eventIdsToDelete = [
    draftEventId,
    publishedEventId,
    unassignedEventId,
  ].filter(Boolean);

  // Remove schedule-to-interviewer links before deleting event
  // assignments. The database uses a RESTRICT foreign key here.
  if (eventIdsToDelete.length > 0) {
    await pool.query(
      `DELETE FROM scheduled_interview_interviewers
       WHERE event_id = ANY($1::uuid[])`,
      [eventIdsToDelete]
    );
  }

  // Delete test events and their dependent data.
  for (const eventId of eventIdsToDelete) {
    await pool.query(
      "DELETE FROM recruitment_events WHERE event_id = $1",
      [eventId]
    );
  }

  // Delete both interviewer profiles created by this test.
  const interviewerIdsToDelete = [
    interviewerId,
    otherInterviewerId,
  ].filter(Boolean);

  if (interviewerIdsToDelete.length > 0) {
    await pool.query(
      `DELETE FROM interviewers
       WHERE interviewer_id = ANY($1::uuid[])`,
      [interviewerIdsToDelete]
    );
  }

  // Delete candidate profiles created for the calendar tests.
  if (calendarCandidateIds.length > 0) {
    await pool.query(
      `DELETE FROM candidates
       WHERE candidate_id = ANY($1::uuid[])`,
      [calendarCandidateIds]
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