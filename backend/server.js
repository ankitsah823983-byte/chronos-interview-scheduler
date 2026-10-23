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

  let result;

  // First, generate the schedule using the existing engine.
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

  // Then, save the input and scheduling result transactionally.
  try {
    const persistence = await persistScheduleRun({
      input: {
        eventName,
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

app.listen(PORT, () => {
  console.log(
    `Chronos API running at http://localhost:${PORT}`
  );
});