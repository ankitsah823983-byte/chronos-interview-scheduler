import "./App.css";

function App() {
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
          </div>
        </section>

        <section className="principles" id="features">
          <div className="section-heading">
            <p className="section-kicker">THE CHRONOS APPROACH</p>
            <h2>Complex schedules. <span>Clear decisions.</span></h2>
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
              <p>Collect availability, skills, rooms and interview requirements.</p>
            </div>
            <div>
              <span>02</span>
              <h3>Generate a plan</h3>
              <p>Find feasible assignments and identify scheduling conflicts.</p>
            </div>
            <div>
              <span>03</span>
              <h3>Review and publish</h3>
              <p>Let the coordinator review the draft before publishing it.</p>
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
        <span className="footer-tag">WEBSTER 2026 · SILICON SYMPHONY</span>
      </footer>
    </div>
  );
}

export default App;