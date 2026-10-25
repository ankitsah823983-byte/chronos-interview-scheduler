const express = require("express");
const cors = require("cors");
const session = require("express-session");
const connectPgSimple = require("connect-pg-simple");

const pool = require("./db");
const authRouter = require("./auth");
const invitationsRouter = require("./invitations");
const interviewerAvailabilityRouter = require("./interviewer-availability");
const candidateBookingRouter = require("./candidate-booking");
const { requireAuth, requireRole } = require("./auth-middleware");
const { generateSchedule } = require("./scheduler");
const {
  persistScheduleRun,
  applySubmittedInterviewerAvailability,
} = require("./persistence");

const app = express();
const PORT = 5000;

const sessionSecret = process.env.SESSION_SECRET;

if (typeof sessionSecret !== "string" || sessionSecret.length < 32) {
  console.error(
    "SESSION_SECRET is missing or too short. Configure it in backend/.env."
  );
  process.exit(1);
}

if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
  })
);

app.use(express.json({ limit: "1mb" }));

const PgSessionStore = connectPgSimple(session);

const sessionStore = new PgSessionStore({
  pool,
  tableName: "user_sessions",
  createTableIfMissing: true,
});

app.use(
  session({
    name: "chronos.sid",
    secret: sessionSecret,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 8 * 60 * 60 * 1000,
      path: "/",
    },
  })
);

// Public authentication endpoints.
app.use("/api/auth", authRouter);

// Verify login and role against PostgreSQL on every protected request.
app.use(
  "/api/invitations",
  requireAuth,
  requireRole("coordinator"),
  invitationsRouter
);

// INTERVIEWER ONLY: manage availability for assigned events.
app.use(
  "/api/interviewer",
  requireAuth,
  requireRole("interviewer"),
  interviewerAvailabilityRouter
);

// CANDIDATE ONLY: view and book the authenticated candidate's interviews.
app.use(
  "/api/candidate",
  requireAuth,
  requireRole("candidate"),
  candidateBookingRouter
);


function isValidUuid(value) {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value
    )
  );
}

