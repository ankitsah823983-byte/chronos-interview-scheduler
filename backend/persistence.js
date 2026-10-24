
const { randomUUID } = require("crypto");
const pool = require("./db");

async function persistScheduleRun({ input, result }) {
  const eventId = randomUUID();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const eventName =
      typeof input.eventName === "string" &&
      input.eventName.trim()
        ? input.eventName.trim()
        : `Chronos scheduling run ${new Date().toISOString()}`;

    // 1. Create the recruitment event with its selected date.
    await client.query(
      `INSERT INTO recruitment_events
         (event_id, event_name, event_date, status)
       VALUES ($1, $2, $3, 'draft')`,
      [eventId, eventName, input.eventDate]
    );

    // 2. Save the event's allowed time slots.
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

    // 3. Save candidate profiles, event participation and availability.
    for (const candidate of input.candidates) {
      const name = candidate.name?.trim() || candidate.id;
      const email =
        typeof candidate.email === "string" && candidate.email.trim()
          ? candidate.email.trim()
          : null;

      const candidateResult = await client.query(
        `INSERT INTO candidates
           (candidate_id, full_name, email)
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

    // 4. Save interviewer profiles, event participation,
    // skills and event-specific availability/workload.
    for (const interviewer of input.interviewers) {
      const name = interviewer.name?.trim() || interviewer.id;
      const email =
        typeof interviewer.email === "string" && interviewer.email.trim()
          ? interviewer.email.trim()
          : null;

      const interviewerResult = await client.query(
        `INSERT INTO interviewers
           (interviewer_id, full_name, email)
         VALUES ($1, $2, $3)
         ON CONFLICT (email)
         DO UPDATE SET full_name = EXCLUDED.full_name
         RETURNING interviewer_id`,
        [randomUUID(), name, email]
      );

      const interviewerId = interviewerResult.rows[0].interviewer_id;
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

      for (const slot of interviewer.availableSlots || []) {
        if (!validSlots.has(slot)) continue;

        await client.query(
          `INSERT INTO interviewer_availability
             (event_id, interviewer_id, slot_time)
           VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [eventId, interviewerId, slot]
        );
      }
    }

    // 5. Save event-owned rooms and their availability.
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

    // 6. Save tasks using real database IDs.
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

    // 7. Save scheduled interviews only when generation succeeds.
    // Each interview can have one or more interviewer assignments.
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

module.exports = { persistScheduleRun };
