
const express = require("express");
const pool = require("./db");

const router = express.Router();

function isValidUuid(value) {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value
    )
  );
}

function isValidScheduleId(value) {
  if (
    typeof value !== "string" ||
    !/^[1-9]\d*$/.test(value) ||
    value.length > 19
  ) {
    return false;
  }

  try {
    return BigInt(value) <= 9223372036854775807n;
  } catch {
    return false;
  }
}

function getCandidateId(req, res) {
  const candidateId = req.user?.candidateId;

  if (!isValidUuid(candidateId)) {
    res.status(403).json({
      success: false,
      error: "Your account is not linked to a valid candidate profile.",
    });

    return null;
  }

  return candidateId;
}

async function rollback(client, transactionStarted) {
  if (!transactionStarted) return false;

  await client.query("ROLLBACK");
  return false;
}

// GET /api/candidate/interviews
// Show published options and confirmed/cancelled interviews.
// Unavailable alternatives are hidden from candidates.
router.get("/interviews", async (req, res) => {
  const candidateId = getCandidateId(req, res);

  if (!candidateId) return;

  try {
    const result = await pool.query(
      `SELECT
         si.schedule_id AS "scheduleId",
         si.event_id AS "eventId",
         e.event_name AS "eventName",
         to_char(e.event_date, 'YYYY-MM-DD') AS "eventDate",
         it.round_name AS "roundName",
         to_char(si.start_time, 'HH24:MI') AS "startTime",
         to_char(si.end_time, 'HH24:MI') AS "endTime",
         si.status AS "bookingStatus",
         r.room_name AS "roomName",
         COALESCE(
           (
             SELECT string_agg(DISTINCT i.full_name, ', ' ORDER BY i.full_name)
             FROM scheduled_interview_interviewers sii
             JOIN interviewers i
               ON i.interviewer_id = sii.interviewer_id
             WHERE sii.event_id = si.event_id
               AND sii.schedule_id = si.schedule_id
           ),
           ''
         ) AS "interviewerNames"
       FROM scheduled_interviews si
       JOIN recruitment_events e
         ON e.event_id = si.event_id
       JOIN interview_tasks it
         ON it.event_id = si.event_id
        AND it.task_id = si.task_id
       LEFT JOIN rooms r
         ON r.event_id = si.event_id
        AND r.room_id = si.room_id
       WHERE it.candidate_id = $1
         AND e.status = 'published'
         AND si.status IN ('published', 'booked', 'cancelled')
       ORDER BY e.event_date, si.start_time, si.schedule_id`,
      [candidateId]
    );

    return res.json({
      success: true,
      interviews: result.rows,
      total: result.rowCount,
    });
  } catch (error) {
    console.error("Failed to load candidate interviews:", error);

    return res.status(500).json({
      success: false,
      error: "Could not retrieve your published interviews.",
    });
  }
});

