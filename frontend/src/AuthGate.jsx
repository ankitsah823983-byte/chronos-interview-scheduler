import { useEffect, useState } from "react";
import InterviewerDashboard from "./InterviewerDashboard";
import CandidateDashboard from "./CandidateDashboard";
import InvitationRedeem from "./InvitationRedeem";

const API_URL = "http://localhost:5000";

function isSupportedRole(role) {
  return ["coordinator", "interviewer", "candidate"].includes(role);
}

export default function AuthGate({ children }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [user, setUser] = useState(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState("");

  // Invitation URLs will use: http://localhost:5173/?invite=TOKEN
  const invitationToken =
    new URLSearchParams(window.location.search).get("invite")?.trim() || "";

  useEffect(() => {
    let cancelled = false;

    async function checkSession() {
      // An invitation recipient should see the password setup page,
      // regardless of whether a different account has a current session.
      if (invitationToken) {
        setCheckingSession(false);
        return;
      }

      try {
        const response = await fetch(`${API_URL}/api/auth/me`, {
          credentials: "include",
        });

        const body = await response.json();

        if (cancelled) return;

        if (
          response.ok &&
          body.success &&
          isSupportedRole(body.user?.role)
        ) {
          setUser(body.user);
        } else {
          setUser(null);
        }
      } catch {
        if (!cancelled) {
          setError(
            "Could not connect to Chronos. Make sure the backend is running."
          );
        }
      } finally {
        if (!cancelled) {
          setCheckingSession(false);
        }
      }
    }

    checkSession();

    return () => {
      cancelled = true;
    };
  }, [invitationToken]);

  async function handleLogin(event) {
    event.preventDefault();
    setError("");

    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch(`${API_URL}/api/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: email.trim(),
          password,
        }),
      });

      const body = await response.json();

      if (!response.ok || !body.success) {
        setError(body.error || "Login failed. Check your credentials.");
        return;
      }

      if (!isSupportedRole(body.user?.role)) {
        await fetch(`${API_URL}/api/auth/logout`, {
          method: "POST",
          credentials: "include",
        });

        setPassword("");
        setError("This account does not have access to a Chronos workspace.");
        return;
      }

      setUser(body.user);
      setPassword("");
    } catch {
      setError(
        "Could not connect to Chronos. Make sure the backend is running."
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLogout() {
    setError("");
    setLoggingOut(true);

    try {
      const response = await fetch(`${API_URL}/api/auth/logout`, {
        method: "POST",
        credentials: "include",
      });

      let body;

      try {
        body = await response.json();
      } catch {
        body = null;
      }

      if (!response.ok || !body?.success) {
        setError(body?.error || "Logout failed. Please try again.");
        return;
      }

      setUser(null);
      setPassword("");
      setEmail("");
    } catch {
      setError(
        "Could not contact the backend to log out. Check your connection."
      );
    } finally {
      setLoggingOut(false);
    }
  }

  const pageStyle = {
    minHeight: "100vh",
    background: "#101013",
    color: "#f5f2eb",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px",
    fontFamily: "inherit",
    boxSizing: "border-box",
  };

  const cardStyle = {
    width: "100%",
    maxWidth: "440px",
    padding: "32px",
    border: "1px solid #363238",
    borderRadius: "14px",
    background: "#19181d",
    boxSizing: "border-box",
  };

  const inputStyle = {
    width: "100%",
    boxSizing: "border-box",
    padding: "13px 14px",
    border: "1px solid #504b53",
    borderRadius: "7px",
    background: "#111115",
    color: "#ffffff",
    fontSize: "15px",
  };

  const buttonStyle = {
    width: "100%",
    padding: "14px",
    border: "1px solid #d9b66b",
    borderRadius: "7px",
    background: "#d9b66b",
    color: "#211b10",
    fontWeight: 600,
    fontSize: "15px",
    cursor: "pointer",
  };

  // Invitation redemption takes precedence over any existing session.
  if (invitationToken) {
    return <InvitationRedeem token={invitationToken} />;
  }

  if (checkingSession) {
    return (
      <main style={pageStyle}>
        <p>Checking your Chronos session...</p>
      </main>
    );
  }

  if (user) {
    const roleLabel = {
      coordinator: "Coordinator",
      interviewer: "Interviewer",
      candidate: "Candidate",
    }[user.role];

    return (
      <>
        <header
          style={{
            background: "#19181d",
            borderBottom: "1px solid #363238",
            color: "#f5f2eb",
            padding: "12px 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "16px",
            flexWrap: "wrap",
          }}
        >
          <span>
            Signed in as <strong>{user.fullName}</strong>
            {" · "}
            {roleLabel}
          </span>

          <button
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
            style={{
              padding: "8px 14px",
              border: "1px solid #706675",
              borderRadius: "6px",
              background: "transparent",
              color: "#f5f2eb",
              cursor: loggingOut ? "wait" : "pointer",
              opacity: loggingOut ? 0.7 : 1,
            }}
          >
            {loggingOut ? "Logging out..." : "Log out"}
          </button>
        </header>

        {error && (
          <div
            role="alert"
            style={{
              padding: "12px 24px",
              background: "#321d20",
              color: "#ffcdcd",
            }}
          >
            {error}
          </div>
        )}

        {user.role === "candidate" ? (
          <CandidateDashboard />
        ) : user.role === "interviewer" ? (
          <InterviewerDashboard />
        ) : (
          children
        )}
      </>
    );
  }

  return (
    <main style={pageStyle}>
      <section style={cardStyle}>
        <p
          style={{
            color: "#d9b66b",
            fontSize: "12px",
            letterSpacing: "2px",
            fontWeight: 700,
          }}
        >
          CHRONOS · WORKSPACE ACCESS
        </p>

        <h1 style={{ fontSize: "30px", marginBottom: "10px" }}>
          Welcome back.
        </h1>

        <p style={{ color: "#bcb6c2", lineHeight: 1.6 }}>
          Sign in to access your Chronos workspace.
        </p>

        <form onSubmit={handleLogin}>
          <label
            htmlFor="chronos-email"
            style={{
              display: "block",
              marginTop: "22px",
              marginBottom: "8px",
            }}
          >
            Email
          </label>

          <input
            id="chronos-email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            style={inputStyle}
          />

          <label
            htmlFor="chronos-password"
            style={{
              display: "block",
              marginTop: "18px",
              marginBottom: "8px",
            }}
          >
            Password
          </label>

          <input
            id="chronos-password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            style={inputStyle}
          />

          {error && (
            <p
              role="alert"
              style={{
                color: "#ffaaaa",
                fontSize: "14px",
                lineHeight: 1.5,
                marginTop: "16px",
              }}
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            style={{
              ...buttonStyle,
              marginTop: "24px",
              opacity: submitting ? 0.7 : 1,
            }}
          >
            {submitting ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <p
          style={{
            marginTop: "20px",
            color: "#9f98a5",
            fontSize: "13px",
            lineHeight: 1.6,
          }}
        >
          Coordinator accounts are provisioned by an authorized administrator.
          Interviewer accounts use invitations. Candidate accounts can access
          their published interviews and booking status.
        </p>
      </section>
    </main>
  );
}