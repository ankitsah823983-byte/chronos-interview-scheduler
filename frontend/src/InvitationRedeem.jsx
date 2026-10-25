import { useState } from "react";

const API_URL = "http://localhost:5000/api";

const styles = {
  page: {
    minHeight: "100vh",
    background: "#101013",
    color: "#f5f2eb",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px",
    boxSizing: "border-box",
  },
  card: {
    width: "100%",
    maxWidth: "460px",
    padding: "32px",
    border: "1px solid #363238",
    borderRadius: "14px",
    background: "#19181d",
    boxSizing: "border-box",
  },
  label: {
    display: "block",
    marginTop: "20px",
    marginBottom: "8px",
    fontSize: "14px",
    fontWeight: 600,
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: "13px 14px",
    border: "1px solid #504b53",
    borderRadius: "7px",
    background: "#111115",
    color: "#ffffff",
    fontSize: "15px",
  },
  button: {
    width: "100%",
    padding: "14px",
    marginTop: "24px",
    border: "1px solid #d9b66b",
    borderRadius: "7px",
    background: "#d9b66b",
    color: "#211b10",
    fontWeight: 700,
    fontSize: "15px",
    cursor: "pointer",
  },
};

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    throw new Error("The server returned an invalid response.");
  }
}

export default function InvitationRedeem({ token }) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [sessionClearRequired, setSessionClearRequired] = useState(false);
  const [clearingSession, setClearingSession] = useState(false);
  const [error, setError] = useState("");

  async function clearPreviousSession() {
    setError("");
    setClearingSession(true);

    try {
      const response = await fetch(`${API_URL}/auth/logout`, {
        method: "POST",
        credentials: "include",
      });

      const body = await readJson(response);

      if (!response.ok || !body?.success) {
        throw new Error(
          body?.error || "The previous session could not be cleared."
        );
      }

      setSessionClearRequired(false);

      // Start a fresh sign-in flow with no previous workspace session.
      window.location.replace(`${window.location.origin}/`);
    } catch (requestError) {
      setError(
        `Your account is activated, but the previous browser session could not be cleared. Please retry before signing in. ${
          requestError.message || ""
        }`
      );
    } finally {
      setClearingSession(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");

    const passwordBytes = new TextEncoder().encode(password).length;

    if (passwordBytes < 12 || passwordBytes > 72) {
      setError("Password must be between 12 and 72 UTF-8 bytes.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch(`${API_URL}/auth/redeem-invitation`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          token,
          password,
        }),
      });

      const body = await readJson(response);

      if (!response.ok || !body?.success) {
        throw new Error(
          body?.error || "Could not activate your account."
        );
      }

      // The account is now activated. Do not sign in automatically.
      setPassword("");
      setConfirmPassword("");
      setCompleted(true);

      // Important: invalidate any previous coordinator/interviewer/candidate
      // session in this browser before the user returns to the sign-in page.
      try {
        const logoutResponse = await fetch(`${API_URL}/auth/logout`, {
          method: "POST",
          credentials: "include",
        });

        const logoutBody = await readJson(logoutResponse);

        if (!logoutResponse.ok || !logoutBody?.success) {
          throw new Error(
            logoutBody?.error || "The previous session could not be cleared."
          );
        }

        setSessionClearRequired(false);
      } catch (logoutError) {
        setSessionClearRequired(true);

        setError(
          "Your account was activated, but the previous session could not be cleared. Use the button below to clear it before signing in. " +
            (logoutError.message || "")
        );
      }
    } catch (requestError) {
      setError(
        requestError.message ||
          "Could not connect to Chronos. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <p
          style={{
            color: "#d9b66b",
            fontSize: "12px",
            letterSpacing: "2px",
            fontWeight: 700,
          }}
        >
          CHRONOS · ACCOUNT INVITATION
        </p>

        {!completed ? (
          <>
            <h1 style={{ fontSize: "29px", marginBottom: "10px" }}>
              Set up your account
            </h1>

            <p style={{ color: "#bcb6c2", lineHeight: 1.7 }}>
              Create a password to activate your invited Chronos account.
              Your invitation can only be used once.
            </p>

            <form onSubmit={handleSubmit}>
              <label htmlFor="invitation-password" style={styles.label}>
                New password
              </label>

              <input
                id="invitation-password"
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                style={styles.input}
              />

              <p
                style={{
                  color: "#9f98a5",
                  fontSize: "12px",
                  lineHeight: 1.5,
                  marginBottom: 0,
                }}
              >
                Use 12–72 UTF-8 bytes. A longer passphrase is a good choice.
              </p>

              <label
                htmlFor="invitation-confirm-password"
                style={styles.label}
              >
                Confirm password
              </label>

              <input
                id="invitation-confirm-password"
                type="password"
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(event) =>
                  setConfirmPassword(event.target.value)
                }
                style={styles.input}
              />

              {error && (
                <div
                  role="alert"
                  style={{
                    marginTop: "18px",
                    padding: "12px",
                    borderRadius: "7px",
                    background: "#321d20",
                    border: "1px solid #67383e",
                    color: "#ffcdcd",
                    fontSize: "14px",
                    lineHeight: 1.6,
                  }}
                >
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                style={{
                  ...styles.button,
                  opacity: submitting ? 0.7 : 1,
                  cursor: submitting ? "wait" : "pointer",
                }}
              >
                {submitting ? "Activating account..." : "Activate account"}
              </button>
            </form>

            <p
              style={{
                color: "#9f98a5",
                fontSize: "12px",
                lineHeight: 1.6,
                marginTop: "20px",
              }}
            >
              Invitation links expire after 24 hours. If this link has expired
              or already been used, ask your coordinator for a new invitation.
            </p>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: "29px", marginBottom: "10px" }}>
              Account activated!
            </h1>

            <p style={{ color: "#bcb6c2", lineHeight: 1.7 }}>
              Your account has been created successfully. Your previous
              browser session must be cleared before signing in, so this
              browser cannot accidentally reopen another user's workspace.
            </p>

            {error && (
              <div
                role="alert"
                style={{
                  marginTop: "18px",
                  padding: "12px",
                  borderRadius: "7px",
                  background: "#321d20",
                  border: "1px solid #67383e",
                  color: "#ffcdcd",
                  fontSize: "14px",
                  lineHeight: 1.6,
                }}
              >
                {error}
              </div>
            )}

            <button
              type="button"
              onClick={
                sessionClearRequired
                  ? clearPreviousSession
                  : () =>
                      window.location.replace(
                        `${window.location.origin}/`
                      )
              }
              disabled={clearingSession}
              style={{
                ...styles.button,
                opacity: clearingSession ? 0.7 : 1,
                cursor: clearingSession ? "wait" : "pointer",
              }}
            >
              {clearingSession
                ? "Clearing previous session..."
                : sessionClearRequired
                  ? "Clear previous session and continue"
                  : "Continue to sign in"}
            </button>
          </>
        )}
      </section>
    </main>
  );
}