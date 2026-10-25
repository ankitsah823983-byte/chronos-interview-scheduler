import { useCallback, useEffect, useState } from "react";

const API_URL = "http://localhost:5000/api";

const styles = {
  page: {
    minHeight: "calc(100vh - 58px)",
    background: "#101013",
    color: "#f5f2eb",
    padding: "32px 20px 56px",
    boxSizing: "border-box",
  },
  container: {
    maxWidth: "960px",
    margin: "0 auto",
  },
  eyebrow: {
    color: "#d9b66b",
    fontSize: "12px",
    letterSpacing: "2px",
    fontWeight: 700,
    marginBottom: "12px",
  },
  heading: {
    fontSize: "clamp(27px, 4vw, 36px)",
    lineHeight: 1.2,
    margin: "0 0 12px",
  },
  muted: {
    color: "#bcb6c2",
    lineHeight: 1.7,
  },
  panel: {
    background: "#19181d",
    border: "1px solid #363238",
    borderRadius: "12px",
    padding: "22px",
    marginTop: "22px",
    boxSizing: "border-box",
  },
  button: {
    padding: "11px 16px",
    border: "1px solid #d9b66b",
    borderRadius: "7px",
    background: "#d9b66b",
    color: "#211b10",
    fontWeight: 700,
    fontSize: "14px",
    cursor: "pointer",
  },
  secondaryButton: {
    padding: "10px 14px",
    border: "1px solid #706675",
    borderRadius: "7px",
    background: "transparent",
    color: "#f5f2eb",
    fontWeight: 600,
    fontSize: "13px",
    cursor: "pointer",
  },
  notice: {
    padding: "13px 15px",
    borderRadius: "7px",
    marginTop: "18px",
    fontSize: "14px",
    lineHeight: 1.6,
  },
};

async function readResponse(response) {
  let body;

  try {
    body = await response.json();
  } catch {
    throw new Error("The server returned an invalid response.");
  }

  if (!response.ok || !body.success) {
    throw new Error(body.error || "The request could not be completed.");
  }

  return body;
}

