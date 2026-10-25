import { useEffect, useState } from "react";

const API_URL = "http://localhost:5000/api";

const styles = {
  page: {
    minHeight: "calc(100vh - 58px)",
    background: "#101013",
    color: "#f5f2eb",
    padding: "32px 20px 56px",
    fontFamily: "inherit",
    boxSizing: "border-box",
  },
  container: {
    maxWidth: "900px",
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
    fontSize: "clamp(26px, 4vw, 36px)",
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
    padding: "24px",
    marginTop: "24px",
    boxSizing: "border-box",
  },
  label: {
    display: "block",
    marginBottom: "9px",
    fontSize: "14px",
    fontWeight: 600,
  },
  select: {
    width: "100%",
    padding: "12px",
    borderRadius: "7px",
    border: "1px solid #504b53",
    background: "#111115",
    color: "#f5f2eb",
    fontSize: "15px",
    boxSizing: "border-box",
  },
  primaryButton: {
    padding: "12px 18px",
    borderRadius: "7px",
    border: "1px solid #d9b66b",
    background: "#d9b66b",
    color: "#211b10",
    fontWeight: 700,
    fontSize: "14px",
    cursor: "pointer",
  },
  secondaryButton: {
    padding: "11px 16px",
    borderRadius: "7px",
    border: "1px solid #706675",
    background: "transparent",
    color: "#f5f2eb",
    fontWeight: 600,
    fontSize: "14px",
    cursor: "pointer",
  },
  notice: {
    padding: "13px 15px",
    borderRadius: "7px",
    lineHeight: 1.6,
    fontSize: "14px",
    marginTop: "18px",
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

function formatSubmittedAt(value) {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleString();
}

export default function InterviewerDashboard() {
  const [events, setEvents] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [availability, setAvailability] = useState(null);
  const [selectedSlots, setSelectedSlots] = useState([]);

  const [loadingEvents, setLoadingEvents] = useState(true);
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [saving, setSaving] = useState(false);

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadEvents() {
      setLoadingEvents(true);
      setError("");

      try {
        const response = await fetch(`${API_URL}/interviewer/events`, {
          credentials: "include",
        });

        const body = await readResponse(response);

        if (cancelled) return;

        const assignedEvents = Array.isArray(body.events)
          ? body.events
          : [];

        setEvents(assignedEvents);

        setSelectedEventId((current) => {
          if (
            current &&
            assignedEvents.some((event) => event.eventId === current)
          ) {
            return current;
          }

          return assignedEvents[0]?.eventId || "";
        });
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError.message);
        }
      } finally {
        if (!cancelled) {
          setLoadingEvents(false);
        }
      }
    }

    loadEvents();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedEventId) {
      setAvailability(null);
      setSelectedSlots([]);
      return;
    }

    let cancelled = false;

    async function loadAvailability() {
      setLoadingAvailability(true);
      setAvailability(null);
      setSelectedSlots([]);
      setError("");
      setMessage("");

      try {
        const response = await fetch(
          `${API_URL}/interviewer/events/${selectedEventId}/availability`,
          {
            credentials: "include",
          }
        );

        const body = await readResponse(response);

        if (cancelled) return;

        setAvailability(body);
        setSelectedSlots(body.availableSlots || []);
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError.message);
        }
      } finally {
        if (!cancelled) {
          setLoadingAvailability(false);
        }
      }
    }

    loadAvailability();

    return () => {
      cancelled = true;
    };
  }, [selectedEventId]);

  function toggleSlot(time, checked) {
    setSelectedSlots((current) => {
      if (checked) {
        return current.includes(time)
          ? current
          : [...current, time].sort();
      }

      return current.filter((slot) => slot !== time);
    });

    setMessage("");
    setError("");
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!selectedEventId || !availability?.editable || saving) {
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(
        `${API_URL}/interviewer/events/${selectedEventId}/availability`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            availableSlots: selectedSlots,
          }),
        }
      );

      const body = await readResponse(response);

      setSelectedSlots(body.availableSlots || []);

      setAvailability((current) => {
        if (!current) return current;

        const savedSlots = body.availableSlots || [];

        return {
          ...current,
          event: {
            ...current.event,
            hasSubmitted: true,
            submittedAt: body.submittedAt,
          },
          availableSlots: savedSlots,
          timeSlots: current.timeSlots.map((slot) => ({
            ...slot,
            selected: savedSlots.includes(slot.time),
          })),
        };
      });

      setEvents((current) =>
        current.map((item) =>
          item.eventId === selectedEventId
            ? {
                ...item,
                hasSubmitted: true,
                submittedAt: body.submittedAt,
                availableSlots: body.availableSlots || [],
              }
            : item
        )
      );

      setMessage("Your availability has been saved successfully.");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  const event = availability?.event;
  const editable = availability?.editable === true;

  return (
    <main style={styles.page}>
      <div style={styles.container}>
        <p style={styles.eyebrow}>CHRONOS · INTERVIEWER WORKSPACE</p>

        <h1 style={styles.heading}>Your availability</h1>

        <p style={styles.muted}>
          Choose the recruitment event you're assigned to, select the time
          slots when you're available, and submit your choices. You can update
          your submission while the event is still a draft.
        </p>

        <section style={styles.panel}>
          <label htmlFor="interviewer-event" style={styles.label}>
            Recruitment event
          </label>

          {loadingEvents ? (
            <p style={styles.muted}>Loading your assigned events...</p>
          ) : events.length === 0 ? (
            <p style={styles.muted}>
              No events are assigned to your interviewer profile yet. Contact
              your coordinator if you think an event should appear here.
            </p>
          ) : (
            <select
              id="interviewer-event"
              value={selectedEventId}
              onChange={(eventChange) => {
                setSelectedEventId(eventChange.target.value);
              }}
              style={styles.select}
              disabled={saving}
            >
              {events.map((item) => (
                <option key={item.eventId} value={item.eventId}>
                  {item.eventName} — {item.eventDate} ({item.status})
                </option>
              ))}
            </select>
          )}

          {loadingAvailability && (
            <p style={styles.muted}>Loading the event's time slots...</p>
          )}

          {event && !loadingAvailability && (
            <div style={{ marginTop: "24px" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: "12px",
                }}
              >
                <div>
                  <h2 style={{ fontSize: "22px", margin: "0 0 6px" }}>
                    {event.eventName}
                  </h2>

                  <p style={{ color: "#bcb6c2", margin: 0 }}>
                    Event date: {event.eventDate}
                  </p>
                </div>

                <span
                  style={{
                    fontSize: "12px",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "1px",
                    padding: "7px 10px",
                    borderRadius: "5px",
                    border: "1px solid #504b53",
                    color: editable ? "#e6ce95" : "#c5bdc9",
                  }}
                >
                  {event.status}
                </span>
              </div>

              {event.hasSubmitted && (
                <p style={{ ...styles.muted, fontSize: "13px" }}>
                  Availability submitted
                  {event.submittedAt
                    ? ` on ${formatSubmittedAt(event.submittedAt)}`
                    : ""}
                  .
                </p>
              )}

              {!editable && (
                <div
                  role="status"
                  style={{
                    ...styles.notice,
                    background: "#242127",
                    border: "1px solid #504b53",
                    color: "#d4cdd9",
                  }}
                >
                  This event is no longer a draft. Your availability is
                  available to view, but it cannot be changed.
                </div>
              )}

              <form onSubmit={handleSubmit}>
                <h3 style={{ fontSize: "17px", margin: "28px 0 8px" }}>
                  Select your available times
                </h3>

                <p style={{ ...styles.muted, fontSize: "14px" }}>
                  Select every time slot when you can attend. You may submit
                  zero slots if you are unavailable for the entire event.
                </p>

                {availability.timeSlots.length === 0 ? (
                  <p style={styles.muted}>
                    No time slots have been configured for this event yet.
                  </p>
                ) : (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "repeat(auto-fit, minmax(145px, 1fr))",
                      gap: "10px",
                      marginTop: "18px",
                    }}
                  >
                    {availability.timeSlots.map((slot) => {
                      const checked = selectedSlots.includes(slot.time);

                      return (
                        <label
                          key={slot.time}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "10px",
                            padding: "13px",
                            borderRadius: "7px",
                            border: checked
                              ? "1px solid #d9b66b"
                              : "1px solid #504b53",
                            background: checked ? "#30291c" : "#111115",
                            cursor: editable ? "pointer" : "default",
                            opacity: editable ? 1 : 0.75,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={!editable || saving}
                            onChange={(change) =>
                              toggleSlot(slot.time, change.target.checked)
                            }
                          />

                          <span>{slot.time}</span>
                        </label>
                      );
                    })}
                  </div>
                )}

                <p style={{ ...styles.muted, fontSize: "13px" }}>
                  Selected slots: {selectedSlots.length}
                </p>

                {editable && (
                  <button
                    type="submit"
                    disabled={saving || loadingAvailability}
                    style={{
                      ...styles.primaryButton,
                      marginTop: "12px",
                      opacity: saving ? 0.7 : 1,
                      cursor: saving ? "wait" : "pointer",
                    }}
                  >
                    {saving
                      ? "Saving availability..."
                      : event.hasSubmitted
                        ? "Update availability"
                        : "Submit availability"}
                  </button>
                )}
              </form>
            </div>
          )}

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