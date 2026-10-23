function generateSchedule({
  timeSlots,
  candidates,
  interviewers,
  rooms,
  tasks,
  maxSearchNodes = 50000,
}) {
  if (
    !Array.isArray(timeSlots) ||
    !Array.isArray(candidates) ||
    !Array.isArray(interviewers) ||
    !Array.isArray(rooms) ||
    !Array.isArray(tasks)
  ) {
    throw new Error("Invalid scheduler input.");
  }

  if (!timeSlots.length || !tasks.length) {
    return {
      success: false,
      schedule: [],
      unscheduledTasks: tasks,
      reason: "Time slots and interview tasks are required.",
    };
  }

  const candidateById = new Map(
    candidates.map((candidate) => [candidate.id, candidate])
  );

  const candidateAvailability = new Map(
    candidates.map((candidate) => [
      candidate.id,
      new Set(candidate.availableSlots || []),
    ])
  );

  const interviewerAvailability = new Map(
    interviewers.map((interviewer) => [
      interviewer.id,
      new Set(interviewer.availableSlots || []),
    ])
  );

  const interviewerSkills = new Map(
    interviewers.map((interviewer) => [
      interviewer.id,
      new Set(interviewer.skills || []),
    ])
  );

  const roomAvailability = new Map(
    rooms.map((room) => [
      room.id,
      new Set(room.availableSlots || []),
    ])
  );

  const interviewerById = new Map(
    interviewers.map((interviewer) => [
      interviewer.id,
      interviewer,
    ])
  );

  const roomById = new Map(
    rooms.map((room) => [room.id, room])
  );

  for (const task of tasks) {
    if (!candidateById.has(task.candidateId)) {
      throw new Error(
        `Candidate not found for task ${task.id}.`
      );
    }

    if (
      !Number.isInteger(task.durationSlots || 1) ||
      (task.durationSlots || 1) < 1
    ) {
      throw new Error(
        `Invalid duration for task ${task.id}.`
      );
    }
  }

  // Track occupied time blocks for every resource.
  const usedCandidates = new Map();
  const usedInterviewers = new Map();
  const usedRooms = new Map();

  const interviewerWorkload = new Map();
  const assigned = new Map();

  const stats = {
    nodesVisited: 0,
    searchLimitReached: false,
  };

  function isFree(occupied, resourceId, blocks) {
    const used = occupied.get(resourceId);

    return blocks.every(
      (slot) => !used || !used.has(slot)
    );
  }

  function reserve(occupied, resourceId, blocks) {
    if (!occupied.has(resourceId)) {
      occupied.set(resourceId, new Set());
    }

    const used = occupied.get(resourceId);

    for (const slot of blocks) {
      used.add(slot);
    }
  }

  function release(occupied, resourceId, blocks) {
    const used = occupied.get(resourceId);

    for (const slot of blocks) {
      used.delete(slot);
    }

    if (used.size === 0) {
      occupied.delete(resourceId);
    }
  }

  function getOptions(task) {
    const candidate = candidateById.get(task.candidateId);
    const duration = task.durationSlots || 1;

    const requiredSkills = task.requiredSkills || [];
    const options = [];

    for (
      let startIndex = 0;
      startIndex + duration <= timeSlots.length;
      startIndex++
    ) {
      const blocks = timeSlots.slice(
        startIndex,
        startIndex + duration
      );

      // The candidate must be available for every block.
      const candidateSlots =
        candidateAvailability.get(candidate.id);

      if (!blocks.every((slot) => candidateSlots.has(slot))) {
        continue;
      }

      if (
        !isFree(usedCandidates, candidate.id, blocks)
      ) {
        continue;
      }

      for (const interviewer of interviewers) {
        const skills = interviewerSkills.get(interviewer.id);

        const qualified = requiredSkills.every(
          (skill) => skills.has(skill)
        );

        if (!qualified) continue;

        const workload =
          interviewerWorkload.get(interviewer.id) || 0;

        const limit =
          interviewer.maxInterviewsPerDay ??
          Number.POSITIVE_INFINITY;

        if (workload >= limit) continue;

        const available =
          interviewerAvailability.get(interviewer.id);

        if (!blocks.every((slot) => available.has(slot))) {
          continue;
        }

        if (
          !isFree(
            usedInterviewers,
            interviewer.id,
            blocks
          )
        ) {
          continue;
        }

        for (const room of rooms) {
          const roomSlots = roomAvailability.get(room.id);

          if (!blocks.every((slot) => roomSlots.has(slot))) {
            continue;
          }

          if (!isFree(usedRooms, room.id, blocks)) {
            continue;
          }

          const lastSlot = blocks[blocks.length - 1];
          const [hours, minutes] = lastSlot
            .split(":")
            .map(Number);

          const endMinutes = hours * 60 + minutes + 30;

          const endTime = [
            String(Math.floor(endMinutes / 60) % 24)
              .padStart(2, "0"),
            String(endMinutes % 60).padStart(2, "0"),
          ].join(":");

          options.push({
            taskId: task.id,
            candidateId: candidate.id,
            roundName: task.roundName,
            interviewerId: interviewer.id,
            interviewerName: interviewer.name,
            roomId: room.id,
            roomName: room.name,
            startTime: blocks[0],
            endTime,
            blocks,
          });
        }
      }
    }

    return options;
  }

  function search() {
    if (assigned.size === tasks.length) {
      return true;
    }

    if (stats.nodesVisited >= maxSearchNodes) {
      stats.searchLimitReached = true;
      return false;
    }

    stats.nodesVisited++;

    let chosenTask = null;
    let chosenOptions = null;

    // MRV: select the task with the fewest valid options.
    for (const task of tasks) {
      if (assigned.has(task.id)) continue;

      const options = getOptions(task);

      if (options.length === 0) {
        return false;
      }

      if (
        chosenOptions === null ||
        options.length < chosenOptions.length
      ) {
        chosenTask = task;
        chosenOptions = options;
      }

      if (chosenOptions.length === 1) break;
    }

    for (const option of chosenOptions) {
      const blocks = option.blocks;

      assigned.set(chosenTask.id, option);

      reserve(usedCandidates, option.candidateId, blocks);
      reserve(usedInterviewers, option.interviewerId, blocks);
      reserve(usedRooms, option.roomId, blocks);

      interviewerWorkload.set(
        option.interviewerId,
        (interviewerWorkload.get(option.interviewerId) || 0) + 1
      );

      if (search()) return true;

      // Backtrack when the current choice prevents a solution.
      assigned.delete(chosenTask.id);

      release(usedCandidates, option.candidateId, blocks);
      release(usedInterviewers, option.interviewerId, blocks);
      release(usedRooms, option.roomId, blocks);

      interviewerWorkload.set(
        option.interviewerId,
        interviewerWorkload.get(option.interviewerId) - 1
      );

      if (stats.searchLimitReached) return false;
    }

    return false;
  }

  const success = search();

  if (!success) {
    return {
      success: false,
      schedule: [],
      unscheduledTasks: tasks.map(
        ({ id, candidateId, roundName }) => ({
          id,
          candidateId,
          roundName,
        })
      ),
      reason: stats.searchLimitReached
        ? "Search limit reached before finding a complete schedule."
        : "No complete schedule satisfies all constraints. Check availability, skills, rooms, and workload limits.",
      stats,
    };
  }

  const schedule = tasks.map(({ id }) => {
    const { blocks, ...appointment } = assigned.get(id);
    return appointment;
  });

  return {
    success: true,
    schedule,
    unscheduledTasks: [],
    reason: "A valid schedule was generated.",
    stats,
  };
}

module.exports = { generateSchedule };