// POST /api/candidate/interviews/:scheduleId/book
// Confirm one option atomically and retire conflicting alternatives.
router.post("/interviews/:scheduleId/book", async (req, res) => {
  const candidateId = getCandidateId(req, res);

  if (!candidateId) return;

  const { scheduleId } = req.params;

  if (!isValidScheduleId(scheduleId)) {
    return res.status(400).json({
      success: false,
      error: "A valid interview schedule ID is required.",
    });
  }

  let client;
  let transactionStarted = false;

  try {
    client = await pool.connect();

    await client.query("BEGIN");
    transactionStarted = true;

    // Resolve ownership without revealing another candidate's interviews.
    const ownerResult = await client.query(
      `SELECT si.event_id AS "eventId"
       FROM scheduled_interviews si
       JOIN interview_tasks it
         ON it.event_id = si.event_id
        AND it.task_id = si.task_id
       WHERE si.schedule_id = $1
         AND it.candidate_id = $2`,
      [scheduleId, candidateId]
    );

    if (ownerResult.rowCount === 0) {
      transactionStarted = await rollback(client, transactionStarted);

      return res.status(404).json({
        success: false,
        error: "The requested interview was not found for your account.",
      });
    }

    const eventId = ownerResult.rows[0].eventId;

    // Serialize bookings so simultaneous requests cannot reserve the same
    // resources or make conflicting decisions.
    await client.query(
      "SELECT pg_advisory_xact_lock($1, $2)",
      [42871, 17]
    );

    // Lock the event before locking the selected interview row.
    const eventResult = await client.query(
      `SELECT
         event_id AS "eventId",
         event_name AS "eventName",
         event_date AS "eventDate",
         status AS "eventStatus"
       FROM recruitment_events
       WHERE event_id = $1
       FOR UPDATE`,
      [eventId]
    );

    if (eventResult.rowCount === 0) {
      transactionStarted = await rollback(client, transactionStarted);

      return res.status(404).json({
        success: false,
        error: "The requested interview was not found for your account.",
      });
    }

    const event = eventResult.rows[0];

    if (event.eventStatus !== "published") {
      transactionStarted = await rollback(client, transactionStarted);

      return res.status(409).json({
        success: false,
        error: "This recruitment event is not open for booking.",
      });
    }

    const interviewResult = await client.query(
      `SELECT
         si.schedule_id AS "scheduleId",
         si.event_id AS "eventId",
         si.task_id AS "taskId",
         si.room_id AS "roomId",
         si.start_time AS "startTimeValue",
         si.end_time AS "endTimeValue",
         to_char(si.start_time, 'HH24:MI') AS "startTime",
         to_char(si.end_time, 'HH24:MI') AS "endTime",
         si.status AS "bookingStatus",
         it.candidate_id AS "candidateId",
         it.round_name AS "roundName"
       FROM scheduled_interviews si
       JOIN interview_tasks it
         ON it.event_id = si.event_id
        AND it.task_id = si.task_id
       WHERE si.schedule_id = $1
         AND si.event_id = $2
         AND it.candidate_id = $3
       FOR UPDATE OF si`,
      [scheduleId, eventId, candidateId]
    );

    if (interviewResult.rowCount === 0) {
      transactionStarted = await rollback(client, transactionStarted);

      return res.status(404).json({
        success: false,
        error: "The requested interview was not found for your account.",
      });
    }

    const interview = interviewResult.rows[0];

    if (interview.bookingStatus === "booked") {
      transactionStarted = await rollback(client, transactionStarted);

      return res.status(409).json({
        success: false,
        error: "This interview option has already been booked.",
      });
    }

    if (interview.bookingStatus !== "published") {
      transactionStarted = await rollback(client, transactionStarted);

      return res.status(409).json({
        success: false,
        error: "This interview option is no longer available for booking.",
      });
    }

    // Enforce one confirmed option per task.
    const existingTaskBooking = await client.query(
      `SELECT schedule_id
       FROM scheduled_interviews
       WHERE event_id = $1
         AND task_id = $2
         AND status = 'booked'
       LIMIT 1`,
      [interview.eventId, interview.taskId]
    );

    if (existingTaskBooking.rowCount > 0) {
      transactionStarted = await rollback(client, transactionStarted);

      return res.status(409).json({
        success: false,
        error: "You have already booked an option for this interview round.",
      });
    }

    const interviewerResult = await client.query(
      `SELECT interviewer_id AS "interviewerId"
       FROM scheduled_interview_interviewers
       WHERE event_id = $1
         AND schedule_id = $2
       ORDER BY interviewer_id`,
      [interview.eventId, interview.scheduleId]
    );

    const interviewerIds = interviewerResult.rows.map(
      (row) => row.interviewerId
    );

    if (interviewerIds.length === 0) {
      transactionStarted = await rollback(client, transactionStarted);

      return res.status(409).json({
        success: false,
        error: "This interview option has no assigned interviewer and cannot be booked.",
      });
    }

    // Check already-booked interviews on the same date. Candidate and
    // interviewer profiles are global; room IDs belong to a specific event.
    const conflictResult = await client.query(
      `SELECT 1
       FROM scheduled_interviews other
       JOIN recruitment_events other_event
         ON other_event.event_id = other.event_id
       JOIN interview_tasks other_task
         ON other_task.event_id = other.event_id
        AND other_task.task_id = other.task_id
       WHERE other.status = 'booked'
         AND other.schedule_id <> $1
         AND other_event.event_date = $2::date
         AND other.start_time < $4::time
         AND other.end_time > $3::time
         AND (
           other_task.candidate_id = $5::uuid
           OR (
             other.event_id = $6::uuid
             AND other.room_id = $7::uuid
           )
           OR EXISTS (
             SELECT 1
             FROM scheduled_interview_interviewers other_interviewer
             WHERE other_interviewer.event_id = other.event_id
               AND other_interviewer.schedule_id = other.schedule_id
               AND other_interviewer.interviewer_id = ANY($8::uuid[])
           )
         )
       LIMIT 1`,
      [
        scheduleId,
        event.eventDate,
        interview.startTimeValue,
        interview.endTimeValue,
        candidateId,
        interview.eventId,
        interview.roomId,
        interviewerIds,
      ]
    );

    if (conflictResult.rowCount > 0) {
      transactionStarted = await rollback(client, transactionStarted);

      return res.status(409).json({
        success: false,
        error:
          "This time conflicts with another confirmed interview for you, an interviewer, or the room. Please choose another option.",
      });
    }

    const updateResult = await client.query(
      `UPDATE scheduled_interviews
       SET status = 'booked'
       WHERE event_id = $1
         AND schedule_id = $2
         AND status = 'published'
       RETURNING status`,
      [interview.eventId, scheduleId]
    );

    if (updateResult.rowCount !== 1) {
      transactionStarted = await rollback(client, transactionStarted);

      return res.status(409).json({
        success: false,
        error: "The interview could not be booked. Refresh and try again.",
      });
    }

    // The candidate must choose exactly one option for this task.
    await client.query(
      `UPDATE scheduled_interviews
       SET status = 'unavailable'
       WHERE event_id = $1
         AND task_id = $2
         AND schedule_id <> $3
         AND status = 'published'`,
      [interview.eventId, interview.taskId, scheduleId]
    );

    // Retire other published options which now overlap the confirmed
    // candidate, interviewer(s), or room.
    await client.query(
      `UPDATE scheduled_interviews AS option
       SET status = 'unavailable'
       FROM recruitment_events option_event,
            interview_tasks option_task
       WHERE option.event_id = option_event.event_id
         AND option.event_id = option_task.event_id
         AND option.task_id = option_task.task_id
         AND option_event.event_date = $1::date
         AND option.status = 'published'
         AND option.schedule_id <> $2
         AND option.start_time < $4::time
         AND option.end_time > $3::time
         AND (
           option_task.candidate_id = $5::uuid
           OR EXISTS (
             SELECT 1
             FROM scheduled_interview_interviewers option_interviewer
             WHERE option_interviewer.event_id = option.event_id
               AND option_interviewer.schedule_id = option.schedule_id
               AND option_interviewer.interviewer_id = ANY($6::uuid[])
           )
           OR (
             option.event_id = $7::uuid
             AND option.room_id = $8::uuid
           )
         )`,
      [
        event.eventDate,
        scheduleId,
        interview.startTimeValue,
        interview.endTimeValue,
        candidateId,
        interviewerIds,
        interview.eventId,
        interview.roomId,
      ]
    );

    // Refuse a choice that would strand another task without a remaining
    // option. Rolling back restores the option statuses if that happens.
    const strandedTaskResult = await client.query(
      `SELECT task.task_id AS "taskId"
       FROM interview_tasks task
       WHERE task.event_id = $1
         AND NOT EXISTS (
           SELECT 1
           FROM scheduled_interviews booked
           WHERE booked.event_id = task.event_id
             AND booked.task_id = task.task_id
             AND booked.status = 'booked'
         )
         AND NOT EXISTS (
           SELECT 1
           FROM scheduled_interviews available
           WHERE available.event_id = task.event_id
             AND available.task_id = task.task_id
             AND available.status = 'published'
         )
       ORDER BY task.task_id
       LIMIT 1`,
      [interview.eventId]
    );

    if (strandedTaskResult.rowCount > 0) {
      transactionStarted = await rollback(client, transactionStarted);

      return res.status(409).json({
        success: false,
        error:
          "This choice would leave another interview round without an available option. Please choose a different time.",
      });
    }

    await client.query("COMMIT");
    transactionStarted = false;

    return res.json({
      success: true,
      message: "Your interview has been booked successfully.",
      interview: {
        scheduleId: interview.scheduleId,
        eventId: interview.eventId,
        eventName: event.eventName,
        eventDate: event.eventDate instanceof Date
          ? event.eventDate.toISOString().slice(0, 10)
          : String(event.eventDate).slice(0, 10),
        roundName: interview.roundName,
        startTime: interview.startTime,
        endTime: interview.endTime,
        bookingStatus: "booked",
      },
    });
  } catch (error) {
    if (client && transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error(
          "Candidate booking transaction rollback failed:",
          rollbackError
        );
      }
    }

    console.error("Failed to book candidate interview:", error);

    return res.status(500).json({
      success: false,
      error: "Could not book your interview.",
    });
  } finally {
    if (client) {
      client.release();
    }
  }
});

module.exports = router;
