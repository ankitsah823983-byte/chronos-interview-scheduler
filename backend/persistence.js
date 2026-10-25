const { randomUUID } = require("crypto");
const pool = require("./db");

function createPersistenceError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isValidUuid(value) {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value
    )
  );
}

async function resolveInterviewerProfile(client, interviewer) {
  const name = interviewer.name?.trim() || interviewer.id;

  const email =
    typeof interviewer.email === "string" && interviewer.email.trim()
      ? interviewer.email.trim()
      : null;

  // Saved event configuration contains the actual database UUID.
  // Reuse it so account links and submissions remain attached.
  const suppliedId = isValidUuid(interviewer.id) ? interviewer.id : null;

  if (suppliedId) {
    const existingResult = await client.query(
      `SELECT interviewer_id
       FROM interviewers
       WHERE interviewer_id = $1
       FOR UPDATE`,
      [suppliedId]
    );

    if (existingResult.rowCount > 0) {
      await client.query(
        `UPDATE interviewers
         SET full_name = $2
         WHERE interviewer_id = $1`,
        [suppliedId, name]
      );

      return suppliedId;
    }
  }

  // If an email is supplied, try to reuse the matching existing profile.
  if (email) {
    const emailResult = await client.query(
      `SELECT interviewer_id
       FROM interviewers
       WHERE lower(trim(email)) = lower(trim($1))
       ORDER BY created_at, interviewer_id
       LIMIT 1`,
      [email]
    );

    if (emailResult.rowCount > 0) {
      const existingId = emailResult.rows[0].interviewer_id;

      await client.query(
        `UPDATE interviewers
         SET full_name = $2
         WHERE interviewer_id = $1`,
        [existingId, name]
      );

      return existingId;
    }
  }

  // New interviewer: keep a supplied UUID when available, otherwise
  // generate one. Existing database-backed UUIDs were handled above.
  const newId = suppliedId || randomUUID();

  const insertResult = await client.query(
    `INSERT INTO interviewers
       (interviewer_id, full_name, email)
     VALUES ($1, $2, $3)
     RETURNING interviewer_id`,
    [newId, name, email]
  );

  return insertResult.rows[0].interviewer_id;
}

async function readSubmittedAvailabilityByInterviewerId(client, eventId) {
  const result = await client.query(
    `SELECT
       submission.interviewer_id AS "interviewerId",
       to_char(selected.slot_time, 'HH24:MI') AS "slotTime"
     FROM interviewer_availability_submissions submission
     LEFT JOIN interviewer_availability_submission_slots selected
       ON selected.event_id = submission.event_id
      AND selected.interviewer_id = submission.interviewer_id
     WHERE submission.event_id = $1
     ORDER BY submission.interviewer_id, selected.slot_time`,
    [eventId]
  );

  const submissions = new Map();

  for (const row of result.rows) {
    if (!submissions.has(row.interviewerId)) {
      submissions.set(row.interviewerId, { slots: new Set() });
    }

    if (row.slotTime) {
      submissions.get(row.interviewerId).slots.add(row.slotTime);
    }
  }

  return submissions;
}

async function applySubmittedInterviewerAvailability(input) {
  if (
    !input ||
    !input.eventId ||
    !Array.isArray(input.interviewers) ||
    !Array.isArray(input.timeSlots)
  ) {
    return input;
  }

  const result = await pool.query(
    `SELECT
       submission.interviewer_id AS "interviewerId",
       to_char(selected.slot_time, 'HH24:MI') AS "slotTime"
     FROM interviewer_availability_submissions submission
     LEFT JOIN interviewer_availability_submission_slots selected
       ON selected.event_id = submission.event_id
      AND selected.interviewer_id = submission.interviewer_id
     WHERE submission.event_id = $1
     ORDER BY submission.interviewer_id, selected.slot_time`,
    [input.eventId]
  );

  const byInterviewerId = new Map();

  for (const row of result.rows) {
    if (!byInterviewerId.has(row.interviewerId)) {
      byInterviewerId.set(row.interviewerId, { slots: new Set() });
    }

    if (row.slotTime) {
      byInterviewerId.get(row.interviewerId).slots.add(row.slotTime);
    }
  }

  const validSlots = new Set(input.timeSlots);

  const interviewers = input.interviewers.map((interviewer) => {
    const submission = isValidUuid(interviewer.id)
      ? byInterviewerId.get(interviewer.id)
      : null;

    if (!submission) {
      return interviewer;
    }

    return {
      ...interviewer,
      availableSlots: [...submission.slots].filter((slot) =>
        validSlots.has(slot)
      ),
    };
  });

  return { ...input, interviewers };
}

