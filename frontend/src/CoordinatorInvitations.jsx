import { useEffect, useState } from "react";

const API_URL = "http://localhost:5000/api";

const styles = {
  panel: {
    maxWidth: "900px",
    margin: "28px auto",
    padding: "24px",
    background: "#19181d",
    color: "#f5f2eb",
    border: "1px solid #363238",
    borderRadius: "12px",
    boxSizing: "border-box",
  },
  label: {
    display: "block",
    marginTop: "18px",
    marginBottom: "8px",
    fontSize: "14px",
    fontWeight: 600,
  },
  input: {
    width: "100%",
    padding: "12px",
    border: "1px solid #504b53",
    borderRadius: "7px",
    background: "#111115",
    color: "#f5f2eb",
    fontSize: "14px",
    boxSizing: "border-box",
  },
  button: {
    padding: "12px 16px",
    border: "1px solid #d9b66b",
    borderRadius: "7px",
    background: "#d9b66b",
    color: "#211b10",
    fontWeight: 700,
    cursor: "pointer",
  },
  secondaryButton: {
    padding: "12px 16px",
    border: "1px solid #706675",
    borderRadius: "7px",
    background: "transparent",
    color: "#f5f2eb",
    fontWeight: 600,
    cursor: "pointer",
  },
  muted: {
    color: "#bcb6c2",
    fontSize: "14px",
    lineHeight: 1.7,
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

export default function CoordinatorInvitations() {
  const [events, setEvents] = useState([]);
  const [eventId, setEventId] = useState("");
  const [configuration, setConfiguration] = useState(null);

  const [role, setRole] = useState("candidate");
  const [profileId, setProfileId] = useState("");

  const [loadingEvents, setLoadingEvents] = useState(true);
  const [loadingProfiles, setLoadingProfiles] = useState(false);
  const [creating, setCreating] = useState(false);

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [invitationLink, setInvitationLink] = useState("");
  const [invitationDetails, setInvitationDetails] = useState(null);

  useEffect(() => {
    const controller = new AbortController();

    async function loadEvents() {
      setLoadingEvents(true);
      setError("");

      try {
        const response = await fetch(`${API_URL}/events`, {
          credentials: "include",
          signal: controller.signal,
        });

        const body = await readResponse(response);
        const loadedEvents = Array.isArray(body.events) ? body.events : [];

        if (controller.signal.aborted) return;

        setEvents(loadedEvents);

        setEventId((current) =>
          loadedEvents.some((event) => event.eventId === current)
            ? current
            : loadedEvents[0]?.eventId || ""
        );
      } catch (requestError) {
        if (requestError.name !== "AbortError" && !controller.signal.aborted) {
          setError(requestError.message);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoadingEvents(false);
        }
      }
    }

    loadEvents();

    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!eventId) {
      setConfiguration(null);
      setProfileId("");
      setLoadingProfiles(false);
      return;
    }

    const controller = new AbortController();

    async function loadConfiguration() {
      setLoadingProfiles(true);
      setConfiguration(null);
      setProfileId("");
      setError("");
      setMessage("");
      setInvitationLink("");
      setInvitationDetails(null);

      try {
        const response = await fetch(
          `${API_URL}/schedules/${eventId}`,
          {
            credentials: "include",
            signal: controller.signal,
          }
        );

        const body = await readResponse(response);

        if (controller.signal.aborted) return;

        setConfiguration(body.configuration);
      } catch (requestError) {
        if (requestError.name !== "AbortError" && !controller.signal.aborted) {
          setError(requestError.message);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoadingProfiles(false);
        }
      }
    }

    loadConfiguration();

    return () => controller.abort();
  }, [eventId]);

  const profiles =
    role === "candidate"
      ? configuration?.candidates || []
      : configuration?.interviewers || [];

  useEffect(() => {
    if (!profiles.some((profile) => profile.id === profileId)) {
      setProfileId(profiles[0]?.id || "");
    }
  }, [role, configuration, profileId, profiles.length]);

  async function handleCreateInvitation(event) {
    event.preventDefault();

    if (!eventId || !profileId || creating) {
      return;
    }

    setCreating(true);
    setError("");
    setMessage("");
    setInvitationLink("");
    setInvitationDetails(null);

    try {
      const payload =
        role === "candidate"
          ? { role, candidateId: profileId }
          : { role, interviewerId: profileId };

      const response = await fetch(`${API_URL}/invitations`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const body = await readResponse(response);

      if (!body.token) {
        throw new Error("The server did not return an invitation token.");
      }

      const link = new URL(window.location.origin);
      link.searchParams.set("invite", body.token);

      setInvitationLink(link.toString());
      setInvitationDetails(body.invitation);
      setMessage(
        "Invitation created. Copy the link and send it to the invited person."
      );
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setCreating(false);
    }
  }

  async function handleCopyLink() {
    if (!invitationLink) return;

    try {
      await navigator.clipboard.writeText(invitationLink);
      setMessage("Invitation link copied to clipboard.");
    } catch {
      setError(
        "Automatic copying failed. Select the link field and copy it manually."
      );
    }
  }

  return (
    <section style={styles.panel}>
      <p
        style={{
          color: "#d9b66b",
          fontSize: "12px",
          fontWeight: 700,
          letterSpacing: "2px",
          marginTop: 0,
        }}
      >
        CHRONOS · ACCOUNT MANAGEMENT
      </p>

      <h2 style={{ fontSize: "25px", marginBottom: "8px" }}>
        Invite a candidate or interviewer
      </h2>

      <p style={styles.muted}>
        Select a saved recruitment event and an existing profile. The
        invitation link allows the recipient to set a password and activate
        their account.
      </p>

      {loadingEvents ? (
        <p style={styles.muted}>Loading saved events...</p>
      ) : events.length === 0 ? (
        <p style={styles.muted}>
          No saved recruitment events are available yet. Create and save an
          event with candidate or interviewer profiles first.
        </p>
      ) : (
        <form onSubmit={handleCreateInvitation}>
          <label htmlFor="invitation-event" style={styles.label}>
            Recruitment event
          </label>

          <select
            id="invitation-event"
            value={eventId}
            onChange={(event) => setEventId(event.target.value)}
            style={styles.input}
            disabled={creating}
          >
            {events.map((item) => (
              <option key={item.eventId} value={item.eventId}>
                {item.eventName} — {item.eventDate} ({item.status})
              </option>
            ))}
          </select>

          <label htmlFor="invitation-role" style={styles.label}>
            Account role
          </label>

          <select
            id="invitation-role"
            value={role}
            onChange={(event) => {
              setRole(event.target.value);
              setInvitationLink("");
              setInvitationDetails(null);
              setMessage("");
              setError("");
            }}
            style={styles.input}
            disabled={creating}
          >
            <option value="candidate">Candidate</option>
            <option value="interviewer">Interviewer</option>
          </select>

          <label htmlFor="invitation-profile" style={styles.label}>
            Existing profile
          </label>

          {loadingProfiles ? (
            <p style={styles.muted}>Loading profiles for this event...</p>
          ) : (
            <select
              id="invitation-profile"
              value={profileId}
              onChange={(event) => {
                setProfileId(event.target.value);
                setInvitationLink("");
                setInvitationDetails(null);
                setMessage("");
                setError("");
              }}
              style={styles.input}
              disabled={creating || profiles.length === 0}
            >
              {profiles.length === 0 ? (
                <option value="">No profiles available in this event</option>
              ) : (
                profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name || "Unnamed profile"}
                  </option>
                ))
              )}
            </select>
          )}

          {profiles.length === 0 && !loadingProfiles && (
            <p style={styles.muted}>
              This event has no saved {role} profiles. Add the profile, save a
              successful schedule, then return here to invite them.
            </p>
          )}

          <button
            type="submit"
            disabled={
              creating ||
              loadingProfiles ||
              loadingEvents ||
              !eventId ||
              !profileId
            }
            style={{
              ...styles.button,
              marginTop: "22px",
              opacity: creating || !profileId ? 0.6 : 1,
              cursor: creating || !profileId ? "wait" : "pointer",
            }}
          >
            {creating ? "Creating invitation..." : "Generate invitation link"}
          </button>
        </form>
      )}

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

      {message && (
        <div
          role="status"
          style={{
            marginTop: "18px",
            padding: "12px",
            borderRadius: "7px",
            background: "#202a22",
            border: "1px solid #3d6044",
            color: "#c6f0cd",
            fontSize: "14px",
            lineHeight: 1.6,
          }}
        >
          {message}
        </div>
      )}

      {invitationLink && (
        <div
          style={{
            marginTop: "22px",
            padding: "16px",
            borderRadius: "8px",
            border: "1px solid #504b53",
            background: "#111115",
          }}
        >
          <p style={{ marginTop: 0, fontWeight: 700 }}>
            Invitation link
          </p>

          <label htmlFor="generated-invitation-link" style={styles.label}>
            One-time link
          </label>

          <input
            id="generated-invitation-link"
            value={invitationLink}
            readOnly
            onFocus={(event) => event.target.select()}
            style={styles.input}
          />

          <button
            type="button"
            onClick={handleCopyLink}
            style={{ ...styles.button, marginTop: "12px" }}
          >
            Copy invitation link
          </button>

          {invitationDetails?.expiresAt && (
            <p style={styles.muted}>
              Expires: {new Date(invitationDetails.expiresAt).toLocaleString()}
            </p>
          )}

          <p style={styles.muted}>
            This link is valid for 24 hours and can only be redeemed once.
            Generate a replacement if it expires or is revoked.
          </p>
        </div>
      )}
    </section>
  );
}