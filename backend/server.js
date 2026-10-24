
const express = require("express");
const cors = require("cors");

const pool = require("./db");
const { generateSchedule } = require("./scheduler");
const { persistScheduleRun } = require("./persistence");

const app = express();
const PORT = 5000;

app.use(
  cors({
    origin: "http://localhost:5173",
  })
);

app.use(express.json({ limit: "1mb" }));

function isValidUuid(value) {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value
    )
  );
}

app.get("/", (req, res) => {
  res.json({
    message: "Welcome to Chronos Interview Scheduler API!",
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    message: "Chronos backend is running.",
  });
});

// Generate a schedule and save the run transactionally.
app.post("/api/schedule", async (req, res) => {
  const {
    eventName,
    eventDate,
    timeSlots,
    candidates,
    interviewers,
    rooms,
    tasks,
  } = req.body || {};

  const inputs = [
    timeSlots,
    candidates,
    interviewers,
    rooms,
    tasks,
  ];

  if (!inputs.every(Array.isArray)) {
    return res.status(400).json({
      success: false,
      error: "All scheduling input fields must be arrays.",
    });
  }

  if (inputs.some((items) => items.length === 0)) {
    return res.status(400).json({
      success: false,
      error: "All scheduling input arrays must contain at least one item.",
    });
  }

  if (
    typeof eventName !== "string" ||
    eventName.trim().length === 0
  ) {
    return res.status(400).json({
      success: false,
      error: "Event name is required.",
    });
  }

  const dateObject =
    typeof eventDate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(eventDate)
      ? new Date(`${eventDate}T00:00:00.000Z`)
      : null;

  const validEventDate =
    dateObject !== null &&
    !Number.isNaN(dateObject.getTime()) &&
    dateObject.toISOString().slice(0, 10) === eventDate;

  if (!validEventDate) {
    return res.status(400).json({
      success: false,
      error: "Event date must be a valid date in YYYY-MM-DD format.",
    });
  }

  let result;

  try {
    result = generateSchedule({
      timeSlots,
      candidates,
      interviewers,
      rooms,
      tasks,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error.message || "Invalid scheduling input.",
    });
  }

  try {
    const persistence = await persistScheduleRun({
      input: {
        eventName: eventName.trim(),
        eventDate,
        timeSlots,
        candidates,
        interviewers,
        rooms,
        tasks,
      },
      result,
    });

    return res
      .status(result.success ? 200 : 422)
      .json({
        ...result,
        persistence,
      });
  } catch (error) {
    console.error("Failed to save scheduling run:", error);

    return res.status(500).json({
      success: false,
      error:
        "The scheduling result could not be saved to the database. " +
        "Check the backend logs and database configuration.",
    });
  }
});

