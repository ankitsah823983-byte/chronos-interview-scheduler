const express = require("express");
const cors = require("cors");
const { generateSchedule } = require("./scheduler");

const app = express();
const PORT = 5000;

// Allow our React frontend to communicate with this server.
app.use(
  cors({
    origin: "http://localhost:5173",
  })
);

app.use(express.json());

// Basic route to check whether the server is running.
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

// Generate an interview schedule.
app.post("/api/schedule", (req, res) => {
  const {
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

  try {
    const result = generateSchedule({
      timeSlots,
      candidates,
      interviewers,
      rooms,
      tasks,
    });

    return res
      .status(result.success ? 200 : 422)
      .json(result);
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error.message || "Invalid scheduling input.",
    });
  }
});

app.listen(PORT, () => {
  console.log(
    `Chronos API running at http://localhost:${PORT}`
  );
});