function formatStatus(status) {
  switch (status) {
    case "published":
      return "Ready to book";
    case "booked":
      return "Booked";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

function statusStyle(status) {
  if (status === "booked") {
    return {
      color: "#c6f0cd",
      borderColor: "#3d6044",
      background: "#202a22",
    };
  }

  if (status === "published") {
    return {
      color: "#e6ce95",
      borderColor: "#76613a",
      background: "#30291c",
    };
  }

  return {
    color: "#c5bdc9",
    borderColor: "#504b53",
    background: "#242127",
  };
}

export default function CandidateDashboard() {
  const [interviews, setInterviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [bookingId, setBookingId] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [refreshCount, setRefreshCount] = useState(0);

  const loadInterviews = useCallback(async (signal) => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(`${API_URL}/candidate/interviews`, {
        credentials: "include",
        signal,
      });

      const body = await readResponse(response);

      setInterviews(Array.isArray(body.interviews) ? body.interviews : []);
    } catch (requestError) {
      if (requestError.name !== "AbortError") {
        setError(requestError.message);
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    loadInterviews(controller.signal);

    return () => controller.abort();
  }, [loadInterviews, refreshCount]);

  async function handleBook(interview) {
    if (bookingId !== null || interview.bookingStatus !== "published") {
      return;
    }

    setBookingId(interview.scheduleId);
    setError("");
    setMessage("");

    try {
      const response = await fetch(
        `${API_URL}/candidate/interviews/${interview.scheduleId}/book`,
        {
          method: "POST",
          credentials: "include",
        }
      );

      const body = await readResponse(response);

      setInterviews((current) =>
        current.map((item) =>
          item.scheduleId === interview.scheduleId
            ? {
                ...item,
                bookingStatus: body.interview.bookingStatus,
              }
            : item
        )
      );

      setMessage(
        `Your interview for ${interview.eventName} has been booked successfully.`
      );
    } catch (requestError) {
      setError(requestError.message);

      // Reload the authoritative server state in case another request
      // booked the interview concurrently.
      setRefreshCount((count) => count + 1);
    } finally {
      setBookingId(null);
    }
  }

  const bookableCount = interviews.filter(
    (interview) => interview.bookingStatus === "published"
  ).length;

  const bookedCount = interviews.filter(
    (interview) => interview.bookingStatus === "booked"
  ).length;

  return (
    <main style={styles.page}>
      <div style={styles.container}>
        <p style={styles.eyebrow}>CHRONOS · CANDIDATE WORKSPACE</p>

        <h1 style={styles.heading}>Your interviews</h1>

        <p style={styles.muted}>
          View your published interview schedule and confirm your booking.
          Your interview details will remain available here after you book.
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: "12px",
            marginTop: "24px",
          }}
        >
          {[
            { label: "Your interviews", value: interviews.length },
            { label: "Ready to book", value: bookableCount },
            { label: "Booked", value: bookedCount },
          ].map((item) => (
            <section
              key={item.label}
              style={{
                ...styles.panel,
                marginTop: 0,
                padding: "18px",
              }}
            >
              <p style={{ ...styles.muted, margin: "0 0 8px", fontSize: "13px" }}>
                {item.label}
              </p>

              <strong style={{ fontSize: "28px" }}>{item.value}</strong>
            </section>
          ))}
        </div>

        <section style={styles.panel}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "12px",
              flexWrap: "wrap",
            }}
          >
            <h2 style={{ fontSize: "21px", margin: 0 }}>
              Published interview schedule
            </h2>

            <button
              type="button"
              onClick={() => setRefreshCount((count) => count + 1)}
              disabled={loading || bookingId !== null}
              style={{
                ...styles.secondaryButton,
                opacity: loading ? 0.6 : 1,
              }}
            >
              Refresh
            </button>
          </div>

          {loading && (
            <p style={styles.muted}>Loading your interviews...</p>
          )}

          {!loading && !error && interviews.length === 0 && (
            <div style={{ marginTop: "24px" }}>
              <h3 style={{ fontSize: "17px" }}>
                No published interviews yet
              </h3>

              <p style={styles.muted}>
                Once your coordinator publishes an interview assigned to your
                candidate profile, it will appear here.
              </p>
            </div>
          )}

          {!loading &&
            interviews.map((interview) => (
              <article
                key={interview.scheduleId}
                style={{
                  marginTop: "20px",
                  padding: "20px",
                  border: "1px solid #403b45",
                  borderRadius: "9px",
                  background: "#141317",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: "14px",
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <p
                      style={{
                        ...styles.eyebrow,
                        marginBottom: "8px",
                        letterSpacing: "1px",
                      }}
                    >
                      {interview.eventDate}
                    </p>

                    <h3 style={{ fontSize: "20px", margin: "0 0 6px" }}>
                      {interview.eventName}
                    </h3>

                    <p style={{ ...styles.muted, margin: 0 }}>
                      {interview.roundName}
                    </p>
                  </div>

                  <span
                    style={{
                      ...statusStyle(interview.bookingStatus),
                      display: "inline-block",
                      padding: "7px 10px",
                      border: "1px solid",
                      borderRadius: "6px",
                      fontSize: "12px",
                      fontWeight: 700,
                    }}
                  >
                    {formatStatus(interview.bookingStatus)}
                  </span>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                    gap: "16px",
                    marginTop: "22px",
                  }}
                >
                  <div>
                    <p style={{ ...styles.muted, fontSize: "12px", margin: 0 }}>
                      Interview time
                    </p>

                    <strong>
                      {interview.startTime}–{interview.endTime}
                    </strong>
                  </div>

                  <div>
                    <p style={{ ...styles.muted, fontSize: "12px", margin: 0 }}>
                      Interviewer
                    </p>

                    <strong>{interview.interviewerNames || "To be announced"}</strong>
                  </div>

                  <div>
                    <p style={{ ...styles.muted, fontSize: "12px", margin: 0 }}>
                      Room
                    </p>

                    <strong>{interview.roomName || "To be announced"}</strong>
                  </div>
                </div>

                {interview.bookingStatus === "published" && (
                  <button
                    type="button"
                    onClick={() => handleBook(interview)}
                    disabled={bookingId !== null}
                    style={{
                      ...styles.button,
                      marginTop: "22px",
                      opacity: bookingId !== null ? 0.7 : 1,
                      cursor: bookingId !== null ? "wait" : "pointer",
                    }}
                  >
                    {bookingId === interview.scheduleId
                      ? "Confirming booking..."
                      : "Book interview"}
                  </button>
                )}

                {interview.bookingStatus === "booked" && (
                  <p style={{ ...styles.muted, marginBottom: 0, fontSize: "13px" }}>
                    Your booking is confirmed. Keep these details for your interview.
                  </p>
                )}

                {interview.bookingStatus === "cancelled" && (
                  <p style={{ ...styles.muted, marginBottom: 0, fontSize: "13px" }}>
                    This interview has been cancelled. Please contact your coordinator.
                  </p>
                )}
              </article>
            ))}

          {error && (
            <div
              role="alert"
              style={{
                ...styles.notice,
                background: "#321d20",
                border: "1px solid #67383e",
                color: "#ffcdcd",
              }}
            >
              {error}
            </div>
          )}

          {message && (
            <div
              role="status"
              style={{
                ...styles.notice,
                background: "#202a22",
                border: "1px solid #3d6044",
                color: "#c6f0cd",
              }}
            >
              {message}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}