async function clearDraftSchedule(client, eventId) {
  await client.query(
    `DELETE FROM scheduled_interviews
     WHERE event_id = $1`,
    [eventId]
  );

  await client.query(
    `DELETE FROM interview_tasks
     WHERE event_id = $1`,
    [eventId]
  );

  await client.query(
    `DELETE FROM candidate_availability
     WHERE event_id = $1`,
    [eventId]
  );

  await client.query(
    `DELETE FROM interviewer_availability
     WHERE event_id = $1`,
    [eventId]
  );

  await client.query(
    `DELETE FROM room_availability
     WHERE event_id = $1`,
    [eventId]
  );

  await client.query(
    `DELETE FROM event_candidates
     WHERE event_id = $1`,
    [eventId]
  );

  await client.query(
    `DELETE FROM event_interviewers
     WHERE event_id = $1`,
    [eventId]
  );

  await client.query(
    `DELETE FROM rooms
     WHERE event_id = $1`,
    [eventId]
  );

  await client.query(
    `DELETE FROM event_time_slots
     WHERE event_id = $1`,
    [eventId]
  );
}

async function persistScheduleRun({ input, result }) {
  const requestedEventId =
    typeof input.eventId === "string" && input.eventId.trim()
      ? input.eventId.trim()
      : null;

  const reusingEvent = Boolean(requestedEventId);
  const eventId = requestedEventId || randomUUID();
  const client = await pool.connect();

  let submittedAvailabilityByInterviewerId = new Map();

  try {
    await client.query("BEGIN");

    if (reusingEvent) {
      const eventResult = await client.query(
        `SELECT event_id, status
         FROM recruitment_events
         WHERE event_id = $1
         FOR UPDATE`,
        [eventId]
      );

      if (eventResult.rowCount === 0) {
        throw createPersistenceError(
          "The selected recruitment event was not found.",
          "EVENT_NOT_FOUND"
        );
      }

      if (eventResult.rows[0].status !== "draft") {
        throw createPersistenceError(
          "Only a draft event can receive a generated schedule.",
          "EVENT_NOT_DRAFT"
        );
      }

      // Failed generation must leave the existing draft untouched.
      if (!result.success) {
        const countResult = await client.query(
          `SELECT COUNT(*)::int AS count
           FROM scheduled_interviews
           WHERE event_id = $1`,
          [eventId]
        );

        await client.query("COMMIT");

        return {
          eventId,
          savedInterviews: countResult.rows[0].count,
          reusedEvent: true,
          schedulePersisted: false,
        };
      }

      // Capture submissions before clearing event-specific assignments.
      submittedAvailabilityByInterviewerId =
        await readSubmittedAvailabilityByInterviewerId(client, eventId);

      await clearDraftSchedule(client, eventId);
    } else {
      const eventName =
        typeof input.eventName === "string" && input.eventName.trim()
          ? input.eventName.trim()
          : `Chronos scheduling run ${new Date().toISOString()}`;

      await client.query(
        `INSERT INTO recruitment_events
           (event_id, event_name, event_date, status)
         VALUES ($1, $2, $3, 'draft')`,
        [eventId, eventName, input.eventDate]
      );
    }

    const validSlots = new Set(input.timeSlots);

    for (const slot of input.timeSlots) {
      await client.query(
        `INSERT INTO event_time_slots (event_id, slot_time)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [eventId, slot]
      );
    }

    const candidateIds = new Map();
    const interviewerIds = new Map();
    const roomIds = new Map();
    const taskIds = new Map();

    // Save candidates and event-specific candidate availability.
    for (const candidate of input.candidates) {
      const name = candidate.name?.trim() || candidate.id;

      const email =
        typeof candidate.email === "string" && candidate.email.trim()
          ? candidate.email.trim()
          : null;

      const candidateResult = await client.query(
        `INSERT INTO candidates (candidate_id, full_name, email)
         VALUES ($1, $2, $3)
         ON CONFLICT (email)
         DO UPDATE SET full_name = EXCLUDED.full_name
         RETURNING candidate_id`,
        [randomUUID(), name, email]
      );

      const candidateId = candidateResult.rows[0].candidate_id;
      candidateIds.set(candidate.id, candidateId);

      await client.query(
        `INSERT INTO event_candidates (event_id, candidate_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [eventId, candidateId]
      );

      for (const slot of candidate.availableSlots || []) {
        if (!validSlots.has(slot)) continue;

        await client.query(
          `INSERT INTO candidate_availability
             (event_id, candidate_id, slot_time)
           VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [eventId, candidateId, slot]
        );
      }
    }

    // Save interviewers, retaining existing profile identity when possible.
    for (const interviewer of input.interviewers) {
      const interviewerId = await resolveInterviewerProfile(
        client,
        interviewer
      );

      interviewerIds.set(interviewer.id, interviewerId);

      await client.query(
        `INSERT INTO event_interviewers
           (event_id, interviewer_id, max_interviews_per_day)
         VALUES ($1, $2, $3)
         ON CONFLICT (event_id, interviewer_id)
         DO UPDATE SET
           max_interviews_per_day = EXCLUDED.max_interviews_per_day`,
        [
          eventId,
          interviewerId,
          interviewer.maxInterviewsPerDay ?? 2,
        ]
      );

      for (const skill of interviewer.skills || []) {
        await client.query(
          `INSERT INTO interviewer_skills (interviewer_id, skill)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [interviewerId, skill]
        );
      }

      const submittedAvailability =
        submittedAvailabilityByInterviewerId.get(interviewerId);

      const availableSlots = submittedAvailability
        ? [...submittedAvailability.slots]
        : interviewer.availableSlots || [];

      for (const slot of availableSlots) {
        if (!validSlots.has(slot)) continue;

        await client.query(
          `INSERT INTO interviewer_availability
             (event_id, interviewer_id, slot_time)
           VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [eventId, interviewerId, slot]
        );
      }

      if (submittedAvailability) {
        // Permanently discard submitted choices which are no longer
        // valid for this event's current time-slot configuration.
        await client.query(
          `DELETE FROM interviewer_availability_submission_slots
           WHERE event_id = $1
             AND interviewer_id = $2
             AND to_char(slot_time, 'HH24:MI') <> ALL($3::text[])`,
          [eventId, interviewerId, [...validSlots]]
        );
      }
    }

    // Remove submission records for interviewers no longer assigned to event.
    await client.query(
      `DELETE FROM interviewer_availability_submissions submission
       WHERE submission.event_id = $1
         AND NOT EXISTS (
           SELECT 1
           FROM event_interviewers assignment
           WHERE assignment.event_id = submission.event_id
             AND assignment.interviewer_id = submission.interviewer_id
         )`,
      [eventId]
    );

    // Save rooms and their availability.
    for (const room of input.rooms) {
      const roomId = randomUUID();
      roomIds.set(room.id, roomId);

      await client.query(
        `INSERT INTO rooms (room_id, event_id, room_name)
         VALUES ($1, $2, $3)`,
        [roomId, eventId, room.name?.trim() || room.id]
      );

      for (const slot of room.availableSlots || []) {
        if (!validSlots.has(slot)) continue;

        await client.query(
          `INSERT INTO room_availability
             (event_id, room_id, slot_time)
           VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [eventId, roomId, slot]
        );
      }
    }

    // Save event interview tasks.
    for (const task of input.tasks) {
      const taskId = randomUUID();
      taskIds.set(task.id, taskId);

      const candidateId = candidateIds.get(task.candidateId);

      if (!candidateId) {
        throw new Error(
          `No saved candidate was found for task ${task.id}.`
        );
      }

      await client.query(
        `INSERT INTO interview_tasks
           (task_id, event_id, candidate_id, round_name,
            duration_slots, required_skills)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          taskId,
          eventId,
          candidateId,
          task.roundName,
          task.durationSlots ?? 1,
          task.requiredSkills || [],
        ]
      );
    }

    // Persist interview assignments only for a successful generated schedule.
    if (result.success) {
      for (const item of result.schedule) {
        const taskId = taskIds.get(item.taskId);
        const roomId = roomIds.get(item.roomId);

        if (!taskId || !roomId) {
          throw new Error(
            `Missing saved task or room for scheduled task ${item.taskId}.`
          );
        }

        const scheduleResult = await client.query(
          `INSERT INTO scheduled_interviews
             (event_id, task_id, room_id, start_time, end_time, status)
           VALUES ($1, $2, $3, $4, $5, 'draft')
           RETURNING schedule_id`,
          [
            eventId,
            taskId,
            roomId,
            item.startTime,
            item.endTime,
          ]
        );

        const scheduleId = scheduleResult.rows[0].schedule_id;

        const originalInterviewerIds = Array.isArray(item.interviewerIds)
          ? item.interviewerIds
          : item.interviewerId
            ? [item.interviewerId]
            : [];

        if (originalInterviewerIds.length === 0) {
          throw new Error(
            `No interviewer assignment found for scheduled task ${item.taskId}.`
          );
        }

        for (const originalInterviewerId of originalInterviewerIds) {
          const interviewerId = interviewerIds.get(originalInterviewerId);

          if (!interviewerId) {
            throw new Error(
              `No saved interviewer was found for task ${item.taskId}.`
            );
          }

          await client.query(
            `INSERT INTO scheduled_interview_interviewers
               (event_id, schedule_id, interviewer_id)
             VALUES ($1, $2, $3)`,
            [eventId, scheduleId, interviewerId]
          );
        }
      }
    }

    await client.query("COMMIT");

    return {
      eventId,
      savedInterviews: result.success ? result.schedule.length : 0,
      reusedEvent: reusingEvent,
      schedulePersisted: result.success,
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Database rollback failed:", rollbackError);
    }

    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  persistScheduleRun,
  applySubmittedInterviewerAvailability,
};