import { useEffect, useState } from "react";
import "./App.css";

const INITIAL_TIME_SLOTS = ["10:00", "10:30", "11:00", "11:30"];

const INITIAL_CANDIDATES = [
  {
    id: "c1",
    name: "Candidate A",
    availableSlotsText: "10:00, 10:30",
  },
  {
    id: "c2",
    name: "Candidate B",
    availableSlotsText: "10:00, 10:30, 11:00, 11:30",
  },
];

const INITIAL_INTERVIEWERS = [
  {
    id: "i1",
    name: "Interviewer X",
    skillsText: "DSA",
    availableSlotsText: "10:00, 10:30, 11:00, 11:30",
    maxInterviewsPerDay: "2",
  },
  {
    id: "i2",
    name: "Interviewer Y",
    skillsText: "OS, DBMS",
    availableSlotsText: "10:00, 10:30, 11:00, 11:30",
    maxInterviewsPerDay: "2",
  },
];

const INITIAL_ROOMS = [
  {
    id: "r1",
    name: "Room 1",
    availableSlotsText: "10:00, 10:30, 11:00, 11:30",
  },
  {
    id: "r2",
    name: "Room 2",
    availableSlotsText: "10:00, 10:30, 11:00, 11:30",
  },
];

const INITIAL_TASKS = [
  {
    id: "t1",
    candidateId: "c1",
    roundName: "Coding Interview",
    requiredSkillsText: "DSA",
    durationSlots: "1",
  },
  {
    id: "t2",
    candidateId: "c2",
    roundName: "Technical Interview",
    requiredSkillsText: "OS",
    durationSlots: "1",
  },
];

const DIAGNOSTIC_LABELS = {
  CANDIDATE_AVAILABILITY: "Candidate availability issue",
  SKILL_MISMATCH: "Interviewer skill mismatch",
  INTERVIEWER_AVAILABILITY: "Interviewer availability issue",
  ROOM_AVAILABILITY: "Room availability issue",
  SEARCH_LIMIT: "Scheduling search limit reached",
  SHARED_RESOURCE_CONFLICT: "Shared-resource conflict",
  INTERVIEWER_WORKLOAD_LIMIT: "Interviewer workload limit",
};

