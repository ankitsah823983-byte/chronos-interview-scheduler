
const pool = require("./db");
const express = require("express");
const cors = require("cors");

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

// Basic API route.
app.get("/", (req, res) => {
  res.json({
    message: "Welcome to Chronos Interview Scheduler API!",
  });
});

// Health check.
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    message: "Chronos backend is running.",
  });
});

// Generate a schedule and persist the scheduling run in PostgreSQL.
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

  // Validate the structure of the scheduling input.
  if (!inputs.every(Array.isArray)) {
    return res.status(400).json({
      success: false,
      error: "All scheduling input fields must be arrays.",
    });
  }

  // Reject empty scheduling inputs.
  if (inputs.some((items) => items.length === 0)) {
    return res.status(400).json({
      success: false,
      error:
        "All scheduling input arrays must contain at least one item.",
    });
  }

  // Validate the event date strictly as YYYY-MM-DD.
  const eventDateObject =
    typeof eventDate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(eventDate)
      ? new Date(`${eventDate}T00:00:00.000Z`)
      : null;

  const validEventDate =
    eventDateObject !== null &&
    !Number.isNaN(eventDateObject.getTime()) &&
    eventDateObject.toISOString().slice(0, 10) === eventDate;

  if (!validEventDate) {
    return res.status(400).json({
      success: false,
      error:
        "Event date must be a valid date in YYYY-MM-DD format.",
    });
  }

  let result;

  // Generate the schedule using the existing scheduling engine.
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

  // Persist the input and scheduling result transactionally.
  try {
    const persistence = await persistScheduleRun({
      input: {
        eventName,
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

// Retrieve a previously saved scheduling run.
app.get("/api/schedules/:eventId", async (req, res) => {
  const { eventId } = req.params;

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

    if (eventResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Scheduling event not found.",
      });
    }

    const scheduleResult = await pool.query(
      `SELECT
         si.schedule_id AS "interviewId",
         split_part(si.task_id, ':', 2) AS "taskId",
         split_part(it.candidate_id, ':', 2) AS "candidateId",
         c.full_name AS "candidateName",
         it.round_name AS "roundName",
         split_part(si.interviewer_id, ':', 2) AS "interviewerId",
         i.full_name AS "interviewerName",
         split_part(si.room_id, ':', 2) AS "roomId",
         r.room_name AS "roomName",
         to_char(si.start_time, 'HH24:MI') AS "startTime",
         to_char(si.end_time, 'HH24:MI') AS "endTime",
         si.status
       FROM scheduled_interviews si
       JOIN interview_tasks it
         ON it.task_id = si.task_id
       JOIN candidates c
         ON c.candidate_id = it.candidate_id
       JOIN interviewers i
         ON i.interviewer_id = si.interviewer_id
       JOIN rooms r
         ON r.room_id = si.room_id
       WHERE si.event_id = $1
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

app.listen(PORT, () => {
  console.log(
    `Chronos API running at http://localhost:${PORT}`
  );
});
