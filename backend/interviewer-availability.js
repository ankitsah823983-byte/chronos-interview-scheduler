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

function isValidTime(value) {
  return (
    typeof value === "string" &&
    /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
  );
}

function getInterviewerId(req, res) {
  const interviewerId = req.user?.interviewerId;

  if (!isValidUuid(interviewerId)) {
    res.status(403).json({
      success: false,
      error: "Your account is not linked to a valid interviewer profile.",
    });

    return null;
  }

  return interviewerId;
}

// GET /api/interviewer/events
// List only events assigned to the authenticated interviewer.
router.get("/events", async (req, res) => {
  const interviewerId = getInterviewerId(req, res);

  if (!interviewerId) return;

  try {
    const result = await pool.query(
      `SELECT
         e.event_id AS "eventId",
         e.event_name AS "eventName",
         to_char(e.event_date, 'YYYY-MM-DD') AS "eventDate",
         e.status,
         e.created_at AS "createdAt",
         EXISTS (
           SELECT 1
           FROM interviewer_availability_submissions submission
           WHERE submission.event_id = e.event_id
             AND submission.interviewer_id = ei.interviewer_id
         ) AS "hasSubmitted",
         (
           SELECT submission.submitted_at
           FROM interviewer_availability_submissions submission
           WHERE submission.event_id = e.event_id
             AND submission.interviewer_id = ei.interviewer_id
         ) AS "submittedAt",
         COALESCE(
           (
             SELECT array_agg(
               to_char(ts.slot_time, 'HH24:MI')
               ORDER BY ts.slot_time
             )
             FROM event_time_slots ts
             WHERE ts.event_id = e.event_id
           ),
           ARRAY[]::text[]
         ) AS "eventTimeSlots",
         CASE
           WHEN EXISTS (
             SELECT 1
             FROM interviewer_availability_submissions submission
             WHERE submission.event_id = e.event_id
               AND submission.interviewer_id = ei.interviewer_id
           )
           THEN COALESCE(
             (
               SELECT array_agg(
                 to_char(selected.slot_time, 'HH24:MI')
                 ORDER BY selected.slot_time
               )
               FROM interviewer_availability_submission_slots selected
               WHERE selected.event_id = e.event_id
                 AND selected.interviewer_id = ei.interviewer_id
             ),
             ARRAY[]::text[]
           )
           ELSE COALESCE(
             (
               SELECT array_agg(
                 to_char(availability.slot_time, 'HH24:MI')
                 ORDER BY availability.slot_time
               )
               FROM interviewer_availability availability
               WHERE availability.event_id = e.event_id
                 AND availability.interviewer_id = ei.interviewer_id
             ),
             ARRAY[]::text[]
           )
         END AS "availableSlots"
       FROM event_interviewers ei
       JOIN recruitment_events e
         ON e.event_id = ei.event_id
       WHERE ei.interviewer_id = $1
       ORDER BY e.event_date, e.created_at DESC`,
      [interviewerId]
    );

    return res.json({
      success: true,
      events: result.rows,
      total: result.rowCount,
    });
  } catch (error) {
    console.error("Failed to list interviewer events:", error);

    return res.status(500).json({
      success: false,
      error: "Could not retrieve your assigned events.",
    });
  }
});

// GET /api/interviewer/events/:eventId/availability
// Return valid time slots and the interviewer's current selection.
router.get("/events/:eventId/availability", async (req, res) => {
  const interviewerId = getInterviewerId(req, res);

  if (!interviewerId) return;

  const { eventId } = req.params;

  if (!isValidUuid(eventId)) {
    return res.status(400).json({
      success: false,
      error: "Event ID must be a valid UUID.",
    });
  }

  try {
    const eventResult = await pool.query(
      `SELECT
         e.event_id AS "eventId",
         e.event_name AS "eventName",
         to_char(e.event_date, 'YYYY-MM-DD') AS "eventDate",
         e.status,
         EXISTS (
           SELECT 1
           FROM interviewer_availability_submissions submission
           WHERE submission.event_id = e.event_id
             AND submission.interviewer_id = ei.interviewer_id
         ) AS "hasSubmitted",
         (
           SELECT submission.submitted_at
           FROM interviewer_availability_submissions submission
           WHERE submission.event_id = e.event_id
             AND submission.interviewer_id = ei.interviewer_id
         ) AS "submittedAt"
       FROM event_interviewers ei
       JOIN recruitment_events e
         ON e.event_id = ei.event_id
       WHERE ei.event_id = $1
         AND ei.interviewer_id = $2`,
      [eventId, interviewerId]
    );

    if (eventResult.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: "This event is not assigned to your interviewer profile.",
      });
    }

    const event = eventResult.rows[0];

    const slotsResult = await pool.query(
      `SELECT
         to_char(ts.slot_time, 'HH24:MI') AS time,
         CASE
           WHEN $3::boolean THEN EXISTS (
             SELECT 1
             FROM interviewer_availability_submission_slots selected
             WHERE selected.event_id = ts.event_id
               AND selected.interviewer_id = $2
               AND selected.slot_time = ts.slot_time
           )
           ELSE EXISTS (
             SELECT 1
             FROM interviewer_availability availability
             WHERE availability.event_id = ts.event_id
               AND availability.interviewer_id = $2
               AND availability.slot_time = ts.slot_time
           )
         END AS selected
       FROM event_time_slots ts
       WHERE ts.event_id = $1
       ORDER BY ts.slot_time`,
      [eventId, interviewerId, event.hasSubmitted]
    );

    return res.json({
      success: true,
      event,
      editable: event.status === "draft",
      timeSlots: slotsResult.rows,
      availableSlots: slotsResult.rows
        .filter((slot) => slot.selected)
        .map((slot) => slot.time),
    });
  } catch (error) {
    console.error("Failed to load interviewer availability:", error);

    return res.status(500).json({
      success: false,
      error: "Could not retrieve your availability.",
    });
  }
});

