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

// GET /api/interviewer/interviews
// List only confirmed interviews assigned to the signed-in interviewer.
router.get("/interviews", async (req, res) => {
  const interviewerId = getInterviewerId(req, res);

  if (!interviewerId) return;

  try {
    const result = await pool.query(
      `SELECT
         si.schedule_id::text AS "scheduleId",
         si.event_id AS "eventId",
         e.event_name AS "eventName",
         to_char(e.event_date, 'YYYY-MM-DD') AS "eventDate",
         it.round_name AS "roundName",
         to_char(si.start_time, 'HH24:MI') AS "startTime",
         to_char(si.end_time, 'HH24:MI') AS "endTime",
         si.status AS "bookingStatus",
         c.full_name AS "candidateName",
         c.email AS "candidateEmail",
         COALESCE(r.room_name, '') AS "roomName",
         COALESCE(
           (
             SELECT string_agg(
               DISTINCT i.full_name,
               ', ' ORDER BY i.full_name
             )
             FROM scheduled_interview_interviewers panel
             JOIN interviewers i
               ON i.interviewer_id = panel.interviewer_id
             WHERE panel.event_id = si.event_id
               AND panel.schedule_id = si.schedule_id
           ),
           ''
         ) AS "interviewerNames"
       FROM scheduled_interviews si
       JOIN recruitment_events e
         ON e.event_id = si.event_id
       JOIN interview_tasks it
         ON it.event_id = si.event_id
        AND it.task_id = si.task_id
       JOIN scheduled_interview_interviewers assigned
         ON assigned.event_id = si.event_id
        AND assigned.schedule_id = si.schedule_id
        AND assigned.interviewer_id = $1
       JOIN candidates c
         ON c.candidate_id = it.candidate_id
       LEFT JOIN rooms r
         ON r.event_id = si.event_id
        AND r.room_id = si.room_id
       WHERE e.status = 'published'
         AND si.status = 'booked'
       ORDER BY e.event_date, si.start_time, si.schedule_id`,
      [interviewerId]
    );

    return res.json({
      success: true,
      interviews: result.rows,
      total: result.rowCount,
    });
  } catch (error) {
    console.error("Failed to load interviewer interviews:", error);

    return res.status(500).json({
      success: false,
      error: "Could not retrieve your confirmed interviews.",
    });
  }
});

function escapeInterviewerCalendarText(value) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

function foldInterviewerCalendarLine(line) {
  const result = [];
  let current = "";
  let bytes = 0;

  for (const character of line) {
    const characterBytes = Buffer.byteLength(character, "utf8");

    if (bytes + characterBytes > 75 && current.length > 0) {
      result.push(current);
      current = ` ${character}`;
      bytes = 1 + characterBytes;
    } else {
      current += character;
      bytes += characterBytes;
    }
  }

  if (current.length > 0) {
    result.push(current);
  }

  return result;
}

function formatInterviewerCalendarDateTime(date, time) {
  return `${date.replace(/-/g, "")}T${time.replace(/:/g, "")}`;
}

