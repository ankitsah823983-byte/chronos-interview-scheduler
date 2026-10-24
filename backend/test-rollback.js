
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const pool = require("./db");
const coordinatorSession = require("./test-coordinator-session");

const BASE_URL = "http://localhost:5000";

async function main() {
  let passed = 0;
  let failed = 0;

  const token = randomUUID();
  const eventName = `Chronos Rollback Test ${token}`;
  const candidateName = `Rollback Candidate ${token}`;
  const interviewerName = `Rollback Interviewer ${token}`;

  async function check(name, callback) {
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

  try {
    await coordinatorSession.ready;

    console.log("Chronos transactional rollback tests\n");

    const payload = {
      eventName,
      eventDate: "2026-11-16",
      timeSlots: ["10:00", "10:30"],

      candidates: [
        {
          id: "rollback-candidate",
          name: candidateName,
          availableSlots: ["10:00", "10:30"],
        },
      ],

      interviewers: [
        {
          id: "rollback-interviewer",
          name: interviewerName,
          skills: ["DSA", null],
          availableSlots: ["10:00", "10:30"],
          maxInterviewsPerDay: 2,
        },
      ],

      rooms: [
        {
          id: "rollback-room",
          name: "Rollback Test Room",
          availableSlots: ["10:00", "10:30"],
        },
      ],

      tasks: [
        {
          id: "rollback-task",
          candidateId: "rollback-candidate",
          roundName: "Rollback Test Interview",
          requiredSkills: ["DSA"],
          durationSlots: 1,
        },
      ],
    };

    let response;
    let body;

    await check(
      "Persistence failure returns HTTP 500",
      async () => {
        response = await fetch(`${BASE_URL}/api/schedule`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        body = await response.json();

        assert.equal(
          response.status,
          500,
          `Expected HTTP 500, received ${response.status}: ${JSON.stringify(body)}`
        );

        assert.equal(body.success, false);
      }
    );

    await check(
      "No partial recruitment event remains",
      async () => {
        const result = await pool.query(
          `SELECT COUNT(*)::int AS count
           FROM recruitment_events
           WHERE event_name = $1`,
          [eventName]
        );

        assert.equal(result.rows[0].count, 0);
      }
    );

    await check(
      "No orphan candidate profile remains",
      async () => {
        const result = await pool.query(
          `SELECT COUNT(*)::int AS count
           FROM candidates
           WHERE full_name = $1`,
          [candidateName]
        );

        assert.equal(result.rows[0].count, 0);
      }
    );

    await check(
      "No orphan interviewer profile remains",
      async () => {
        const result = await pool.query(
          `SELECT COUNT(*)::int AS count
           FROM interviewers
           WHERE full_name = $1`,
          [interviewerName]
        );

        assert.equal(result.rows[0].count, 0);
      }
    );

    console.log(
      `\nRollback test summary: ${passed} passed, ${failed} failed.`
    );

    if (failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    await coordinatorSession.cleanup();
  }
}

main().catch(async (error) => {
  console.error("Rollback test runner failed:", error.message);
  process.exitCode = 1;

  try {
    await coordinatorSession.cleanup();
  } catch (cleanupError) {
    console.error("Test cleanup failed:", cleanupError.message);
  }
});
