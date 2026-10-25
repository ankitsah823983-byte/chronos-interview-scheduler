const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

const pool = require("./db");
const { generateSchedule } = require("./scheduler");
const {
  persistScheduleRun,
  applySubmittedInterviewerAvailability,
} = require("./persistence");

const suffix = randomUUID();

const candidateEmail = `regen-candidate-${suffix}@example.test`;
const interviewerEmail = `regen-interviewer-${suffix}@example.test`;

let eventId = null;
let interviewerId = null;

const timeSlots = ["10:00", "10:30", "11:00"];

const baseInput = {
  eventName: `Availability Regeneration Test ${suffix}`,
  eventDate: "2027-01-15",
  timeSlots,

  candidates: [
    {
      id: "candidate-test",
      name: "Regeneration Test Candidate",
      email: candidateEmail,
      availableSlots: [...timeSlots],
    },
  ],

  interviewers: [
    {
      id: "interviewer-test",
      name: "Regeneration Test Interviewer",
      email: interviewerEmail,
      skills: ["DSA"],
      availableSlots: [...timeSlots],
      maxInterviewsPerDay: 2,
    },
  ],

  rooms: [
    {
      id: "room-test",
      name: "Regeneration Test Room",
      availableSlots: [...timeSlots],
    },
  ],

  tasks: [
    {
      id: "task-test",
      candidateId: "candidate-test",
      roundName: "Coding Interview",
      requiredSkills: ["DSA"],
      durationSlots: 1,
    },
  ],
};

async function cleanup() {
  // Remove interviewer assignments before deleting their parent records.
  // This also cleans up records left by the previous failed cleanup.
  await pool.query(
    `DELETE FROM scheduled_interview_interviewers sii
     USING recruitment_events e
     WHERE sii.event_id = e.event_id
       AND e.event_name LIKE 'Availability Regeneration Test %'`
  );

  // Delete only events created by this dedicated test.
  await pool.query(
    `DELETE FROM recruitment_events
     WHERE event_name LIKE 'Availability Regeneration Test %'`
  );

  // Clean up test-only candidate and interviewer profiles.
  await pool.query(
    `DELETE FROM candidates
     WHERE email LIKE 'regen-candidate-%@example.test'`
  );

  await pool.query(
    `DELETE FROM interviewers
     WHERE email LIKE 'regen-interviewer-%@example.test'`
  );
}

