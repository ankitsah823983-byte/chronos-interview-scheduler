const { randomUUID } = require("crypto");
const pool = require("./db");

function databaseId(eventId, originalId) {
  // Form IDs such as c1 and t1 may be reused in future events.
  // Prefix them so each event gets its own records.
  return `${eventId}:${originalId}`;
}

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

    await client.query(
      `INSERT INTO recruitment_events
         (event_id, event_name, status)
       VALUES ($1, $2, 'draft')`,
      [eventId, eventName]
    );

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

    // Save candidates.
    for (const candidate of input.candidates) {
      const id = databaseId(eventId, candidate.id);
      candidateIds.set(candidate.id, id);

      await client.query(
        `INSERT INTO candidates (candidate_id, full_name, email)
         VALUES ($1, $2, $3)`,
        [
          id,
          candidate.name?.trim() || candidate.id,
          candidate.email || null,
        ]
      );

      for (const slot of candidate.availableSlots || []) {
        if (!validSlots.has(slot)) continue;

        await client.query(
          `INSERT INTO candidate_availability
             (event_id, candidate_id, slot_time)
           VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [eventId, id, slot]
        );
      }
    }

    // Save interviewers, skill tags and availability.
    for (const interviewer of input.interviewers) {
      const id = databaseId(eventId, interviewer.id);
      interviewerIds.set(interviewer.id, id);

      await client.query(
        `INSERT INTO interviewers
           (interviewer_id, full_name, email,
            max_interviews_per_day)
         VALUES ($1, $2, $3, $4)`,
        [
          id,
          interviewer.name?.trim() || interviewer.id,
          interviewer.email || null,
          interviewer.maxInterviewsPerDay ?? 2,
        ]
      );

      for (const skill of interviewer.skills || []) {
        await client.query(
          `INSERT INTO interviewer_skills (interviewer_id, skill)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [id, skill]
        );
      }

      for (const slot of interviewer.availableSlots || []) {
        if (!validSlots.has(slot)) continue;

        await client.query(
          `INSERT INTO interviewer_availability
             (event_id, interviewer_id, slot_time)
           VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [eventId, id, slot]
        );
      }
    }

    // Save rooms and their available slots.
    for (const room of input.rooms) {
      const id = databaseId(eventId, room.id);
      roomIds.set(room.id, id);

      await client.query(
        `INSERT INTO rooms (room_id, room_name)
         VALUES ($1, $2)`,
        [id, room.name?.trim() || room.id]
      );

      for (const slot of room.availableSlots || []) {
        if (!validSlots.has(slot)) continue;

        await client.query(
          `INSERT INTO room_availability
             (event_id, room_id, slot_time)
           VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [eventId, id, slot]
        );
      }
    }

    // Save the interview tasks.
    for (const task of input.tasks) {
      const id = databaseId(eventId, task.id);
      taskIds.set(task.id, id);

      await client.query(
        `INSERT INTO interview_tasks
           (task_id, event_id, candidate_id, round_name,
            duration_slots, required_skills)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          id,
          eventId,
          candidateIds.get(task.candidateId),
          task.roundName,
          task.durationSlots ?? 1,
          task.requiredSkills || [],
        ]
      );
    }

    // Only persist scheduled interviews when a complete schedule
    // was generated. Failed attempts still retain their input data.
    if (result.success) {
      for (const item of result.schedule) {
        await client.query(
          `INSERT INTO scheduled_interviews
             (event_id, task_id, interviewer_id, room_id,
              start_time, end_time, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'draft')`,
          [
            eventId,
            taskIds.get(item.taskId),
            interviewerIds.get(item.interviewerId),
            roomIds.get(item.roomId),
            item.startTime,
            item.endTime,
          ]
        );
      }
    }

    await client.query("COMMIT");

    return {
      eventId,
      savedInterviews: result.success
        ? result.schedule.length
        : 0,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { persistScheduleRun };