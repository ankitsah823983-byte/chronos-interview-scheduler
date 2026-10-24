
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const pool = require("./db");

const BASE_URL = "http://localhost:5000";

async function main() {
  const testToken = randomUUID();

  const eventName = `Chronos Rollback Test ${testToken}`;
  const candidateName = `Rollback Candidate ${testToken}`;
  const interviewerName = `Rollback Interviewer ${testToken}`;

  const payload = {
    eventName,
    eventDate: "2026-11-16",
    timeSlots: ["10:00", "10:30"],

    candidates: [
      {
        id: "c1",
        name: candidateName,
        availableSlots: ["10:00", "10:30"],
      },
    ],

    interviewers: [
      {
        id: "i1",
        name: interviewerName,

        // Deliberately invalid: the database requires
        // interviewer_skills.skill to be NOT NULL.
        skills: ["DSA", null],

        availableSlots: ["10:00", "10:30"],
        maxInterviewsPerDay: 1,
      },
    ],

    rooms: [
      {
        id: "r1",
        name: "Rollback Test Room",
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

  // Confirm this test's unique names do not already exist.
  const before = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int
        FROM recruitment_events
        WHERE event_name = $1) AS events,
       (SELECT COUNT(*)::int
        FROM candidates
        WHERE full_name = $2) AS candidates,
       (SELECT COUNT(*)::int
        FROM interviewers
        WHERE full_name = $3) AS interviewers`,
    [eventName, candidateName, interviewerName]
  );

  assert.equal(before.rows[0].events, 0);
  assert.equal(before.rows[0].candidates, 0);
  assert.equal(before.rows[0].interviewers, 0);

  const response = await fetch(`${BASE_URL}/api/schedule`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = await response.json();

  // Scheduling can succeed, but persistence must fail when
  // PostgreSQL rejects the null skill. The API should return 500.
  assert.equal(
    response.status,
    500,
    `Expected HTTP 500, got ${response.status}: ${JSON.stringify(body)}`
  );

  assert.equal(body.success, false);

  // Verify that the transaction did not leave partial records.
  const after = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int
        FROM recruitment_events
        WHERE event_name = $1) AS events,
       (SELECT COUNT(*)::int
        FROM candidates
        WHERE full_name = $2) AS candidates,
       (SELECT COUNT(*)::int
        FROM interviewers
        WHERE full_name = $3) AS interviewers`,
    [eventName, candidateName, interviewerName]
  );

  assert.equal(
    after.rows[0].events,
    0,
    "A partial recruitment event remained after rollback."
  );

  assert.equal(
    after.rows[0].candidates,
    0,
    "An orphan candidate profile remained after rollback."
  );

  assert.equal(
    after.rows[0].interviewers,
    0,
    "An orphan interviewer profile remained after rollback."
  );

  console.log("PASS: Persistence failure returns HTTP 500.");
  console.log("PASS: No partial recruitment event remains.");
  console.log("PASS: No orphan candidate profile remains.");
  console.log("PASS: No orphan interviewer profile remains.");

  console.log("\nRollback test passed: 4 checks, 0 failed.");
}

main()
  .catch((error) => {
    console.error("ROLLBACK TEST FAILED:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
