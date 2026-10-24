
const assert = require("node:assert/strict");

const BASE_URL = "http://localhost:5000";

function makePayload() {
  const timeSlots = ["10:00", "10:30", "11:00", "11:30"];

  return {
    eventName: "Chronos API Test Event",
    timeSlots,

    candidates: [
      {
        id: "c1",
        name: "Candidate A",
        availableSlots: ["10:00", "10:30"],
      },
      {
        id: "c2",
        name: "Candidate B",
        availableSlots: [...timeSlots],
      },
    ],

    interviewers: [
      {
        id: "i1",
        name: "Interviewer X",
        skills: ["DSA"],
        availableSlots: [...timeSlots],
        maxInterviewsPerDay: 2,
      },
    ],

    rooms: [
      {
        id: "r1",
        name: "Room 1",
        availableSlots: [...timeSlots],
      },
    ],

    tasks: [
      {
        id: "t1",
        candidateId: "c1",
        roundName: "Coding Interview",
        requiredSkills: ["DSA"],
        durationSlots: 1,
      },
      {
        id: "t2",
        candidateId: "c2",
        roundName: "Coding Interview",
        requiredSkills: ["DSA"],
        durationSlots: 1,
      },
    ],
  };
}

let passed = 0;
let failed = 0;
let savedEventId = null;

async function test(name, callback) {
  try {
    await callback();
    passed++;
    console.log(`PASS: ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL: ${name}`);
    console.error(`  ${error.message}`);
  }
}

async function postSchedule(payload) {
  const response = await fetch(`${BASE_URL}/api/schedule`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = await response.json();
  return { response, body };
}

// 1. Successful generation and persistence
async function testSuccessfulGeneration() {
  const { response, body } = await postSchedule(makePayload());

  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.success, true);
  assert.equal(body.schedule.length, 2);
  assert.deepEqual(body.unscheduledTasks, []);

  assert.ok(
    typeof body.persistence?.eventId === "string",
    "Expected a saved event ID"
  );

  assert.equal(body.persistence.savedInterviews, 2);

  savedEventId = body.persistence.eventId;
}

// 2. Missing required arrays
async function testMissingFields() {
  const { response, body } = await postSchedule({
    timeSlots: [],
  });

  assert.equal(response.status, 400);
  assert.equal(body.success, false);
  assert.match(body.error, /fields must be arrays/i);
}

// 3. Invalid time format
async function testInvalidTimeFormat() {
  const payload = makePayload();
  payload.timeSlots = ["25:00"];

  const { response, body } = await postSchedule(payload);

  assert.equal(response.status, 400);
  assert.equal(body.success, false);
  assert.match(body.error, /HH:MM format/i);
}

// 4. Impossible schedule returns 422
async function testInfeasibleSchedule() {
  const payload = makePayload();

  payload.timeSlots = ["10:00"];

  for (const candidate of payload.candidates) {
    candidate.availableSlots = ["10:00"];
  }

  for (const interviewer of payload.interviewers) {
    interviewer.availableSlots = ["10:00"];
  }

  for (const room of payload.rooms) {
    room.availableSlots = ["10:00"];
  }

  const { response, body } = await postSchedule(payload);

  assert.equal(response.status, 422);
  assert.equal(body.success, false);
  assert.equal(body.schedule.length, 0);

  assert.ok(
    body.diagnostics.some(
      (item) => item.code === "SHARED_RESOURCE_CONFLICT"
    ),
    "Expected a shared-resource conflict diagnostic"
  );

  assert.ok(body.persistence?.eventId);
  assert.equal(body.persistence.savedInterviews, 0);
}

// 5. Retrieve a schedule that was just saved
async function testRetrieveSavedSchedule() {
  assert.ok(savedEventId, "Successful test must create an event first");

  const response = await fetch(
    `${BASE_URL}/api/schedules/${encodeURIComponent(savedEventId)}`
  );

  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.event.eventId, savedEventId);
  assert.equal(body.schedule.length, 2);
  assert.equal(body.savedInterviews, 2);

  for (const interview of body.schedule) {
    assert.ok(
      interview.interviewId !== undefined &&
        interview.interviewId !== null,
      "Expected an individual interview ID"
    );
  }
}

// 6. Unknown Event ID returns 404
async function testUnknownEventId() {
  const unknownEventId = "11111111-1111-4111-8111-111111111111";

  const response = await fetch(
    `${BASE_URL}/api/schedules/${unknownEventId}`
  );

  const body = await response.json();

  assert.equal(response.status, 404);
  assert.equal(body.success, false);
  assert.equal(body.error, "Scheduling event not found.");
}

async function main() {
  console.log("Chronos API tests\n");

  await test(
    "Generates a schedule and persists two interviews",
    testSuccessfulGeneration
  );

  await test(
    "Rejects requests with missing required arrays",
    testMissingFields
  );

  await test(
    "Rejects an invalid time format",
    testInvalidTimeFormat
  );

  await test(
    "Returns 422 when a complete schedule is impossible",
    testInfeasibleSchedule
  );

  await test(
    "Retrieves the saved schedule and individual interview IDs",
    testRetrieveSavedSchedule
  );

  await test(
    "Returns 404 for a nonexistent event",
    testUnknownEventId
  );

  console.log(`\nTest summary: ${passed} passed, ${failed} failed.`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("API test runner failed:", error.message);
  process.exitCode = 1;
});
