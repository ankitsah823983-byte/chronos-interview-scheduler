
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

async function assertProfileEmailAvailable(client, role, profileId, email) {
  if (!email) return;

  const candidateId = role === "candidate" ? profileId : null;
  const interviewerId = role === "interviewer" ? profileId : null;

  const result = await client.query(
    `SELECT 1
     FROM candidates
     WHERE lower(trim(email)) = $1
       AND ($2::uuid IS NULL OR candidate_id <> $2)

     UNION ALL

     SELECT 1
     FROM interviewers
     WHERE lower(trim(email)) = $1
       AND ($3::uuid IS NULL OR interviewer_id <> $3)

     UNION ALL

     SELECT 1
     FROM user_accounts ua
     WHERE lower(trim(ua.email)) = $1
       AND NOT (
         ($2::uuid IS NOT NULL AND ua.candidate_id = $2::uuid)
         OR ($3::uuid IS NOT NULL AND ua.interviewer_id = $3::uuid)
       )

     LIMIT 1`,
    [email, candidateId, interviewerId]
  );

  if (result.rowCount > 0) {
    throw createPersistenceError(
      "This email is already used by another profile or account. Use a different email.",
      "PROFILE_EMAIL_CONFLICT"
    );
  }
}

async function resolveProfile(client, role, item) {
  const isCandidate = role === "candidate";

  const table = isCandidate ? "candidates" : "interviewers";
  const idColumn = isCandidate ? "candidate_id" : "interviewer_id";
  const accountColumn = idColumn;

  const name = item.name?.trim() || item.id;

  const suppliedEmail =
    typeof item.email === "string" && item.email.trim()
      ? item.email.trim().toLowerCase()
      : null;

  const suppliedId = isValidUuid(item.id) ? item.id : null;

  let existing = null;

  // Prefer the database ID from a previously saved event.
  if (suppliedId) {
    const result = await client.query(
      `SELECT
         ${idColumn} AS id,
         lower(trim(email)) AS email
       FROM ${table}
       WHERE ${idColumn} = $1
       FOR UPDATE`,
      [suppliedId]
    );

    if (result.rowCount > 0) {
      existing = result.rows[0];
    }
  }

  // For new UI IDs, reuse a profile matching the normalized email.
  if (!existing && suppliedEmail) {
    const result = await client.query(
      `SELECT
         ${idColumn} AS id,
         lower(trim(email)) AS email
       FROM ${table}
       WHERE lower(trim(email)) = $1
       ORDER BY created_at, ${idColumn}
       LIMIT 1
       FOR UPDATE`,
      [suppliedEmail]
    );

    if (result.rowCount > 0) {
      existing = result.rows[0];
    }
  }

  if (existing) {
    const profileId = existing.id;

    const accountResult = await client.query(
      `SELECT lower(trim(email)) AS email
       FROM user_accounts
       WHERE ${accountColumn} = $1
       LIMIT 1
       FOR UPDATE`,
      [profileId]
    );

    const linkedAccountEmail =
      accountResult.rows[0]?.email || null;

    // An empty form field means "keep the saved email", not "erase it".
    const emailToSave =
      suppliedEmail || existing.email || linkedAccountEmail || null;

    // Never silently change a profile email while its login account
    // remains linked to a different email address.
    if (
      linkedAccountEmail &&
      emailToSave !== linkedAccountEmail
    ) {
      throw createPersistenceError(
        "This profile is linked to a login account with another email. The account email must be updated through a dedicated account-management flow.",
        "PROFILE_EMAIL_LINKED"
      );
    }

    await assertProfileEmailAvailable(
      client,
      role,
      profileId,
      emailToSave
    );

    await client.query(
      `UPDATE ${table}
       SET full_name = $2,
           email = $3
       WHERE ${idColumn} = $1`,
      [profileId, name, emailToSave]
    );

    return profileId;
  }

  const newId = suppliedId || randomUUID();

  await assertProfileEmailAvailable(
    client,
    role,
    newId,
    suppliedEmail
  );

  const insertResult = await client.query(
    `INSERT INTO ${table}
       (${idColumn}, full_name, email)
     VALUES ($1, $2, $3)
     RETURNING ${idColumn}`,
    [newId, name, suppliedEmail]
  );

  return insertResult.rows[0][idColumn];
}

async function resolveCandidateProfile(client, candidate) {
  return resolveProfile(client, "candidate", candidate);
}

async function resolveInterviewerProfile(client, interviewer) {
  return resolveProfile(client, "interviewer", interviewer);
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
      const candidateId = await resolveCandidateProfile(client, candidate);
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

    // Persist assignments from successful scheduling runs.
    // When taskOptions is present, store each task's alternatives.
    // Older callers returning only schedule remain supported.
    let savedInterviewCount = 0;

    if (result.success) {
      let assignmentsToPersist = result.schedule;

      if (Array.isArray(result.taskOptions)) {
        assignmentsToPersist = [];

        const optionsByTaskId = new Map(
          result.taskOptions.map((group) => [
            group.taskId,
            group.options,
          ])
        );

        for (const task of input.tasks) {
          const taskOptions = optionsByTaskId.get(task.id);

          if (!Array.isArray(taskOptions) || taskOptions.length === 0) {
            throw new Error(
              `No generated options were found for task ${task.id}.`
            );
          }

          for (const option of taskOptions) {
            assignmentsToPersist.push({
              ...option,
              taskId: task.id,
            });
          }
        }
      }

      for (const item of assignmentsToPersist) {
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

        savedInterviewCount++;
      }
    }

    await client.query("COMMIT");

    return {
      eventId,
      savedInterviews: result.success ? savedInterviewCount : 0,
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
