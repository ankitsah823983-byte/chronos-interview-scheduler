
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const pool = require("./db");

const BASE_URL = "http://localhost:5000";

async function main() {
  const eventName = `Chronos Rollback Test ${randomUUID()}`;

  const payload = {
    eventName,
    timeSlots: ["10:00", "10:30"],

    candidates: [
      {
        id: "c1",
        name: "Rollback Candidate",
        availableSlots: ["10:00", "10:30"],
      },
    ],

    interviewers: [
      {
        id: "i1",
        name: "Rollback Interviewer",

        // The null skill deliberately causes a database
        // NOT NULL constraint violation during persistence.
        skills: ["DSA", null],

        availableSlots: ["10:00", "10:30"],
        maxInterviewsPerDay: 1,
      },
    ],

    rooms: [
      {
        id: "r1",
        name: "Rollback Room",
        availableSlots: ["10:00", "10:30"],
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
    ],
  };

  const before = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM recruitment_events
     WHERE event_name = $1`,
    [eventName]
  );

  assert.equal(Number(before.rows[0].count), 0);

  const response = await fetch(`${BASE_URL}/api/schedule`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = await response.json();

  // The scheduler can generate a schedule, but database
  // persistence should fail because of the null skill.
  assert.equal(
    response.status,
    500,
    `Expected HTTP 500, received ${response.status}: ${JSON.stringify(body)}`
  );

  assert.equal(body.success, false);

  const after = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM recruitment_events
     WHERE event_name = $1`,
    [eventName]
  );

  assert.equal(
    Number(after.rows[0].count),
    0,
    "A partial recruitment event remained after persistence failed."
  );

  console.log("PASS: Database persistence failure returns HTTP 500.");
  console.log("PASS: Failed transaction leaves no recruitment event behind.");
  console.log("\nRollback test passed: 2 checks, 0 failed.");
}

main()
  .catch((error) => {
    console.error("ROLLBACK TEST FAILED:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
