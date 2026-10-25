const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const bcrypt = require("bcryptjs");
const pool = require("./db");

const API = "http://localhost:5000/api";
const suffix = randomUUID();
const password = `Candidate-Booking-${randomUUID()}!`;
const passwordHashPromise = bcrypt.hash(password, 10);

const candidateA = {
  name: "Booking Test Candidate A",
  email: `booking-a-${suffix}@example.test`,
};

const candidateB = {
  name: "Booking Test Candidate B",
  email: `booking-b-${suffix}@example.test`,
};

const coordinator = {
  name: "Booking Test Coordinator",
  email: `booking-coordinator-${suffix}@example.test`,
};

const interviewerEmail = `booking-interviewer-${suffix}@example.test`;

let candidateAId;
let candidateBId;
let candidateAUserId;
let candidateBUserId;
let coordinatorUserId;
let interviewerId;

let candidateACookie;
let candidateBCookie;
let coordinatorCookie;

let publishedEventId;
let draftEventId;
let candidateAScheduleId;
let candidateBScheduleId;
let draftScheduleId;

const eventIds = [];
const tests = [];
const failures = [];

function test(name, fn) {
  tests.push({ name, fn });
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
    `Login failed for ${email}: ${JSON.stringify(result.body)}`
  );

  assert.equal(result.body.success, true);

  const setCookie = result.response.headers.get("set-cookie");

  assert.ok(setCookie, "Login response did not set a session cookie.");

  return setCookie.split(";")[0];
}

async function createEvent(name, status) {
  const result = await pool.query(
    `INSERT INTO recruitment_events
       (event_name, event_date, status)
     VALUES ($1, $2, $3)
     RETURNING event_id`,
    [name, "2027-02-15", status]
  );

  const eventId = result.rows[0].event_id;
  eventIds.push(eventId);

  return eventId;
}

