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

// GET /api/candidate/interviews
// List the authenticated candidate's interviews in published events.
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
// Confirm the candidate's own published interview.
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

    // Lock this interview row to prevent simultaneous duplicate bookings.
    // Ownership is checked using the candidate ID from the verified session.
    const interviewResult = await client.query(
      `SELECT
         si.schedule_id AS "scheduleId",
         si.event_id AS "eventId",
         si.status AS "bookingStatus",
         e.event_name AS "eventName",
         e.status AS "eventStatus",
         it.round_name AS "roundName",
         to_char(e.event_date, 'YYYY-MM-DD') AS "eventDate",
         to_char(si.start_time, 'HH24:MI') AS "startTime",
         to_char(si.end_time, 'HH24:MI') AS "endTime"
       FROM scheduled_interviews si
       JOIN recruitment_events e
         ON e.event_id = si.event_id
       JOIN interview_tasks it
         ON it.event_id = si.event_id
        AND it.task_id = si.task_id
       WHERE si.schedule_id = $1
         AND it.candidate_id = $2
       FOR UPDATE OF si`,
      [scheduleId, candidateId]
    );

    // Do not disclose whether an interview belongs to another candidate.
    if (interviewResult.rowCount === 0) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(404).json({
        success: false,
        error: "The requested interview was not found for your account.",
      });
    }

    const interview = interviewResult.rows[0];

    if (interview.eventStatus !== "published") {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(409).json({
        success: false,
        error: "This recruitment event is not open for booking.",
      });
    }

    if (interview.bookingStatus === "booked") {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(409).json({
        success: false,
        error: "This interview has already been booked.",
      });
    }

    if (interview.bookingStatus !== "published") {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(409).json({
        success: false,
        error: "This interview is not available for booking.",
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
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(409).json({
        success: false,
        error: "The interview could not be booked. Refresh and try again.",
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
        eventName: interview.eventName,
        eventDate: interview.eventDate,
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