async function main() {
  let cleanupError = null;

  try {
    console.log("\nChronos availability regeneration test\n");

    // 1. Create an event and its initial successful schedule.
    const initialResult = generateSchedule(baseInput);

    assert.equal(
      initialResult.success,
      true,
      `Initial schedule failed: ${JSON.stringify(initialResult)}`
    );

    const initialPersistence = await persistScheduleRun({
      input: baseInput,
      result: initialResult,
    });

    eventId = initialPersistence.eventId;

    assert.equal(initialPersistence.schedulePersisted, true);

    console.log("PASS: Creates the initial draft schedule");

    // 2. Find the persistent interviewer profile.
    const profileResult = await pool.query(
      `SELECT interviewer_id
       FROM interviewers
       WHERE email = $1`,
      [interviewerEmail]
    );

    assert.equal(profileResult.rowCount, 1);

    interviewerId = profileResult.rows[0].interviewer_id;

    console.log("PASS: Creates a persistent interviewer profile");

    // 3. Simulate an interviewer explicitly selecting only 10:30.
    await pool.query(
      `INSERT INTO interviewer_availability_submissions
         (event_id, interviewer_id)
       VALUES ($1, $2)`,
      [eventId, interviewerId]
    );

    await pool.query(
      `INSERT INTO interviewer_availability_submission_slots
         (event_id, interviewer_id, slot_time)
       VALUES ($1, $2, $3::time)`,
      [eventId, interviewerId, "10:30"]
    );

    await pool.query(
      `DELETE FROM interviewer_availability
       WHERE event_id = $1 AND interviewer_id = $2`,
      [eventId, interviewerId]
    );

    await pool.query(
      `INSERT INTO interviewer_availability
         (event_id, interviewer_id, slot_time)
       VALUES ($1, $2, $3::time)`,
      [eventId, interviewerId, "10:30"]
    );

    console.log("PASS: Stores an explicit interviewer availability submission");

    // 4. Rebuild input using the persistent database identity.
    const regenerationInput = {
      ...baseInput,
      eventId,

      interviewers: [
        {
          ...baseInput.interviewers[0],
          id: interviewerId,
        },
      ],
    };

    const effectiveInput =
      await applySubmittedInterviewerAvailability({
        eventId,
        timeSlots,
        interviewers: regenerationInput.interviewers,
      });

    assert.deepEqual(
      effectiveInput.interviewers[0].availableSlots,
      ["10:30"]
    );

    console.log("PASS: Loads only the interviewer's submitted slots");

    // 5. The scheduler must use the submitted availability.
    const regeneratedResult = generateSchedule({
      timeSlots,
      candidates: regenerationInput.candidates,
      interviewers: effectiveInput.interviewers,
      rooms: regenerationInput.rooms,
      tasks: regenerationInput.tasks,
    });

    assert.equal(
      regeneratedResult.success,
      true,
      `Regenerated schedule failed: ${JSON.stringify(regeneratedResult)}`
    );

    assert.equal(regeneratedResult.schedule.length, 1);
    assert.equal(regeneratedResult.schedule[0].startTime, "10:30");

    console.log("PASS: Scheduler uses the submitted 10:30 slot");

    // 6. Persist the regenerated draft schedule.
    const regeneratedPersistence = await persistScheduleRun({
      input: {
        ...regenerationInput,
        interviewers: effectiveInput.interviewers,
      },
      result: regeneratedResult,
    });

    assert.equal(regeneratedPersistence.eventId, eventId);
    assert.equal(regeneratedPersistence.schedulePersisted, true);

    console.log("PASS: Regenerates the existing draft event");

    // 7. Confirm the submitted slot remains in the database.
    const availabilityResult = await pool.query(
      `SELECT to_char(slot_time, 'HH24:MI') AS time
       FROM interviewer_availability
       WHERE event_id = $1 AND interviewer_id = $2
       ORDER BY slot_time`,
      [eventId, interviewerId]
    );

    assert.deepEqual(
      availabilityResult.rows.map((row) => row.time),
      ["10:30"]
    );

    const submissionResult = await pool.query(
      `SELECT to_char(slot_time, 'HH24:MI') AS time
       FROM interviewer_availability_submission_slots
       WHERE event_id = $1 AND interviewer_id = $2
       ORDER BY slot_time`,
      [eventId, interviewerId]
    );

    assert.deepEqual(
      submissionResult.rows.map((row) => row.time),
      ["10:30"]
    );

    console.log("PASS: Submitted availability survives regeneration");

    // 8. Confirm the original interviewer profile is still assigned.
    const assignmentResult = await pool.query(
      `SELECT interviewer_id
       FROM event_interviewers
       WHERE event_id = $1 AND interviewer_id = $2`,
      [eventId, interviewerId]
    );

    assert.equal(assignmentResult.rowCount, 1);

    const scheduleResult = await pool.query(
      `SELECT
         to_char(si.start_time, 'HH24:MI') AS "startTime",
         sii.interviewer_id AS "interviewerId"
       FROM scheduled_interviews si
       JOIN scheduled_interview_interviewers sii
         ON sii.event_id = si.event_id
        AND sii.schedule_id = si.schedule_id
       WHERE si.event_id = $1`,
      [eventId]
    );

    assert.equal(scheduleResult.rowCount, 1);
    assert.equal(scheduleResult.rows[0].startTime, "10:30");
    assert.equal(scheduleResult.rows[0].interviewerId, interviewerId);

    console.log("PASS: Keeps the original interviewer assigned");
  } catch (error) {
    console.error("\nFAIL:", error.message);
    process.exitCode = 1;
  } finally {
    try {
      await cleanup();
    } catch (error) {
      cleanupError = error;
      console.error("Cleanup failed:", error.message);
      process.exitCode = 1;
    }

    await pool.end();
  }

  if (!cleanupError && process.exitCode !== 1) {
    console.log("\nTest summary: 8 checks passed, 0 failed.");
  }
}

main().catch(async (error) => {
  console.error("Unexpected test error:", error);
  process.exitCode = 1;

  try {
    await cleanup();
  } catch (cleanupError) {
    console.error("Cleanup failed:", cleanupError.message);
  }

  await pool.end();
});