async function createSchedule({
  eventId,
  candidateId,
  interviewerId,
  roundName,
  roomName,
  startTime,
  endTime,
  status,
}) {
  await pool.query(
    `INSERT INTO event_candidates (event_id, candidate_id)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [eventId, candidateId]
  );

  await pool.query(
    `INSERT INTO event_interviewers
       (event_id, interviewer_id, max_interviews_per_day)
     VALUES ($1, $2, 2)
     ON CONFLICT (event_id, interviewer_id) DO NOTHING`,
    [eventId, interviewerId]
  );

  const roomResult = await pool.query(
    `INSERT INTO rooms (event_id, room_name)
     VALUES ($1, $2)
     RETURNING room_id`,
    [eventId, roomName]
  );

  const roomId = roomResult.rows[0].room_id;

  const taskResult = await pool.query(
    `INSERT INTO interview_tasks
       (event_id, candidate_id, round_name, duration_slots)
     VALUES ($1, $2, $3, 1)
     RETURNING task_id`,
    [eventId, candidateId, roundName]
  );

  const taskId = taskResult.rows[0].task_id;

  const scheduleResult = await pool.query(
    `INSERT INTO scheduled_interviews
       (event_id, task_id, room_id, start_time, end_time, status)
     VALUES ($1, $2, $3, $4::time, $5::time, $6)
     RETURNING schedule_id`,
    [eventId, taskId, roomId, startTime, endTime, status]
  );

  const scheduleId = String(scheduleResult.rows[0].schedule_id);

  await pool.query(
    `INSERT INTO scheduled_interview_interviewers
       (event_id, schedule_id, interviewer_id)
     VALUES ($1, $2, $3)`,
    [eventId, scheduleId, interviewerId]
  );

  return scheduleId;
}

async function setup() {
  const passwordHash = await passwordHashPromise;

  const interviewerResult = await pool.query(
    `INSERT INTO interviewers (full_name, email)
     VALUES ($1, $2)
     RETURNING interviewer_id`,
    ["Booking Test Interviewer", interviewerEmail]
  );

  interviewerId = interviewerResult.rows[0].interviewer_id;

  const candidateAResult = await pool.query(
    `INSERT INTO candidates (full_name, email)
     VALUES ($1, $2)
     RETURNING candidate_id`,
    [candidateA.name, candidateA.email]
  );

  candidateAId = candidateAResult.rows[0].candidate_id;

  const candidateBResult = await pool.query(
    `INSERT INTO candidates (full_name, email)
     VALUES ($1, $2)
     RETURNING candidate_id`,
    [candidateB.name, candidateB.email]
  );

  candidateBId = candidateBResult.rows[0].candidate_id;

  const userAResult = await pool.query(
    `INSERT INTO user_accounts
       (full_name, email, password_hash, role, candidate_id)
     VALUES ($1, $2, $3, 'candidate', $4)
     RETURNING user_id`,
    [candidateA.name, candidateA.email, passwordHash, candidateAId]
  );

  candidateAUserId = userAResult.rows[0].user_id;

  const userBResult = await pool.query(
    `INSERT INTO user_accounts
       (full_name, email, password_hash, role, candidate_id)
     VALUES ($1, $2, $3, 'candidate', $4)
     RETURNING user_id`,
    [candidateB.name, candidateB.email, passwordHash, candidateBId]
  );

  candidateBUserId = userBResult.rows[0].user_id;

  const coordinatorResult = await pool.query(
    `INSERT INTO user_accounts
       (full_name, email, password_hash, role)
     VALUES ($1, $2, $3, 'coordinator')
     RETURNING user_id`,
    [coordinator.name, coordinator.email, passwordHash]
  );

  coordinatorUserId = coordinatorResult.rows[0].user_id;

  publishedEventId = await createEvent(
    `Candidate Booking Published ${suffix}`,
    "published"
  );

  await pool.query(
    `INSERT INTO event_time_slots (event_id, slot_time)
     VALUES ($1, '10:00'), ($1, '10:30')`,
    [publishedEventId]
  );

  candidateAScheduleId = await createSchedule({
    eventId: publishedEventId,
    candidateId: candidateAId,
    interviewerId,
    roundName: "Candidate A Interview",
    roomName: `Booking Room A ${suffix}`,
    startTime: "10:00",
    endTime: "10:30",
    status: "published",
  });

  candidateBScheduleId = await createSchedule({
    eventId: publishedEventId,
    candidateId: candidateBId,
    interviewerId,
    roundName: "Candidate B Interview",
    roomName: `Booking Room B ${suffix}`,
    startTime: "10:30",
    endTime: "11:00",
    status: "published",
  });

  draftEventId = await createEvent(
    `Candidate Booking Draft ${suffix}`,
    "draft"
  );

  await pool.query(
    `INSERT INTO event_time_slots (event_id, slot_time)
     VALUES ($1, '11:00')`,
    [draftEventId]
  );

  draftScheduleId = await createSchedule({
    eventId: draftEventId,
    candidateId: candidateAId,
    interviewerId,
    roundName: "Draft Candidate Interview",
    roomName: `Booking Draft Room ${suffix}`,
    startTime: "11:00",
    endTime: "11:30",
    status: "draft",
  });

  candidateACookie = await login(candidateA.email);
  candidateBCookie = await login(candidateB.email);
  coordinatorCookie = await login(coordinator.email);
}

test("Rejects unauthenticated interview listing", async () => {
  const { response } = await request("/candidate/interviews");

  assert.equal(response.status, 401);
});

test("Rejects coordinator access to candidate booking", async () => {
  const { response } = await request(
    "/candidate/interviews",
    {},
    coordinatorCookie
  );

  assert.equal(response.status, 403);
});

test("Lists only the signed-in candidate's published interview", async () => {
  const { response, body } = await request(
    "/candidate/interviews",
    {},
    candidateACookie
  );

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.total, 1);
  assert.equal(body.interviews[0].scheduleId, candidateAScheduleId);
  assert.equal(body.interviews[0].bookingStatus, "published");
  assert.equal(body.interviews[0].eventStatus, undefined);

  assert.ok(
    !body.interviews.some(
      (interview) => interview.scheduleId === candidateBScheduleId
    )
  );

  assert.ok(
    !body.interviews.some(
      (interview) => interview.scheduleId === draftScheduleId
    )
  );
});

test("Rejects booking another candidate's interview", async () => {
  const { response } = await request(
    `/candidate/interviews/${candidateAScheduleId}/book`,
    { method: "POST" },
    candidateBCookie
  );

  assert.equal(response.status, 404);
});

test("Rejects booking a draft interview", async () => {
  const { response } = await request(
    `/candidate/interviews/${draftScheduleId}/book`,
    { method: "POST" },
    candidateACookie
  );

  assert.equal(response.status, 409);
});

test("Rejects an invalid schedule ID", async () => {
  const { response } = await request(
    "/candidate/interviews/not-a-schedule/book",
    { method: "POST" },
    candidateACookie
  );

  assert.equal(response.status, 400);
});

test("Books the candidate's own published interview", async () => {
  const { response, body } = await request(
    `/candidate/interviews/${candidateAScheduleId}/book`,
    { method: "POST" },
    candidateACookie
  );

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.interview.bookingStatus, "booked");
  assert.equal(body.interview.scheduleId, candidateAScheduleId);
});

test("Rejects repeated booking of the same interview", async () => {
  const { response, body } = await request(
    `/candidate/interviews/${candidateAScheduleId}/book`,
    { method: "POST" },
    candidateACookie
  );

  assert.equal(response.status, 409);
  assert.equal(body.success, false);
});

test("Lists the booked status after successful booking", async () => {
  const { response, body } = await request(
    "/candidate/interviews",
    {},
    candidateACookie
  );

  assert.equal(response.status, 200);
  assert.equal(body.total, 1);
  assert.equal(body.interviews[0].bookingStatus, "booked");
});

test("Allows only one of two simultaneous booking requests", async () => {
  const [first, second] = await Promise.all([
    request(
      `/candidate/interviews/${candidateBScheduleId}/book`,
      { method: "POST" },
      candidateBCookie
    ),
    request(
      `/candidate/interviews/${candidateBScheduleId}/book`,
      { method: "POST" },
      candidateBCookie
    ),
  ]);

  const statuses = [first.response.status, second.response.status].sort(
    (a, b) => a - b
  );

  assert.deepEqual(statuses, [200, 409]);
});

test("Candidate B sees only their own booked interview", async () => {
  const { response, body } = await request(
    "/candidate/interviews",
    {},
    candidateBCookie
  );

  assert.equal(response.status, 200);
  assert.equal(body.total, 1);
  assert.equal(body.interviews[0].scheduleId, candidateBScheduleId);
  assert.equal(body.interviews[0].bookingStatus, "booked");
});

async function cleanup() {
  const cookies = [
    ["/auth/logout", candidateACookie],
    ["/auth/logout", candidateBCookie],
    ["/auth/logout", coordinatorCookie],
  ];

  for (const [path, cookie] of cookies) {
    if (cookie) {
      try {
        await request(path, { method: "POST" }, cookie);
      } catch {
        // Continue cleanup even if a test session has already expired.
      }
    }
  }

  if (eventIds.length > 0) {
    await pool.query(
      `DELETE FROM scheduled_interview_interviewers
       WHERE event_id = ANY($1::uuid[])`,
      [eventIds]
    );

    await pool.query(
      `DELETE FROM scheduled_interviews
       WHERE event_id = ANY($1::uuid[])`,
      [eventIds]
    );

    await pool.query(
      `DELETE FROM recruitment_events
       WHERE event_id = ANY($1::uuid[])`,
      [eventIds]
    );
  }

  const userIds = [
    candidateAUserId,
    candidateBUserId,
    coordinatorUserId,
  ].filter(Boolean);

  if (userIds.length > 0) {
    await pool.query(
      `DELETE FROM user_accounts
       WHERE user_id = ANY($1::uuid[])`,
      [userIds]
    );
  }

  const candidateEmails = [candidateA.email, candidateB.email];

  await pool.query(
    `DELETE FROM candidates
     WHERE email = ANY($1::text[])`,
    [candidateEmails]
  );

  await pool.query(
    `DELETE FROM interviewers
     WHERE interviewer_id = $1`,
    [interviewerId || null]
  );
}

async function main() {
  let fatalError = null;

  try {
    await setup();

    console.log("\nChronos candidate booking tests\n");

    for (const item of tests) {
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
    console.error("Test setup failed:", error.message);
  } finally {
    try {
      await cleanup();
    } catch (error) {
      fatalError ||= error;
      console.error("Cleanup failed:", error.message);
    }

    await pool.end();
  }

  console.log(
    `\nTest summary: ${tests.length - failures.length} passed, ` +
      `${failures.length} failed.`
  );

  if (fatalError || failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch(async (error) => {
  console.error("Unexpected test error:", error);
  process.exitCode = 1;
  await pool.end();
});