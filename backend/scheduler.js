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

  if (!Number.isInteger(maxSearchNodes) || maxSearchNodes < 1) {
    throw new Error("Search limit must be a positive integer.");
  }

  const toMinutes = (time) => {
    if (typeof time !== "string") return null;

    const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);

    if (!match) return null;

    return Number(match[1]) * 60 + Number(match[2]);
  };

  const formatTime = (totalMinutes) => {
    const hours = Math.floor(totalMinutes / 60) % 24;
    const minutes = totalMinutes % 60;

    return [
      String(hours).padStart(2, "0"),
      String(minutes).padStart(2, "0"),
    ].join(":");
  };

  if (timeSlots.some((slot) => toMinutes(slot) === null)) {
    throw new Error("Time slots must use the HH:MM format.");
  }

  if (new Set(timeSlots).size !== timeSlots.length) {
    throw new Error("Duplicate time slots were provided.");
  }

  const slots = [...timeSlots].sort(
    (a, b) => toMinutes(a) - toMinutes(b)
  );

  // Validate resource IDs and availability arrays.
  function validateResources(items, type) {
    const ids = new Set();

    for (const item of items) {
      if (
        !item ||
        typeof item.id !== "string" ||
        !item.id.trim()
      ) {
        throw new Error(
          `Every ${type} needs a non-empty string ID.`
        );
      }

      if (ids.has(item.id)) {
        throw new Error(`Duplicate ${type} ID: ${item.id}.`);
      }

      ids.add(item.id);

      if (
        item.availableSlots !== undefined &&
        !Array.isArray(item.availableSlots)
      ) {
        throw new Error(
          `${type} ${item.id} availableSlots must be an array.`
        );
      }
    }
  }

  validateResources(candidates, "candidate");
  validateResources(interviewers, "interviewer");
  validateResources(rooms, "room");

  for (const interviewer of interviewers) {
    if (
      interviewer.skills !== undefined &&
      !Array.isArray(interviewer.skills)
    ) {
      throw new Error(
        `Interviewer ${interviewer.id} skills must be an array.`
      );
    }

    if (
      interviewer.maxInterviewsPerDay !== undefined &&
      (!Number.isInteger(interviewer.maxInterviewsPerDay) ||
        interviewer.maxInterviewsPerDay < 1)
    ) {
      throw new Error(
        `Interviewer ${interviewer.id} maxInterviewsPerDay must be a positive integer.`
      );
    }
  }

  const candidateById = new Map(
    candidates.map((candidate) => [candidate.id, candidate])
  );

  const interviewerById = new Map(
    interviewers.map((interviewer) => [
      interviewer.id,
      interviewer,
    ])
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

  // Track occupied blocks during backtracking.
  const usedCandidates = new Map();
  const usedInterviewers = new Map();
  const usedRooms = new Map();

  const interviewerWorkload = new Map();
  const assigned = new Map();

  const stats = {
    nodesVisited: 0,
    searchLimitReached: false,
  };

  // Validate interview tasks.
  const taskIds = new Set();

  for (const task of tasks) {
    if (
      !task ||
      typeof task.id !== "string" ||
      !task.id.trim()
    ) {
      throw new Error(
        "Every task needs a non-empty string ID."
      );
    }

    if (taskIds.has(task.id)) {
      throw new Error(`Duplicate task ID: ${task.id}.`);
    }

    taskIds.add(task.id);

    if (
      !task.roundName ||
      typeof task.roundName !== "string"
    ) {
      throw new Error(
        `Task ${task.id} needs a round name.`
      );
    }

    if (!candidateById.has(task.candidateId)) {
      throw new Error(
        `Candidate not found for task ${task.id}.`
      );
    }

    const duration = task.durationSlots ?? 1;

    if (!Number.isInteger(duration) || duration < 1) {
      throw new Error(
        `Task ${task.id} must have a positive whole-number duration.`
      );
    }

    if (
      task.requiredSkills !== undefined &&
      !Array.isArray(task.requiredSkills)
    ) {
      throw new Error(
        `Task ${task.id} requiredSkills must be an array.`
      );
    }
  }

  // Return consecutive windows of the requested duration.
  function getWindows(duration) {
    const windows = [];

    for (
      let i = 0;
      i + duration <= slots.length;
      i++
    ) {
      const blocks = slots.slice(i, i + duration);

      const consecutive = blocks.every(
        (slot, index) =>
          index === 0 ||
          toMinutes(slot) ===
            toMinutes(blocks[index - 1]) + 30
      );

      if (consecutive) {
        windows.push(blocks);
      }
    }

    return windows;
  }

  function everyBlockIsAvailable(availability, blocks) {
    return blocks.every((slot) => availability.has(slot));
  }

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

  // Diagnose problems that make an individual task impossible.
  function diagnoseTask(task) {
    const candidate = candidateById.get(task.candidateId);
    const duration = task.durationSlots ?? 1;
    const windows = getWindows(duration);

    const candidateWindows = windows.filter((blocks) =>
      everyBlockIsAvailable(
        candidateAvailability.get(candidate.id),
        blocks
      )
    );

    const requiredSkills = task.requiredSkills || [];

    const qualifiedInterviewers = interviewers.filter(
      (interviewer) =>
        requiredSkills.every((skill) =>
          interviewerSkills.get(interviewer.id).has(skill)
        )
    );

    const problems = [];
    const candidateName = candidate.name || candidate.id;

    if (candidateWindows.length === 0) {
      problems.push({
        taskId: task.id,
        roundName: task.roundName,
        candidateName,
        code: "CANDIDATE_AVAILABILITY",
        issue:
          `${candidateName} has no available consecutive time window ` +
          `long enough for ${task.roundName} ` +
          `(${duration} 30-minute block(s)).`,
        suggestion:
          "Add more candidate availability or choose a shorter interview duration.",
      });
    }

    if (qualifiedInterviewers.length === 0) {
      problems.push({
        taskId: task.id,
        roundName: task.roundName,
        candidateName,
        code: "SKILL_MISMATCH",
        issue:
          `No interviewer has all required skills: ` +
          `${requiredSkills.join(", ") || "(none specified)"}.`,
        suggestion:
          "Add a suitably skilled interviewer or adjust the required skills.",
      });
    }

    if (
      candidateWindows.length > 0 &&
      qualifiedInterviewers.length > 0
    ) {
      const matchingPairs = [];

      for (const blocks of candidateWindows) {
        for (const interviewer of qualifiedInterviewers) {
          if (
            everyBlockIsAvailable(
              interviewerAvailability.get(interviewer.id),
              blocks
            )
          ) {
            matchingPairs.push({ blocks, interviewer });
          }
        }
      }

      if (matchingPairs.length === 0) {
        problems.push({
          taskId: task.id,
          roundName: task.roundName,
          candidateName,
          code: "INTERVIEWER_AVAILABILITY",
          issue:
            `Qualified interviewers exist for ${task.roundName}, ` +
            "but none is available during the candidate's available windows.",
          suggestion:
            "Add overlapping availability for a qualified interviewer and the candidate.",
        });
      } else {
        const roomAvailable = matchingPairs.some(({ blocks }) =>
          rooms.some((room) =>
            everyBlockIsAvailable(
              roomAvailability.get(room.id),
              blocks
            )
          )
        );

        if (!roomAvailable) {
          problems.push({
            taskId: task.id,
            roundName: task.roundName,
            candidateName,
            code: "ROOM_AVAILABILITY",
            issue:
              "No room is available during any time window where " +
              "the candidate and a qualified interviewer overlap.",
            suggestion:
              "Add a room or make an existing room available during a matching time window.",
          });
        }
      }
    }

    return problems;
  }

  // Generate all currently valid assignments for a task.
  function getOptions(task) {
    const candidate = candidateById.get(task.candidateId);
    const duration = task.durationSlots ?? 1;
    const requiredSkills = task.requiredSkills || [];
    const options = [];

    for (const blocks of getWindows(duration)) {
      if (
        !everyBlockIsAvailable(
          candidateAvailability.get(candidate.id),
          blocks
        ) ||
        !isFree(usedCandidates, candidate.id, blocks)
      ) {
        continue;
      }

      for (const interviewer of interviewers) {
        const skills = interviewerSkills.get(interviewer.id);

        if (
          !requiredSkills.every((skill) => skills.has(skill))
        ) {
          continue;
        }

        const available =
          interviewerAvailability.get(interviewer.id);

        if (
          !everyBlockIsAvailable(available, blocks) ||
          !isFree(usedInterviewers, interviewer.id, blocks)
        ) {
          continue;
        }

        const currentWorkload =
          interviewerWorkload.get(interviewer.id) || 0;

        const limit =
          interviewer.maxInterviewsPerDay ??
          Number.POSITIVE_INFINITY;

        if (currentWorkload >= limit) {
          continue;
        }

        for (const room of rooms) {
          if (
            !everyBlockIsAvailable(
              roomAvailability.get(room.id),
              blocks
            ) ||
            !isFree(usedRooms, room.id, blocks)
          ) {
            continue;
          }

          const lastSlot = blocks[blocks.length - 1];

          options.push({
            taskId: task.id,
            candidateId: candidate.id,
            candidateName: candidate.name || candidate.id,
            roundName: task.roundName,
            interviewerId: interviewer.id,
            interviewerName:
              interviewer.name || interviewer.id,
            roomId: room.id,
            roomName: room.name || room.id,
            startTime: blocks[0],
            endTime: formatTime(
              toMinutes(lastSlot) + 30
            ),
            blocks,
          });
        }
      }
    }

    return options;
  }

  // Return specific, independently identifiable problems first.
  const diagnostics = tasks.flatMap(diagnoseTask);

  if (diagnostics.length > 0) {
    return {
      success: false,
      schedule: [],
      unscheduledTasks: [
        ...new Set(
          diagnostics.map((item) => item.taskId)
        ),
      ],
      reason:
        "Some interviews have no feasible assignment under the current constraints.",
      diagnostics,
      stats,
    };
  }

  // Diagnose when several tasks rely exclusively on one interviewer,
  // exceeding that interviewer's daily workload limit.
  function findWorkloadDiagnostic() {
    const tasksByExclusiveInterviewer = new Map();

    for (const task of tasks) {
      const candidate = candidateById.get(task.candidateId);
      const duration = task.durationSlots ?? 1;
      const requiredSkills = task.requiredSkills || [];

      const candidateWindows = getWindows(duration).filter(
        (blocks) =>
          everyBlockIsAvailable(
            candidateAvailability.get(candidate.id),
            blocks
          )
      );

      const eligibleInterviewers = interviewers.filter(
        (interviewer) => {
          const skills = interviewerSkills.get(interviewer.id);

          if (
            !requiredSkills.every((skill) => skills.has(skill))
          ) {
            return false;
          }

          return candidateWindows.some((blocks) => {
            const interviewerAvailable =
              everyBlockIsAvailable(
                interviewerAvailability.get(interviewer.id),
                blocks
              );

            if (!interviewerAvailable) {
              return false;
            }

            return rooms.some((room) =>
              everyBlockIsAvailable(
                roomAvailability.get(room.id),
                blocks
              )
            );
          });
        }
      );

      if (eligibleInterviewers.length === 1) {
        const interviewerId = eligibleInterviewers[0].id;

        if (
          !tasksByExclusiveInterviewer.has(interviewerId)
        ) {
          tasksByExclusiveInterviewer.set(
            interviewerId,
            []
          );
        }

        tasksByExclusiveInterviewer
          .get(interviewerId)
          .push(task);
      }
    }

    for (const [
      interviewerId,
      exclusiveTasks,
    ] of tasksByExclusiveInterviewer) {
      const interviewer = interviewerById.get(interviewerId);

      const limit =
        interviewer.maxInterviewsPerDay ??
        Number.POSITIVE_INFINITY;

      if (
        Number.isFinite(limit) &&
        exclusiveTasks.length > limit
      ) {
        const interviewerName =
          interviewer.name || interviewer.id;

        return {
          taskId: null,
          roundName: "Interviewer workload",
          code: "INTERVIEWER_WORKLOAD_LIMIT",
          issue:
            `${interviewerName} is the only feasible interviewer for ` +
            `${exclusiveTasks.length} interview tasks, ` +
            `but the daily limit is ${limit}.`,
          suggestion:
            "Increase this interviewer's daily limit or add another qualified interviewer with overlapping availability.",
          affectedTasks: exclusiveTasks.map(
            (task) => task.id
          ),
        };
      }
    }

    return null;
  }

  // Backtracking search using the Minimum Remaining Values heuristic.
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

    // Select the unassigned task with the fewest valid options.
    for (const task of tasks) {
      if (assigned.has(task.id)) {
        continue;
      }

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

      if (chosenOptions.length === 1) {
        break;
      }
    }

    for (const option of chosenOptions) {
      const { blocks } = option;

      assigned.set(chosenTask.id, option);

      reserve(
        usedCandidates,
        option.candidateId,
        blocks
      );

      reserve(
        usedInterviewers,
        option.interviewerId,
        blocks
      );

      reserve(
        usedRooms,
        option.roomId,
        blocks
      );

      interviewerWorkload.set(
        option.interviewerId,
        (interviewerWorkload.get(option.interviewerId) || 0) + 1
      );

      if (search()) {
        return true;
      }

      // Undo this choice and try another assignment.
      assigned.delete(chosenTask.id);

      release(
        usedCandidates,
        option.candidateId,
        blocks
      );

      release(
        usedInterviewers,
        option.interviewerId,
        blocks
      );

      release(
        usedRooms,
        option.roomId,
        blocks
      );

      interviewerWorkload.set(
        option.interviewerId,
        interviewerWorkload.get(option.interviewerId) - 1
      );

      if (stats.searchLimitReached) {
        return false;
      }
    }

    return false;
  }

  const success = search();

  if (!success) {
    const workloadDiagnostic = stats.searchLimitReached
      ? null
      : findWorkloadDiagnostic();

    const globalDiagnostic = workloadDiagnostic || {
      taskId: null,
      roundName: "All interviews",
      code: stats.searchLimitReached
        ? "SEARCH_LIMIT"
        : "SHARED_RESOURCE_CONFLICT",
      issue: stats.searchLimitReached
        ? "The search limit was reached before a complete schedule could be found."
        : "Each interview has feasible options individually, but the interviews cannot all be assigned together under the current shared-resource constraints.",
      suggestion: stats.searchLimitReached
        ? "Try a smaller scheduling problem or increase the search limit."
        : "Add compatible time slots, rooms, or qualified interviewers, or adjust availability and workload limits.",
    };

    return {
      success: false,
      schedule: [],
      unscheduledTasks: tasks.map((task) => task.id),
      reason: globalDiagnostic.issue,
      diagnostics: [globalDiagnostic],
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
    diagnostics: [],
    stats,
  };
}

module.exports = { generateSchedule };