// Retrieve a previously saved schedule and event status.
app.get("/api/schedules/:eventId", async (req, res) => {
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
         event_id AS "eventId",
         event_name AS "eventName",
         to_char(event_date, 'YYYY-MM-DD') AS "eventDate",
         status,
         created_at AS "createdAt"
       FROM recruitment_events
       WHERE event_id = $1`,
      [eventId]
    );

    if (eventResult.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: "Scheduling event not found.",
      });
    }

    const scheduleResult = await pool.query(
      `SELECT
         si.schedule_id AS "interviewId",
         it.task_id AS "taskId",
         it.candidate_id AS "candidateId",
         c.full_name AS "candidateName",
         it.round_name AS "roundName",
         COALESCE(
           string_agg(
             DISTINCT i.full_name,
             ', ' ORDER BY i.full_name
           ),
           ''
         ) AS "interviewerName",
         COALESCE(
           array_agg(
             DISTINCT sii.interviewer_id::text
             ORDER BY sii.interviewer_id::text
           ) FILTER (
             WHERE sii.interviewer_id IS NOT NULL
           ),
           ARRAY[]::text[]
         ) AS "interviewerIds",
         si.room_id AS "roomId",
         r.room_name AS "roomName",
         to_char(si.start_time, 'HH24:MI') AS "startTime",
         to_char(si.end_time, 'HH24:MI') AS "endTime",
         si.status
       FROM scheduled_interviews si
       JOIN interview_tasks it
         ON it.task_id = si.task_id
        AND it.event_id = si.event_id
       JOIN candidates c
         ON c.candidate_id = it.candidate_id
       JOIN rooms r
         ON r.room_id = si.room_id
        AND r.event_id = si.event_id
       LEFT JOIN scheduled_interview_interviewers sii
         ON sii.schedule_id = si.schedule_id
        AND sii.event_id = si.event_id
       LEFT JOIN interviewers i
         ON i.interviewer_id = sii.interviewer_id
       WHERE si.event_id = $1
       GROUP BY
         si.schedule_id,
         it.task_id,
         it.candidate_id,
         c.full_name,
         it.round_name,
         si.room_id,
         r.room_name,
         si.start_time,
         si.end_time,
         si.status
       ORDER BY si.start_time, si.schedule_id`,
      [eventId]
    );

    return res.json({
      success: true,
      event: eventResult.rows[0],
      schedule: scheduleResult.rows,
      savedInterviews: scheduleResult.rowCount,
    });
  } catch (error) {
    console.error("Failed to retrieve saved schedule:", error);

    return res.status(500).json({
      success: false,
      error: "Could not retrieve the saved schedule.",
    });
  }
});

// Publish a valid draft schedule atomically.
app.post("/api/events/:eventId/publish", async (req, res) => {
  const { eventId } = req.params;

  if (!isValidUuid(eventId)) {
    return res.status(400).json({
      success: false,
      error: "Event ID must be a valid UUID.",
    });
  }

  let client;

  try {
    client = await pool.connect();
    await client.query("BEGIN");

    const eventResult = await client.query(
      `SELECT
         event_id AS "eventId",
         event_name AS "eventName",
         to_char(event_date, 'YYYY-MM-DD') AS "eventDate",
         status,
         created_at AS "createdAt"
       FROM recruitment_events
       WHERE event_id = $1
       FOR UPDATE`,
      [eventId]
    );

    if (eventResult.rowCount === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        success: false,
        error: "Scheduling event not found.",
      });
    }

    const event = eventResult.rows[0];

    // Repeated publication is safe and idempotent.
    if (event.status === "published") {
      const countResult = await client.query(
        `SELECT COUNT(*)::int AS count
         FROM scheduled_interviews
         WHERE event_id = $1
           AND status = 'published'`,
        [eventId]
      );

      await client.query("ROLLBACK");

      return res.status(200).json({
        success: true,
        alreadyPublished: true,
        event,
        publishedInterviews: countResult.rows[0].count,
      });
    }

    if (event.status !== "draft") {
      await client.query("ROLLBACK");

      return res.status(409).json({
        success: false,
        error: `Cannot publish an event with status '${event.status}'.`,
      });
    }

    const readinessResult = await client.query(
      `SELECT
         COUNT(*)::int AS total_interviews,
         COUNT(*) FILTER (
           WHERE NOT EXISTS (
             SELECT 1
             FROM scheduled_interview_interviewers sii
             WHERE sii.event_id = si.event_id
               AND sii.schedule_id = si.schedule_id
           )
         )::int AS interviews_without_interviewers,
         COUNT(*) FILTER (
           WHERE si.status <> 'draft'
         )::int AS interviews_not_draft
       FROM scheduled_interviews si
       WHERE si.event_id = $1`,
      [eventId]
    );

    const readiness = readinessResult.rows[0];

    if (readiness.total_interviews === 0) {
      await client.query("ROLLBACK");

      return res.status(409).json({
        success: false,
        error: "Cannot publish an event until at least one interview is saved.",
      });
    }

    if (readiness.interviews_without_interviewers > 0) {
      await client.query("ROLLBACK");

      return res.status(409).json({
        success: false,
        error: "Every interview must have an assigned interviewer before publishing.",
      });
    }

    if (readiness.interviews_not_draft > 0) {
      await client.query("ROLLBACK");

      return res.status(409).json({
        success: false,
        error: "All interviews must be in draft status before publishing.",
      });
    }

    await client.query(
      `UPDATE scheduled_interviews
       SET status = 'published'
       WHERE event_id = $1
         AND status = 'draft'`,
      [eventId]
    );

    const updatedEventResult = await client.query(
      `UPDATE recruitment_events
       SET status = 'published'
       WHERE event_id = $1
       RETURNING
         event_id AS "eventId",
         event_name AS "eventName",
         to_char(event_date, 'YYYY-MM-DD') AS "eventDate",
         status,
         created_at AS "createdAt"`,
      [eventId]
    );

    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      event: updatedEventResult.rows[0],
      publishedInterviews: readiness.total_interviews,
    });
  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Publish transaction rollback failed:", rollbackError);
      }
    }

    console.error("Failed to publish event:", error);

    return res.status(500).json({
      success: false,
      error: "The event could not be published. Check the backend logs.",
    });
  } finally {
    if (client) {
      client.release();
    }
  }
});

app.listen(PORT, () => {
  console.log(`Chronos API running at http://localhost:${PORT}`);
});