function parseList(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function compareTimes(a, b) {
  return a.localeCompare(b);
}

async function fetchSavedEvents() {
  const response = await fetch("http://localhost:5000/api/events");
  const data = await response.json();

  if (!response.ok || !data.success || !Array.isArray(data.events)) {
    throw new Error(data.error || "Could not retrieve saved events.");
  }

  return data.events;
}

function App() {
  const [eventName, setEventName] = useState("Chronos Recruitment Event");
  const [eventDate, setEventDate] = useState("");

  const [timeSlotsText, setTimeSlotsText] = useState(
    INITIAL_TIME_SLOTS.join(", ")
  );

  const [candidates, setCandidates] = useState(INITIAL_CANDIDATES);
  const [interviewers, setInterviewers] = useState(INITIAL_INTERVIEWERS);
  const [rooms, setRooms] = useState(INITIAL_ROOMS);
  const [tasks, setTasks] = useState(INITIAL_TASKS);

  const [generatedSchedule, setGeneratedSchedule] = useState([]);

  const [savedEventId, setSavedEventId] = useState(
    () => localStorage.getItem("chronosLastSavedEventId") || ""
  );

  const [eventStatus, setEventStatus] = useState("");
  const [savedEvents, setSavedEvents] = useState([]);
  const [loadingEvents, setLoadingEvents] = useState(false);

  const [loading, setLoading] = useState(false);
  const [loadingSavedSchedule, setLoadingSavedSchedule] = useState(false);
  const [publishingSchedule, setPublishingSchedule] = useState(false);

  const [apiError, setApiError] = useState("");
  const [apiMessage, setApiMessage] = useState("");
  const [apiMessageTitle, setApiMessageTitle] = useState("");

  const [scheduleViewTitle, setScheduleViewTitle] = useState(
    "Generated interview schedule"
  );

  const [scheduleFailure, setScheduleFailure] = useState("");
  const [diagnostics, setDiagnostics] = useState([]);

  useEffect(() => {
    let cancelled = false;

    fetchSavedEvents()
      .then((events) => {
        if (!cancelled) {
          setSavedEvents(events);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn("Could not load the saved event list:", error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function clearFeedback() {
    setApiError("");
    setApiMessage("");
    setApiMessageTitle("");
    setScheduleFailure("");
    setDiagnostics([]);
    setGeneratedSchedule([]);
    setScheduleViewTitle("Generated interview schedule");
  }

  function updateCandidate(id, changes) {
    setCandidates((current) =>
      current.map((item) =>
        item.id === id ? { ...item, ...changes } : item
      )
    );
  }

  function updateInterviewer(id, changes) {
    setInterviewers((current) =>
      current.map((item) =>
        item.id === id ? { ...item, ...changes } : item
      )
    );
  }

  function updateRoom(id, changes) {
    setRooms((current) =>
      current.map((item) =>
        item.id === id ? { ...item, ...changes } : item
      )
    );
  }

  function updateTask(id, changes) {
    setTasks((current) =>
      current.map((item) =>
        item.id === id ? { ...item, ...changes } : item
      )
    );
  }

  function addCandidate() {
    clearFeedback();

    setCandidates((current) => [
      ...current,
      {
        id: `c-${Date.now()}`,
        name: `Candidate ${current.length + 1}`,
        availableSlotsText: timeSlotsText,
      },
    ]);
  }

  function removeCandidate(id) {
    clearFeedback();

    setCandidates((current) =>
      current.filter((item) => item.id !== id)
    );

    setTasks((current) =>
      current.filter((item) => item.candidateId !== id)
    );
  }

  function addInterviewer() {
    clearFeedback();

    setInterviewers((current) => [
      ...current,
      {
        id: `i-${Date.now()}`,
        name: `Interviewer ${current.length + 1}`,
        skillsText: "DSA",
        availableSlotsText: timeSlotsText,
        maxInterviewsPerDay: "2",
      },
    ]);
  }

  function removeInterviewer(id) {
    clearFeedback();

    setInterviewers((current) =>
      current.filter((item) => item.id !== id)
    );
  }

  function addRoom() {
    clearFeedback();

    setRooms((current) => [
      ...current,
      {
        id: `r-${Date.now()}`,
        name: `Room ${current.length + 1}`,
        availableSlotsText: timeSlotsText,
      },
    ]);
  }

  function removeRoom(id) {
    clearFeedback();

    setRooms((current) =>
      current.filter((item) => item.id !== id)
    );
  }

  function addTask() {
    clearFeedback();

    if (candidates.length === 0) {
      setApiError("Add a candidate before adding an interview.");
      return;
    }

    setTasks((current) => [
      ...current,
      {
        id: `t-${Date.now()}`,
        candidateId: candidates[0].id,
        roundName: "New Interview",
        requiredSkillsText: "DSA",
        durationSlots: "1",
      },
    ]);
  }

  function removeTask(id) {
    clearFeedback();

    setTasks((current) =>
      current.filter((item) => item.id !== id)
    );
  }

  async function handleRefreshSavedEvents({ silent = false } = {}) {
    if (!silent) {
      setLoadingEvents(true);
      setApiError("");
      setApiMessage("");
      setApiMessageTitle("");
    }

    try {
      const events = await fetchSavedEvents();
      setSavedEvents(events);

      if (!silent) {
        setApiMessageTitle("Saved events refreshed");
        setApiMessage(`Loaded ${events.length} saved recruitment event(s).`);
      }
    } catch (error) {
      if (!silent) {
        setApiError(
          error.message ||
            "Could not load saved events. Check that the backend is running at localhost:5000."
        );
      } else {
        console.warn("Could not refresh the saved event list:", error);
      }
    } finally {
      if (!silent) {
        setLoadingEvents(false);
      }
    }
  }

  async function handleGenerateSchedule() {
    clearFeedback();

    if (!eventName.trim()) {
      setApiError("Enter a recruitment event name.");
      return;
    }

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
      setApiError("Choose a valid event date.");
      return;
    }

    const timeSlots = parseList(timeSlotsText).sort(compareTimes);

    if (
      timeSlots.length === 0 ||
      candidates.length === 0 ||
      interviewers.length === 0 ||
      rooms.length === 0 ||
      tasks.length === 0
    ) {
      setApiError(
        "Add time slots, candidates, interviewers, rooms and interview tasks first."
      );
      return;
    }

    const validTimeFormat = timeSlots.every((slot) =>
      /^([01]\d|2[0-3]):(00|30)$/.test(slot)
    );

    if (!validTimeFormat) {
      setApiError(
        "Use HH:00 or HH:30 time format. Example: 10:00, 10:30, 11:00."
      );
      return;
    }

    if (new Set(timeSlots).size !== timeSlots.length) {
      setApiError("Remove duplicate time slots.");
      return;
    }

    if (
      candidates.some(
        (item) =>
          !item.name.trim() || !item.availableSlotsText.trim()
      )
    ) {
      setApiError(
        "Every candidate needs a name and available time slots."
      );
      return;
    }

    if (
      interviewers.some(
        (item) =>
          !item.name.trim() ||
          !item.skillsText.trim() ||
          !item.availableSlotsText.trim()
      )
    ) {
      setApiError(
        "Every interviewer needs a name, skills and availability."
      );
      return;
    }

    if (
      interviewers.some(
        (item) =>
          item.maxInterviewsPerDay.trim() !== "" &&
          (!Number.isInteger(Number(item.maxInterviewsPerDay)) ||
            Number(item.maxInterviewsPerDay) < 1)
      )
    ) {
      setApiError(
        "Workload limits must be positive whole numbers, or blank for no limit."
      );
      return;
    }

    if (
      rooms.some(
        (item) =>
          !item.name.trim() || !item.availableSlotsText.trim()
      )
    ) {
      setApiError(
        "Every room needs a name and available time slots."
      );
      return;
    }

    if (
      tasks.some(
        (item) =>
          !item.roundName.trim() ||
          !item.requiredSkillsText.trim() ||
          !candidates.some(
            (candidate) => candidate.id === item.candidateId
          ) ||
          !["1", "2", "3", "4"].includes(item.durationSlots)
      )
    ) {
      setApiError(
        "Every interview needs a valid candidate, round name, required skills and duration."
      );
      return;
    }

    const candidateData = candidates.map((item) => ({
      id: item.id,
      name: item.name.trim(),
      availableSlots: parseList(item.availableSlotsText),
    }));

    const interviewerData = interviewers.map((item) => ({
      id: item.id,
      name: item.name.trim(),
      skills: parseList(item.skillsText),
      availableSlots: parseList(item.availableSlotsText),
      ...(item.maxInterviewsPerDay.trim() !== ""
        ? {
            maxInterviewsPerDay: Number(item.maxInterviewsPerDay),
          }
        : {}),
    }));

    const roomData = rooms.map((item) => ({
      id: item.id,
      name: item.name.trim(),
      availableSlots: parseList(item.availableSlotsText),
    }));

    const taskData = tasks.map((item) => ({
      id: item.id,
      candidateId: item.candidateId,
      roundName: item.roundName.trim(),
      requiredSkills: parseList(item.requiredSkillsText),
      durationSlots: Number(item.durationSlots),
    }));

    setLoading(true);

    try {
      const response = await fetch(
        "http://localhost:5000/api/schedule",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            eventName: eventName.trim(),
            eventDate,
            timeSlots,
            candidates: candidateData,
            interviewers: interviewerData,
            rooms: roomData,
            tasks: taskData,
          }),
        }
      );

      const data = await response.json();

      if (response.ok && data.success) {
        const eventId = data.persistence?.eventId || "";

        if (eventId) {
          setSavedEventId(eventId);
          localStorage.setItem("chronosLastSavedEventId", eventId);
          void handleRefreshSavedEvents({ silent: true });
        }

        let scheduleToDisplay = data.schedule || [];
        setEventStatus("draft");

        if (eventId) {
          try {
            const savedResponse = await fetch(
              `http://localhost:5000/api/schedules/${encodeURIComponent(eventId)}`
            );

            const savedData = await savedResponse.json();

            if (
              savedResponse.ok &&
              savedData.success &&
              Array.isArray(savedData.schedule)
            ) {
              scheduleToDisplay = savedData.schedule;
              setEventStatus(savedData.event?.status || "draft");
            }
          } catch (loadError) {
            console.error(
              "Could not load saved interview IDs:",
              loadError
            );
          }
        }

        setGeneratedSchedule(scheduleToDisplay);
        setScheduleViewTitle("Generated interview schedule");
        setApiMessageTitle("Schedule generated and saved");

        setApiMessage(
          `Successfully generated ${(data.schedule || []).length} interviews and saved the run to PostgreSQL.`
        );

        return;
      }

      setScheduleFailure(
        data.reason || "No complete schedule could be generated."
      );

      setDiagnostics(
        Array.isArray(data.diagnostics) ? data.diagnostics : []
      );

      if (!Array.isArray(data.diagnostics) || data.diagnostics.length === 0) {
        setApiError(
          data.error ||
            "The server could not provide a detailed diagnosis for this request."
        );
      }
    } catch (error) {
      setApiError(
        "Could not connect to the Chronos backend. Check that the server is running at localhost:5000."
      );
    } finally {
      setLoading(false);
    }
  }

  async function handlePublishSchedule() {
    const eventId = savedEventId.trim();

    if (!eventId || generatedSchedule.length === 0) {
      setApiError("Load a saved schedule with interviews before publishing.");
      return;
    }

    if (eventStatus !== "draft") {
      setApiError("Only a draft schedule can be published.");
      return;
    }

    setPublishingSchedule(true);
    setApiError("");
    setApiMessage("");
    setApiMessageTitle("");

    try {
      const response = await fetch(
        `http://localhost:5000/api/events/${encodeURIComponent(eventId)}/publish`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        setApiError(data.error || "Could not publish this schedule.");
        return;
      }

      setEventStatus(data.event?.status || "published");

      setGeneratedSchedule((current) =>
        current.map((interview) => ({
          ...interview,
          status: "published",
        }))
      );

      setApiMessageTitle(
        data.alreadyPublished
          ? "Schedule already published"
          : "Schedule published"
      );

      setApiMessage(
        `Published ${data.publishedInterviews ?? generatedSchedule.length} interview(s) for ${data.event?.eventName || eventName}.`
      );

      void handleRefreshSavedEvents({ silent: true });
    } catch (error) {
      setApiError(
        "Could not connect to Chronos. Check that the backend is running at localhost:5000."
      );
    } finally {
      setPublishingSchedule(false);
    }
  }

  async function handleLoadSavedSchedule() {
    const eventId = savedEventId.trim();

    if (!eventId) {
      setApiError("Enter a saved event ID first.");
      setApiMessage("");
      setApiMessageTitle("");
      return;
    }

    setLoadingSavedSchedule(true);
    setApiError("");
    setApiMessage("");
    setApiMessageTitle("");
    setScheduleFailure("");
    setDiagnostics([]);
    setGeneratedSchedule([]);

    try {
      const response = await fetch(
        `http://localhost:5000/api/schedules/${encodeURIComponent(eventId)}`
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        setApiError(data.error || "Could not load the saved schedule.");
        return;
      }

      const loadedSchedule = Array.isArray(data.schedule)
        ? data.schedule
        : [];

      const loadedEventId = data.event?.eventId || eventId;
      const loadedEventName =
        data.event?.eventName || "Chronos Recruitment Event";

      const loadedEventDate = data.event?.eventDate
        ? String(data.event.eventDate).slice(0, 10)
        : "";

      setGeneratedSchedule(loadedSchedule);
      setScheduleViewTitle("Saved interview schedule");
      setSavedEventId(loadedEventId);
      setEventName(loadedEventName);
      setEventDate(loadedEventDate);
      setEventStatus(data.event?.status || "draft");

      localStorage.setItem(
        "chronosLastSavedEventId",
        loadedEventId
      );

      setApiMessageTitle("Saved schedule loaded");
      setApiMessage(
        `Loaded ${data.savedInterviews ?? loadedSchedule.length} saved interview(s) from PostgreSQL for ${loadedEventName}.`
      );
    } catch (error) {
      setApiError(
        "Could not connect to Chronos. Check that the backend is running at localhost:5000."
      );
    } finally {
      setLoadingSavedSchedule(false);
    }
  }

  return (
    <div className="site-shell">
      <header className="navbar">
        <a className="brand" href="#home">
          <span className="brand-mark">✦</span>
          <span>
            <strong>CHRONOS</strong>
            <small>INTERVIEW SCHEDULER</small>
          </span>
        </a>

        <nav className="nav-links">
          <a href="#features">Features</a>
          <a href="#scheduler">Scheduler</a>
          <a href="#workflow">How it works</a>
        </nav>

        <a className="nav-button" href="#scheduler">
          Build a schedule <span>↗</span>
        </a>
      </header>

      <main>
        <section className="hero" id="home">
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="status-dot" />
              SMART RECRUITMENT SCHEDULING
            </div>

            <h1>
              Every interview.
              <br />
              <span>In its right place.</span>
            </h1>

            <p className="hero-description">
              Bring candidates, interviewers and rooms together.
              Chronos transforms complex placement schedules into
              a clear, conflict-aware interview plan.
            </p>

            <div className="hero-actions">
              <a className="primary-button" href="#scheduler">
                Build a schedule <span>→</span>
              </a>

              <a className="secondary-button" href="#features">
                Explore features
              </a>
            </div>

            <div className="hero-note">
              <span>✦</span>
              Built for smarter campus placements
            </div>
          </div>

          <div className="schedule-card">
            <div className="card-topline">
              <div>
                <p className="card-kicker">THE CONTROL ROOM</p>
                <h2>Schedule overview</h2>
              </div>

              <span className="live-badge">
                <span className="status-dot" /> DEMO
              </span>
            </div>

            <div className="clock-art">
              <div className="clock-ring ring-one" />
              <div className="clock-ring ring-two" />

              <div className="clock-center">
                <span className="clock-star">✦</span>
                <strong>CHRONOS</strong>
                <small>TIME, IN HARMONY</small>
              </div>

              <span className="orbit-dot dot-one" />
              <span className="orbit-dot dot-two" />
              <span className="orbit-dot dot-three" />
            </div>

            <div className="preview-heading">
              <span>ILLUSTRATIVE TIMELINE</span>
              <span>30 MIN / SLOT</span>
            </div>

            <div className="timeline-row">
              <time>10:00</time>
              <div className="timeline-event event-gold">
                <strong>Coding Interview</strong>
                <small>Candidate A · Room 01</small>
              </div>
              <span className="event-check">✓</span>
            </div>

            <div className="timeline-row">
              <time>10:30</time>
              <div className="timeline-event event-red">
                <strong>Technical Interview</strong>
                <small>Candidate B · Room 02</small>
              </div>
              <span className="event-check">✓</span>
            </div>

            <p className="preview-caption">
              <span>✦</span> Illustrative preview only.
              Your generated schedule appears below the input form.
            </p>
          </div>
        </section>

        <section className="scheduler-builder" id="scheduler">
          <div className="builder-intro">
            <p className="section-kicker">COORDINATOR WORKSPACE</p>
            <h2>Build your interview schedule.</h2>
            <p>
              Enter availability, skills and room details. Chronos
              will attempt to create a schedule that respects the
              specified constraints.
            </p>

            <div className="demo-notice">
              Scheduling runs and generated draft schedules are saved to the
              local PostgreSQL database. Accounts and multi-device access are
              not implemented yet.
            </div>
          </div>

          <div className="builder-card">
            <div className="builder-card-heading">
              <span className="builder-step">01</span>
              <div>
                <h3>Event details &amp; time slots</h3>
                <p>
                  Set the recruitment event name and date, then define
                  available 30-minute start-time blocks.
                </p>
              </div>
            </div>

            <div className="field-grid">
              <label className="form-field">
                <span>Recruitment event name</span>
                <input
                  type="text"
                  value={eventName}
                  onChange={(event) => {
                    setEventName(event.target.value);
                    clearFeedback();
                  }}
                  placeholder="e.g. Campus Placements 2026"
                  required
                />
              </label>

              <label className="form-field">
                <span>Event date</span>
                <input
                  type="date"
                  value={eventDate}
                  onChange={(event) => {
                    setEventDate(event.target.value);
                    clearFeedback();
                  }}
                  required
                />
              </label>
            </div>

            <label className="form-field">
              <span>Available start times</span>
              <input
                type="text"
                value={timeSlotsText}
                onChange={(event) => {
                  setTimeSlotsText(event.target.value);
                  clearFeedback();
                }}
                placeholder="10:00, 10:30, 11:00, 11:30"
              />
            </label>
          </div>

          <div className="builder-card">
            <div className="builder-card-heading">
              <span className="builder-step">02</span>
              <div>
                <h3>Candidates</h3>
                <p>
                  Enter each candidate's name and available start-time blocks.
                </p>
              </div>
            </div>

            {candidates.map((candidate, index) => (
              <div className="resource-item" key={candidate.id}>
                <div className="resource-title">
                  <strong>Candidate {index + 1}</strong>
                  <button
                    type="button"
                    className="remove-button"
                    onClick={() => removeCandidate(candidate.id)}
                  >
                    Remove
                  </button>
                </div>

                <div className="field-grid">
                  <label className="form-field">
                    <span>Name</span>
                    <input
                      value={candidate.name}
                      onChange={(event) => {
                        updateCandidate(candidate.id, {
                          name: event.target.value,
                        });
                        clearFeedback();
                      }}
                    />
                  </label>

                  <label className="form-field">
                    <span>Available slots</span>
                    <input
                      value={candidate.availableSlotsText}
                      onChange={(event) => {
                        updateCandidate(candidate.id, {
                          availableSlotsText: event.target.value,
                        });
                        clearFeedback();
                      }}
                      placeholder="10:00, 10:30"
                    />
                  </label>
                </div>
              </div>
            ))}

            <button
              type="button"
              className="add-button"
              onClick={addCandidate}
            >
              + Add candidate
            </button>
          </div>

          <div className="builder-card">
            <div className="builder-card-heading">
              <span className="builder-step">03</span>
              <div>
                <h3>Interviewers</h3>
                <p>
                  Assign skill tags, availability and daily workload limits.
                </p>
              </div>
            </div>

            {interviewers.map((interviewer, index) => (
              <div className="resource-item" key={interviewer.id}>
                <div className="resource-title">
                  <strong>Interviewer {index + 1}</strong>
                  <button
                    type="button"
                    className="remove-button"
                    onClick={() => removeInterviewer(interviewer.id)}
                  >
                    Remove
                  </button>
                </div>

                <div className="field-grid">
                  <label className="form-field">
                    <span>Name</span>
                    <input
                      value={interviewer.name}
                      onChange={(event) => {
                        updateInterviewer(interviewer.id, {
                          name: event.target.value,
                        });
                        clearFeedback();
                      }}
                    />
                  </label>

                  <label className="form-field">
                    <span>Skills (comma-separated)</span>
                    <input
                      value={interviewer.skillsText}
                      onChange={(event) => {
                        updateInterviewer(interviewer.id, {
                          skillsText: event.target.value,
                        });
                        clearFeedback();
                      }}
                      placeholder="DSA, OS, DBMS"
                    />
                  </label>

                  <label className="form-field">
                    <span>Available slots</span>
                    <input
                      value={interviewer.availableSlotsText}
                      onChange={(event) => {
                        updateInterviewer(interviewer.id, {
                          availableSlotsText: event.target.value,
                        });
                        clearFeedback();
                      }}
                      placeholder="10:00, 10:30"
                    />
                  </label>

                  <label className="form-field">
                    <span>Maximum interviews per day</span>
                    <input
                      type="number"
                      min="1"
                      value={interviewer.maxInterviewsPerDay}
                      onChange={(event) => {
                        updateInterviewer(interviewer.id, {
                          maxInterviewsPerDay: event.target.value,
                        });
                        clearFeedback();
                      }}
                    />
                  </label>
                </div>
              </div>
            ))}

            <button
              type="button"
              className="add-button"
              onClick={addInterviewer}
            >
              + Add interviewer
            </button>
          </div>

          <div className="builder-card">
            <div className="builder-card-heading">
              <span className="builder-step">04</span>
              <div>
                <h3>Rooms</h3>
                <p>
                  Define each room and its available time blocks.
                </p>
              </div>
            </div>

            {rooms.map((room, index) => (
              <div className="resource-item" key={room.id}>
                <div className="resource-title">
                  <strong>Room {index + 1}</strong>
                  <button
                    type="button"
                    className="remove-button"
                    onClick={() => removeRoom(room.id)}
                  >
                    Remove
                  </button>
                </div>

                <div className="field-grid">
                  <label className="form-field">
                    <span>Room name</span>
                    <input
                      value={room.name}
                      onChange={(event) => {
                        updateRoom(room.id, {
                          name: event.target.value,
                        });
                        clearFeedback();
                      }}
                    />
                  </label>

                  <label className="form-field">
                    <span>Available slots</span>
                    <input
                      value={room.availableSlotsText}
                      onChange={(event) => {
                        updateRoom(room.id, {
                          availableSlotsText: event.target.value,
                        });
                        clearFeedback();
                      }}
                      placeholder="10:00, 10:30"
                    />
                  </label>
                </div>
              </div>
            ))}

            <button
              type="button"
              className="add-button"
              onClick={addRoom}
            >
              + Add room
            </button>
          </div>

          <div className="builder-card">
            <div className="builder-card-heading">
              <span className="builder-step">05</span>
              <div>
                <h3>Interview tasks</h3>
                <p>
                  Each task represents one candidate's interview in a round.
                </p>
              </div>
            </div>

            {tasks.map((task, index) => (
              <div className="resource-item" key={task.id}>
                <div className="resource-title">
                  <strong>Interview task {index + 1}</strong>
                  <button
                    type="button"
                    className="remove-button"
                    onClick={() => removeTask(task.id)}
                  >
                    Remove
                  </button>
                </div>

                <div className="field-grid">
                  <label className="form-field">
                    <span>Candidate</span>
                    <select
                      value={task.candidateId}
                      onChange={(event) => {
                        updateTask(task.id, {
                          candidateId: event.target.value,
                        });
                        clearFeedback();
                      }}
                    >
                      {candidates.map((candidate) => (
                        <option
                          key={candidate.id}
                          value={candidate.id}
                        >
                          {candidate.name || candidate.id}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="form-field">
                    <span>Round name</span>
                    <input
                      value={task.roundName}
                      onChange={(event) => {
                        updateTask(task.id, {
                          roundName: event.target.value,
                        });
                        clearFeedback();
                      }}
                    />
                  </label>

                  <label className="form-field">
                    <span>Required skills</span>
                    <input
                      value={task.requiredSkillsText}
                      onChange={(event) => {
                        updateTask(task.id, {
                          requiredSkillsText: event.target.value,
                        });
                        clearFeedback();
                      }}
                      placeholder="DSA, OS"
                    />
                  </label>

                  <label className="form-field">
                    <span>Duration (30-minute blocks)</span>
                    <select
                      value={task.durationSlots}
                      onChange={(event) => {
                        updateTask(task.id, {
                          durationSlots: event.target.value,
                        });
                        clearFeedback();
                      }}
                    >
                      <option value="1">30 minutes</option>
                      <option value="2">60 minutes</option>
                      <option value="3">90 minutes</option>
                      <option value="4">120 minutes</option>
                    </select>
                  </label>
                </div>
              </div>
            ))}

            <button
              type="button"
              className="add-button"
              onClick={addTask}
            >
              + Add interview task
            </button>
          </div>

          <div className="builder-actions">
            <button
              type="button"
              className="generate-button"
              onClick={handleGenerateSchedule}
              disabled={loading || loadingSavedSchedule}
            >
              {loading
                ? "Generating schedule..."
                : "Generate interview schedule"}
              <span>→</span>
            </button>

            <p>
              The scheduler attempts to satisfy candidate,
              interviewer, skill, room and workload constraints.
            </p>
          </div>

          <div className="builder-card saved-schedule-card">
            <div className="builder-card-heading">
              <span className="builder-step">06</span>
              <div>
                <h3>Saved schedules</h3>
                <p>
                  Choose a saved recruitment event or paste its ID to load the schedule from PostgreSQL.
                </p>
              </div>
            </div>

            <label className="form-field">
              <span>Select a saved event</span>
              <select
                value={
                  savedEvents.some((item) => item.eventId === savedEventId)
                    ? savedEventId
                    : ""
                }
                onChange={(event) => {
                  setSavedEventId(event.target.value);
                  setGeneratedSchedule([]);
                  setEventStatus("");
                  setScheduleViewTitle("Generated interview schedule");
                  setApiError("");
                  setApiMessage("");
                  setApiMessageTitle("");
                  setScheduleFailure("");
                  setDiagnostics([]);
                }}
                disabled={loadingEvents}
              >
                <option value="">Choose an event...</option>
                {savedEvents.map((item) => (
                  <option key={item.eventId} value={item.eventId}>
                    {item.eventName} — {item.eventDate} — {String(item.status).toUpperCase()} — {item.interviewCount} interview(s)
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              className="add-button"
              onClick={() => handleRefreshSavedEvents()}
              disabled={loadingEvents || loading || loadingSavedSchedule}
            >
              {loadingEvents
                ? "Refreshing event list..."
                : "Refresh saved events"}
            </button>

            <label className="form-field">
              <span>Saved event ID (or paste an ID manually)</span>
              <input
                type="text"
                value={savedEventId}
                onChange={(event) => {
                  setSavedEventId(event.target.value);
                  setGeneratedSchedule([]);
                  setEventStatus("");
                  setScheduleViewTitle("Generated interview schedule");
                  setApiError("");
                  setApiMessage("");
                  setApiMessageTitle("");
                }}
                placeholder="Paste a saved event ID"
                autoComplete="off"
              />
            </label>

            <button
              type="button"
              className="add-button"
              onClick={handleLoadSavedSchedule}
              disabled={loading || loadingSavedSchedule}
            >
              {loadingSavedSchedule
                ? "Loading saved schedule..."
                : "Load saved schedule"}
            </button>
          </div>

          {apiMessage && (
            <div className="notice-success" role="status">
              <strong>{apiMessageTitle || "Schedule status"}</strong>
              <p>{apiMessage}</p>
            </div>
          )}

          {apiError && (
            <div className="notice-error" role="alert">
              <strong>Request could not be completed</strong>
              <p>{apiError}</p>
            </div>
          )}

          {scheduleFailure && (
            <div className="notice-error diagnostic-summary" role="alert">
              <strong>Why couldn't Chronos create the schedule?</strong>
              <p>{scheduleFailure}</p>

              {diagnostics.length > 0 && (
                <div className="diagnostic-list">
                  {diagnostics.map((diagnostic, index) => (
                    <article
                      className="diagnostic-item"
                      key={`${diagnostic.code}-${diagnostic.taskId || "global"}-${index}`}
                    >
                      <span className="diagnostic-code">
                        {DIAGNOSTIC_LABELS[diagnostic.code] ||
                          "Scheduling constraint"}
                      </span>

                      {diagnostic.roundName && (
                        <h4>{diagnostic.roundName}</h4>
                      )}

                      <p>{diagnostic.issue}</p>

                      {diagnostic.suggestion && (
                        <p className="diagnostic-suggestion">
                          <strong>Suggested fix:</strong>{" "}
                          {diagnostic.suggestion}
                        </p>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}

          {generatedSchedule.length > 0 && (
            <div className="schedule-results">
              <div className="results-heading">
                <div>
                  <p className="section-kicker">SCHEDULER OUTPUT</p>
                  <h3>{scheduleViewTitle}</h3>
                </div>

                <span>
                  {generatedSchedule.length} interviews
                  {eventStatus ? ` · ${eventStatus.toUpperCase()}` : ""}
                </span>
              </div>

              {eventStatus === "draft" && savedEventId && (
                <button
                  type="button"
                  className="add-button"
                  onClick={handlePublishSchedule}
                  disabled={
                    loading ||
                    loadingSavedSchedule ||
                    publishingSchedule
                  }
                >
                  {publishingSchedule
                    ? "Publishing schedule..."
                    : "Publish schedule"}
                </button>
              )}

              <div className="result-grid">
                {generatedSchedule.map((item) => {
                  const candidate = candidates.find(
                    (person) => person.id === item.candidateId
                  );

                  return (
                    <article
                      className="result-card"
                      key={item.taskId}
                    >
                      <span className="result-time">
                        {item.startTime} – {item.endTime}
                      </span>

                      <h4>{item.roundName}</h4>

                      {item.interviewId && (
                        <p>Interview ID: {item.interviewId}</p>
                      )}

                      <p>
                        Candidate:{" "}
                        {candidate?.name ||
                          item.candidateName ||
                          item.candidateId}
                      </p>

                      <p>Interviewer: {item.interviewerName}</p>
                      <p>Room: {item.roomName}</p>
                    </article>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        <section className="principles" id="features">
          <div className="section-heading">
            <p className="section-kicker">THE CHRONOS APPROACH</p>
            <h2>
              Complex schedules. <span>Clear decisions.</span>
            </h2>
            <p>
              Designed around the constraints that make recruitment
              scheduling difficult.
            </p>
          </div>

          <div className="feature-grid">
            <article className="feature-card">
              <span className="feature-number">01</span>
              <div className="feature-icon">⌘</div>
              <h3>Conflict-aware scheduling</h3>
              <p>
                Account for candidate availability, interviewer
                schedules and room availability when generating plans.
              </p>
            </article>

            <article className="feature-card">
              <span className="feature-number">02</span>
              <div className="feature-icon">◈</div>
              <h3>Skill-based matching</h3>
              <p>
                Match interview rounds with interviewers who have
                the required expertise and available capacity.
              </p>
            </article>

            <article className="feature-card">
              <span className="feature-number">03</span>
              <div className="feature-icon">◎</div>
              <h3>One connected workflow</h3>
              <p>
                Give candidates, interviewers and coordinators
                a shared view of the recruitment schedule.
              </p>
            </article>
          </div>
        </section>

        <section className="workflow" id="workflow">
          <p className="section-kicker">FROM CHAOS TO CLARITY</p>
          <h2>Three steps to a better schedule.</h2>

          <div className="workflow-grid">
            <div>
              <span>01</span>
              <h3>Set the constraints</h3>
              <p>
                Collect availability, skills, rooms and interview requirements.
              </p>
            </div>

            <div>
              <span>02</span>
              <h3>Generate a plan</h3>
              <p>
                Find feasible assignments and identify scheduling conflicts.
              </p>
            </div>

            <div>
              <span>03</span>
              <h3>Review and publish</h3>
              <p>
                Let the coordinator review the draft before publishing it.
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <a className="brand footer-brand" href="#home">
          <span className="brand-mark">✦</span>
          <span>
            <strong>CHRONOS</strong>
            <small>INTERVIEW SCHEDULER</small>
          </span>
        </a>

        <p>Bringing order to every interview.</p>

        <span className="footer-tag">
          WEBSTER 2026 · SILICON SYMPHONY
        </span>
      </footer>
    </div>
  );
}

export default App;