// POST /api/interviewer/events/:eventId/availability
// Submit or replace availability for an assigned draft event.
router.post("/events/:eventId/availability", async (req, res) => {
  const interviewerId = getInterviewerId(req, res);

  if (!interviewerId) return;

  const { eventId } = req.params;
  const { availableSlots } = req.body || {};

  if (!isValidUuid(eventId)) {
    return res.status(400).json({
      success: false,
      error: "Event ID must be a valid UUID.",
    });
  }

  if (
    !Array.isArray(availableSlots) ||
    !availableSlots.every(isValidTime)
  ) {
    return res.status(400).json({
      success: false,
      error:
        "availableSlots must be an array of valid 24-hour times, such as 10:00 or 14:30.",
    });
  }

  if (new Set(availableSlots).size !== availableSlots.length) {
    return res.status(400).json({
      success: false,
      error: "Duplicate time slots are not allowed.",
    });
  }

  let client;
  let transactionStarted = false;

  try {
    client = await pool.connect();
    await client.query("BEGIN");
    transactionStarted = true;

    // Serialize submissions against draft regeneration and publishing.
    const eventResult = await client.query(
      `SELECT event_id, status
       FROM recruitment_events
       WHERE event_id = $1
       FOR UPDATE`,
      [eventId]
    );

    if (eventResult.rowCount === 0) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(404).json({
        success: false,
        error: "Recruitment event not found.",
      });
    }

    if (eventResult.rows[0].status !== "draft") {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(409).json({
        success: false,
        error: "Availability can only be changed while the event is a draft.",
      });
    }

    const assignmentResult = await client.query(
      `SELECT 1
       FROM event_interviewers
       WHERE event_id = $1
         AND interviewer_id = $2`,
      [eventId, interviewerId]
    );

    if (assignmentResult.rowCount === 0) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(404).json({
        success: false,
        error: "This event is not assigned to your interviewer profile.",
      });
    }

    const eventSlotsResult = await client.query(
      `SELECT to_char(slot_time, 'HH24:MI') AS time
       FROM event_time_slots
       WHERE event_id = $1
       ORDER BY slot_time`,
      [eventId]
    );

    const validSlots = new Set(
      eventSlotsResult.rows.map((row) => row.time)
    );

    if (availableSlots.some((slot) => !validSlots.has(slot))) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(400).json({
        success: false,
        error: "One or more selected times do not belong to this event.",
      });
    }

    const submissionResult = await client.query(
      `INSERT INTO interviewer_availability_submissions
         (event_id, interviewer_id, submitted_at)
       VALUES ($1, $2, now())
       ON CONFLICT (event_id, interviewer_id)
       DO UPDATE SET submitted_at = now()
       RETURNING submitted_at AS "submittedAt"`,
      [eventId, interviewerId]
    );

    await client.query(
      `DELETE FROM interviewer_availability_submission_slots
       WHERE event_id = $1 AND interviewer_id = $2`,
      [eventId, interviewerId]
    );

    await client.query(
      `DELETE FROM interviewer_availability
       WHERE event_id = $1 AND interviewer_id = $2`,
      [eventId, interviewerId]
    );

    for (const slot of availableSlots) {
      await client.query(
        `INSERT INTO interviewer_availability_submission_slots
           (event_id, interviewer_id, slot_time)
         VALUES ($1, $2, $3)`,
        [eventId, interviewerId, slot]
      );

      await client.query(
        `INSERT INTO interviewer_availability
           (event_id, interviewer_id, slot_time)
         VALUES ($1, $2, $3)`,
        [eventId, interviewerId, slot]
      );
    }

    await client.query("COMMIT");
    transactionStarted = false;

    return res.json({
      success: true,
      eventId,
      availableSlots: [...availableSlots].sort(),
      submittedAt: submissionResult.rows[0].submittedAt,
    });
  } catch (error) {
    if (client && transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error(
          "Availability transaction rollback failed:",
          rollbackError
        );
      }
    }

    console.error("Failed to submit interviewer availability:", error);

    return res.status(500).json({
      success: false,
      error: "Could not save your availability.",
    });
  } finally {
    if (client) {
      client.release();
    }
  }
});

module.exports = router;