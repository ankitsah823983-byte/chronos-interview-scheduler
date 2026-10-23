import { useState } from "react";
import "./App.css";

function App() {
  const [generatedSchedule, setGeneratedSchedule] = useState([]);
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState("");
  const [apiMessage, setApiMessage] = useState("");

  async function handleGenerateSchedule() {
    setLoading(true);
    setApiError("");
    setApiMessage("");
    setGeneratedSchedule([]);

    // Demo data sent to our backend scheduler.
    const payload = {
      timeSlots: ["10:00", "10:30", "11:00", "11:30"],

      candidates: [
        {
          id: "c1",
          name: "Candidate A",
          availableSlots: ["10:00", "10:30"],
        },
        {
          id: "c2",
          name: "Candidate B",
          availableSlots: [
            "10:00",
            "10:30",
            "11:00",
            "11:30",
          ],
        },
      ],

      interviewers: [
        {
          id: "i1",
          name: "Interviewer X",
          skills: ["DSA"],
          availableSlots: [
            "10:00",
            "10:30",
            "11:00",
            "11:30",
          ],
          maxInterviewsPerDay: 2,
        },
      ],

      rooms: [
        {
          id: "r1",
          name: "Room 1",
          availableSlots: [
            "10:00",
            "10:30",
            "11:00",
            "11:30",
          ],
        },
      ],

      tasks: [
        {
          id: "t1",
          candidateId: "c1",
          roundName: "Coding Interview",
          requiredSkills: ["DSA"],
          durationSlots: 1,
        },
        {
          id: "t2",
          candidateId: "c2",
          roundName: "Coding Interview",
          requiredSkills: ["DSA"],
          durationSlots: 1,
        },
      ],
    };

    try {
      const response = await fetch(
        "http://localhost:5000/api/schedule",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        }
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(
          data.error ||
            data.reason ||
            "Unable to generate a schedule."
        );
      }

      setGeneratedSchedule(data.schedule);

      setApiMessage(
        `Successfully generated ${data.schedule.length} interviews.`
      );
    } catch (error) {
      setApiError(
        error.message ||
          "Could not connect to the Chronos backend."
      );
    } finally {
      setLoading(false);
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
          <a href="#workflow">How it works</a>
        </nav>

        <a className="nav-button" href="#workflow">
          Explore platform <span>↗</span>
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
              <a className="primary-button" href="#workflow">
                Discover Chronos <span>→</span>
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
                <span className="status-dot" /> PREVIEW
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
              <span>INTERVIEW TIMELINE</span>
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
                <strong>Technical Round</strong>
                <small>Candidate B · Room 02</small>
              </div>

              <span className="event-check">✓</span>
            </div>

            <div className="timeline-row">
              <time>11:00</time>

              <div className="timeline-event event-blue">
                <strong>HR Interview</strong>
                <small>Candidate C · Room 01</small>
              </div>

              <span className="event-check">✓</span>
            </div>

            <p className="preview-caption">
              <span>✦</span> Illustrative schedule preview
              — not live interview data
            </p>

            {/* This button calls the actual backend scheduler. */}
            <button
              type="button"
              className="generate-button"
              onClick={handleGenerateSchedule}
              disabled={loading}
            >
              {loading
                ? "Generating schedule..."
                : "Generate real demo schedule"}
              <span> →</span>
            </button>

            {apiMessage && (
              <p className="api-message" role="status">
                ✓ {apiMessage}
              </p>
            )}

            {apiError && (
              <p className="api-error" role="alert">
                {apiError}
              </p>
            )}

            {generatedSchedule.length > 0 && (
              <div className="generated-results">
                <h3>Generated Schedule</h3>

                {generatedSchedule.map((item) => (
                  <div
                    className="generated-item"
                    key={item.taskId}
                  >
                    <strong>{item.roundName}</strong>

                    <span>
                      Candidate: {item.candidateId}
                    </span>

                    <span>
                      {item.startTime} – {item.endTime}
                    </span>

                    <span>
                      {item.interviewerName} · {item.roomName}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="principles" id="features">
          <div className="section-heading">
            <p className="section-kicker">
              THE CHRONOS APPROACH
            </p>

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
          <p className="section-kicker">
            FROM CHAOS TO CLARITY
          </p>

          <h2>Three steps to a better schedule.</h2>

          <div className="workflow-grid">
            <div>
              <span>01</span>
              <h3>Set the constraints</h3>
              <p>
                Collect availability, skills, rooms and interview
                requirements.
              </p>
            </div>

            <div>
              <span>02</span>
              <h3>Generate a plan</h3>
              <p>
                Find feasible assignments and identify scheduling
                conflicts.
              </p>
            </div>

            <div>
              <span>03</span>
              <h3>Review and publish</h3>
              <p>
                Let the coordinator review the draft before
                publishing it.
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