// GET /api/interviewer/interviews/:scheduleId/calendar
// The schedule must actually be assigned to the authenticated interviewer.
router.get("/interviews/:scheduleId/calendar", async (req, res) => {
  const interviewerId = getInterviewerId(req, res);

  if (!interviewerId) return;

  const { scheduleId } = req.params;

  if (!isValidScheduleId(scheduleId)) {
    return res.status(400).json({
      success: false,
      error: "A valid interview schedule ID is required.",
    });
  }

  try {
    const result = await pool.query(
      `SELECT
         si.schedule_id::text AS "scheduleId",
         si.status AS "bookingStatus",
         e.status AS "eventStatus",
         e.event_name AS "eventName",
         to_char(e.event_date, 'YYYY-MM-DD') AS "eventDate",
         it.round_name AS "roundName",
         to_char(si.start_time, 'HH24:MI:SS') AS "startTime",
         to_char(si.end_time, 'HH24:MI:SS') AS "endTime",
         c.full_name AS "candidateName",
         c.email AS "candidateEmail",
         COALESCE(r.room_name, '') AS "roomName",
         COALESCE(
           (
             SELECT string_agg(
               DISTINCT i.full_name,
               ', ' ORDER BY i.full_name
             )
             FROM scheduled_interview_interviewers panel
             JOIN interviewers i
               ON i.interviewer_id = panel.interviewer_id
             WHERE panel.event_id = si.event_id
               AND panel.schedule_id = si.schedule_id
           ),
           ''
         ) AS "interviewerNames"
       FROM scheduled_interviews si
       JOIN recruitment_events e
         ON e.event_id = si.event_id
       JOIN interview_tasks it
         ON it.event_id = si.event_id
        AND it.task_id = si.task_id
       JOIN scheduled_interview_interviewers assigned
         ON assigned.event_id = si.event_id
        AND assigned.schedule_id = si.schedule_id
        AND assigned.interviewer_id = $2
       JOIN candidates c
         ON c.candidate_id = it.candidate_id
       LEFT JOIN rooms r
         ON r.event_id = si.event_id
        AND r.room_id = si.room_id
       WHERE si.schedule_id = $1`,
      [scheduleId, interviewerId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: "This interview was not found for your interviewer profile.",
      });
    }

    const interview = result.rows[0];

    if (
      interview.eventStatus !== "published" ||
      interview.bookingStatus !== "booked"
    ) {
      return res.status(409).json({
        success: false,
        error: "A calendar invite is available only for a confirmed interview.",
      });
    }

    const start = formatInterviewerCalendarDateTime(
      interview.eventDate,
      interview.startTime
    );

    const end = formatInterviewerCalendarDateTime(
      interview.eventDate,
      interview.endTime
    );

    const description = [
      `Candidate: ${interview.candidateName}`,
      `Candidate email: ${interview.candidateEmail}`,
      `Interviewers: ${interview.interviewerNames}`,
      `Round: ${interview.roundName}`,
      `Room: ${interview.roomName || "To be confirmed"}`,
      `Event: ${interview.eventName}`,
    ].join("\n");

    const timestamp = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "Z");

    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Chronos//Interview Scheduler//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VTIMEZONE",
      "TZID:Asia/Kolkata",
      "X-LIC-LOCATION:Asia/Kolkata",
      "BEGIN:STANDARD",
      "DTSTART:19700101T000000",
      "TZOFFSETFROM:+0530",
      "TZOFFSETTO:+0530",
      "TZNAME:IST",
      "END:STANDARD",
      "END:VTIMEZONE",
      "BEGIN:VEVENT",
      `UID:chronos-${interview.scheduleId}@chronos.local`,
      `DTSTAMP:${timestamp}`,
      `DTSTART;TZID=Asia/Kolkata:${start}`,
      `DTEND;TZID=Asia/Kolkata:${end}`,
      `SUMMARY:${escapeInterviewerCalendarText(
        `${interview.eventName} - ${interview.roundName}`
      )}`,
      `DESCRIPTION:${escapeInterviewerCalendarText(description)}`,
      `LOCATION:${escapeInterviewerCalendarText(
        interview.roomName || "To be confirmed"
      )}`,
      "STATUS:CONFIRMED",
      "TRANSP:OPAQUE",
      "END:VEVENT",
      "END:VCALENDAR",
    ];

    const calendarContent =
      lines.flatMap(foldInterviewerCalendarLine).join("\r\n") + "\r\n";

    res.set("Content-Type", "text/calendar; charset=utf-8");
    res.set(
      "Content-Disposition",
      `attachment; filename="chronos-interview-${scheduleId}.ics"`
    );
    res.set("Cache-Control", "no-store");

    return res.send(calendarContent);
  } catch (error) {
    console.error("Failed to generate interviewer calendar file:", error);

    return res.status(500).json({
      success: false,
      error: "Could not generate the interview calendar file.",
    });
  }
});

module.exports = router;