function isValidDateString(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return false;
  }

  const dateObject = new Date(`${value}T00:00:00.000Z`);

  return (
    !Number.isNaN(dateObject.getTime()) &&
    dateObject.toISOString().slice(0, 10) === value
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

// COORDINATOR ONLY: create an independent draft event.
app.post(
  "/api/events",
  requireAuth,
  requireRole("coordinator"),
  async (req, res) => {
    const { eventName, eventDate } = req.body || {};

    if (
      typeof eventName !== "string" ||
      eventName.trim().length === 0
    ) {
      return res.status(400).json({
        success: false,
        error: "Event name is required.",
      });
    }

    if (!isValidDateString(eventDate)) {
      return res.status(400).json({
        success: false,
        error: "Event date must be a valid date in YYYY-MM-DD format.",
      });
    }

    try {
      const result = await pool.query(
        `INSERT INTO recruitment_events
           (event_name, event_date, status)
         VALUES ($1, $2, 'draft')
         RETURNING
           event_id AS "eventId",
           event_name AS "eventName",
           to_char(event_date, 'YYYY-MM-DD') AS "eventDate",
           status,
           created_at AS "createdAt"`,
        [eventName.trim(), eventDate]
      );

      return res.status(201).json({
        success: true,
        event: result.rows[0],
      });
    } catch (error) {
      console.error("Failed to create recruitment event:", error);

      return res.status(500).json({
        success: false,
        error: "Could not create the recruitment event.",
      });
    }
  }
);

// COORDINATOR ONLY: list saved events.
app.get(
  "/api/events",
  requireAuth,
  requireRole("coordinator"),
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT
           e.event_id AS "eventId",
           e.event_name AS "eventName",
           to_char(e.event_date, 'YYYY-MM-DD') AS "eventDate",
           e.status,
           e.created_at AS "createdAt",
           COUNT(si.schedule_id)::int AS "interviewCount"
         FROM recruitment_events e
         LEFT JOIN scheduled_interviews si
           ON si.event_id = e.event_id
         GROUP BY
           e.event_id,
           e.event_name,
           e.event_date,
           e.status,
           e.created_at
         ORDER BY e.created_at DESC, e.event_id DESC`
      );

      return res.json({
        success: true,
        events: result.rows,
        total: result.rowCount,
      });
    } catch (error) {
      console.error("Failed to list events:", error);

      return res.status(500).json({
        success: false,
        error: "Could not retrieve recruitment events.",
      });
    }
  }
);

// COORDINATOR ONLY: generate and persist a schedule.
app.post(
  "/api/schedule",
  requireAuth,
  requireRole("coordinator"),
  async (req, res) => {
    const {
      eventId,
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
        error:
          "All scheduling input arrays must contain at least one item.",
      });
    }

    const reuseExistingEvent =
      eventId !== undefined &&
      eventId !== null &&
      eventId !== "";

    if (reuseExistingEvent && !isValidUuid(eventId)) {
      return res.status(400).json({
        success: false,
        error: "Event ID must be a valid UUID.",
      });
    }

    if (!reuseExistingEvent) {
      if (
        typeof eventName !== "string" ||
        eventName.trim().length === 0
      ) {
        return res.status(400).json({
          success: false,
          error: "Event name is required.",
        });
      }

      if (!isValidDateString(eventDate)) {
        return res.status(400).json({
          success: false,
          error: "Event date must be a valid date in YYYY-MM-DD format.",
        });
      }
    }

    let effectiveInterviewers = interviewers;

    // For an existing event, apply interviewers' latest submitted
    // availability before generating a replacement schedule.
    if (reuseExistingEvent) {
      try {
        const availabilityInput =
          await applySubmittedInterviewerAvailability({
            eventId,
            timeSlots,
            interviewers,
          });

        effectiveInterviewers = availabilityInput.interviewers;
      } catch (error) {
        console.error(
          "Failed to load submitted interviewer availability:",
          error
        );

        return res.status(500).json({
          success: false,
          error: "Could not load submitted interviewer availability.",
        });
      }
    }

    let result;

    try {
      result = generateSchedule({
  timeSlots,
  candidates,
  interviewers: effectiveInterviewers,
  rooms,
  tasks,
  maxSolutions: 20,
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
          eventId: reuseExistingEvent ? eventId : undefined,
          eventName:
            typeof eventName === "string" ? eventName.trim() : undefined,
          eventDate,
          timeSlots,
          candidates,
          interviewers: effectiveInterviewers,
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
      if (error.code === "EVENT_NOT_FOUND") {
        return res.status(404).json({
          success: false,
          error: error.message,
        });
      }

      if (error.code === "EVENT_NOT_DRAFT") {
        return res.status(409).json({
          success: false,
          error: error.message,
        });
      }

      if (
        error.code === "PROFILE_EMAIL_CONFLICT" ||
        error.code === "PROFILE_EMAIL_LINKED"
      ) {
        return res.status(409).json({
          success: false,
          error: error.message,
        });
      }
      console.error("Failed to save scheduling run:", error);

      return res.status(500).json({
        success: false,
        error:
          "The scheduling result could not be saved to the database. " +
          "Check the backend logs and database configuration.",
      });
    }
  }
);

// COORDINATOR ONLY: load an event and its configuration.
app.get(
  "/api/schedules/:eventId",
  requireAuth,
  requireRole("coordinator"),
  async (req, res) => {
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

      const [
        slotResult,
        candidateResult,
        interviewerResult,
        roomResult,
        taskResult,
        scheduleResult,
      ] = await Promise.all([
        pool.query(
          `SELECT to_char(slot_time, 'HH24:MI') AS time
           FROM event_time_slots
           WHERE event_id = $1
           ORDER BY slot_time`,
          [eventId]
        ),

        pool.query(
          `SELECT
             c.candidate_id AS id,
             c.full_name AS name,
             c.email AS email,
             COALESCE(
               (
                 SELECT array_agg(
                   to_char(ca.slot_time, 'HH24:MI')
                   ORDER BY ca.slot_time
                 )
                 FROM candidate_availability ca
                 WHERE ca.event_id = ec.event_id
                   AND ca.candidate_id = ec.candidate_id
               ),
               ARRAY[]::text[]
             ) AS "availableSlots"
           FROM event_candidates ec
           JOIN candidates c
             ON c.candidate_id = ec.candidate_id
           WHERE ec.event_id = $1
           ORDER BY c.full_name, c.candidate_id`,
          [eventId]
        ),

        pool.query(
          `SELECT
             i.interviewer_id AS id,
             i.full_name AS name,
             i.email AS email,
             COALESCE(
               (
                 SELECT array_agg(s.skill ORDER BY s.skill)
                 FROM interviewer_skills s
                 WHERE s.interviewer_id = i.interviewer_id
               ),
               ARRAY[]::text[]
             ) AS skills,
             COALESCE(
               (
                 SELECT array_agg(
                   to_char(ia.slot_time, 'HH24:MI')
                   ORDER BY ia.slot_time
                 )
                 FROM interviewer_availability ia
                 WHERE ia.event_id = ei.event_id
                   AND ia.interviewer_id = ei.interviewer_id
               ),
               ARRAY[]::text[]
             ) AS "availableSlots",
             ei.max_interviews_per_day AS "maxInterviewsPerDay"
           FROM event_interviewers ei
           JOIN interviewers i
             ON i.interviewer_id = ei.interviewer_id
           WHERE ei.event_id = $1
           ORDER BY i.full_name, i.interviewer_id`,
          [eventId]
        ),

        pool.query(
          `SELECT
             r.room_id AS id,
             r.room_name AS name,
             COALESCE(
               (
                 SELECT array_agg(
                   to_char(ra.slot_time, 'HH24:MI')
                   ORDER BY ra.slot_time
                 )
                 FROM room_availability ra
                 WHERE ra.event_id = r.event_id
                   AND ra.room_id = r.room_id
               ),
               ARRAY[]::text[]
             ) AS "availableSlots"
           FROM rooms r
           WHERE r.event_id = $1
           ORDER BY r.room_name, r.room_id`,
          [eventId]
        ),

        pool.query(
          `SELECT
             task_id AS id,
             candidate_id AS "candidateId",
             round_name AS "roundName",
             required_skills AS "requiredSkills",
             duration_slots AS "durationSlots"
           FROM interview_tasks
           WHERE event_id = $1
           ORDER BY round_name, task_id`,
          [eventId]
        ),

        pool.query(
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
        ),
      ]);

      return res.json({
        success: true,
        event: eventResult.rows[0],
        schedule: scheduleResult.rows,
        savedInterviews: scheduleResult.rowCount,
        configuration: {
          timeSlots: slotResult.rows.map((row) => row.time),
          candidates: candidateResult.rows,
          interviewers: interviewerResult.rows,
          rooms: roomResult.rows,
          tasks: taskResult.rows,
        },
      });
    } catch (error) {
      console.error("Failed to retrieve saved event configuration:", error);

      return res.status(500).json({
        success: false,
        error: "Could not retrieve the saved event and its configuration.",
      });
    }
  }
);

// COORDINATOR ONLY: publish a valid draft schedule atomically.
app.post(
  "/api/events/:eventId/publish",
  requireAuth,
  requireRole("coordinator"),
  async (req, res) => {
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
          error:
            "Cannot publish an event until at least one interview is saved.",
        });
      }

      if (readiness.interviews_without_interviewers > 0) {
        await client.query("ROLLBACK");

        return res.status(409).json({
          success: false,
          error:
            "Every interview must have an assigned interviewer before publishing.",
        });
      }

      if (readiness.interviews_not_draft > 0) {
        await client.query("ROLLBACK");

        return res.status(409).json({
          success: false,
          error:
            "All interviews must be in draft status before publishing.",
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
          console.error(
            "Publish transaction rollback failed:",
            rollbackError
          );
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
  }
);

app.listen(PORT, () => {
  console.log(`Chronos API running at http://localhost:${PORT}`);
});