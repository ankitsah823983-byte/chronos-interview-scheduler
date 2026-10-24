
const assert = require("node:assert/strict");
const { generateSchedule } = require("./scheduler");

const timeSlots = ["10:00", "10:30", "11:00", "11:30"];

function makeInput() {
  return {
    timeSlots: [...timeSlots],

    candidates: [
      {
        id: "c1",
        name: "Candidate A",
        availableSlots: [...timeSlots],
      },
      {
        id: "c2",
        name: "Candidate B",
        availableSlots: [...timeSlots],
      },
    ],

    interviewers: [
      {
        id: "i1",
        name: "Interviewer X",
        skills: ["DSA"],
        availableSlots: [...timeSlots],
        maxInterviewsPerDay: 2,
      },
    ],

    rooms: [
      {
        id: "r1",
        name: "Room 1",
        availableSlots: [...timeSlots],
      },
    ],

    tasks: [
      {
        id: "t1",
        candidateId: "c1",
        roundName: "Coding Interview",
        requiredSkills: ["DSA"],
        durationSlots: 1,
      },
      {
        id: "t2",
        candidateId: "c2",
        roundName: "Coding Interview",
        requiredSkills: ["DSA"],
        durationSlots: 1,
      },
    ],
  };
}

let passed = 0;
let failed = 0;

function test(name, callback) {
  try {
    callback();
    passed++;
    console.log(`PASS: ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL: ${name}`);
    console.error(`  ${error.message}`);
  }
}

function hasDiagnostic(result, code) {
  return result.diagnostics.some(
    (diagnostic) => diagnostic.code === code
  );
}

// Verify that two interviews never overlap when they use
// the same candidate, interviewer, or room.
function assertNoResourceOverlaps(schedule, resourceKey) {
  function toMinutes(time) {
    const [hours, minutes] = time.split(":").map(Number);
    return hours * 60 + minutes;
  }

  for (let i = 0; i < schedule.length; i++) {
    for (let j = i + 1; j < schedule.length; j++) {
      const first = schedule[i];
      const second = schedule[j];

      if (first[resourceKey] !== second[resourceKey]) {
        continue;
      }

      const firstStart = toMinutes(first.startTime);
      const firstEnd = toMinutes(first.endTime);
      const secondStart = toMinutes(second.startTime);
      const secondEnd = toMinutes(second.endTime);

      const overlaps =
        firstStart < secondEnd &&
        secondStart < firstEnd;

      assert.equal(
        overlaps,
        false,
        `Overlapping interviews for ${resourceKey}: ` +
          `${first.taskId} and ${second.taskId}`
      );
    }
  }
}

// 1. Normal scheduling
test("Schedules all interviews successfully", () => {
  const result = generateSchedule(makeInput());

  assert.equal(result.success, true);
  assert.equal(result.schedule.length, 2);
  assert.deepEqual(result.unscheduledTasks, []);
  assert.equal(result.diagnostics.length, 0);

  const scheduledTasks = result.schedule.map(
    (interview) => interview.taskId
  );

  assert.deepEqual(scheduledTasks.sort(), ["t1", "t2"]);
});

// 2. Resource-overlap verification
test("Prevents candidate, interviewer, and room overlaps", () => {
  const result = generateSchedule(makeInput());

  assert.equal(result.success, true);

  assertNoResourceOverlaps(result.schedule, "candidateId");
  assertNoResourceOverlaps(result.schedule, "interviewerId");
  assertNoResourceOverlaps(result.schedule, "roomId");
});

// 3. Shared-resource conflict
test("Detects an impossible shared-resource conflict", () => {
  const input = makeInput();

  input.timeSlots = ["10:00"];

  input.candidates.forEach((candidate) => {
    candidate.availableSlots = ["10:00"];
  });

  input.interviewers.forEach((interviewer) => {
    interviewer.availableSlots = ["10:00"];
  });

  input.rooms.forEach((room) => {
    room.availableSlots = ["10:00"];
  });

  const result = generateSchedule(input);

  assert.equal(result.success, false);
  assert.equal(result.schedule.length, 0);
  assert.ok(
    hasDiagnostic(result, "SHARED_RESOURCE_CONFLICT")
  );
});

// 4. Required skills
test("Rejects a task when no interviewer has the required skills", () => {
  const input = makeInput();

  input.tasks = [input.tasks[0]];
  input.interviewers[0].skills = ["Java"];

  const result = generateSchedule(input);

  assert.equal(result.success, false);
  assert.ok(hasDiagnostic(result, "SKILL_MISMATCH"));
});

// 5. Candidate availability
test("Detects unavailable candidates", () => {
  const input = makeInput();

  input.tasks = [input.tasks[0]];
  input.candidates[0].availableSlots = [];

  const result = generateSchedule(input);

  assert.equal(result.success, false);
  assert.ok(
    hasDiagnostic(result, "CANDIDATE_AVAILABILITY")
  );
});

// 6. Interviewer availability
test("Detects when a qualified interviewer is unavailable", () => {
  const input = makeInput();

  input.tasks = [input.tasks[0]];
  input.candidates[0].availableSlots = ["10:00"];
  input.interviewers[0].availableSlots = ["10:30"];

  const result = generateSchedule(input);

  assert.equal(result.success, false);
  assert.ok(
    hasDiagnostic(result, "INTERVIEWER_AVAILABILITY")
  );
});

// 7. Room availability
test("Detects when no room is available at a feasible time", () => {
  const input = makeInput();

  input.tasks = [input.tasks[0]];
  input.candidates[0].availableSlots = ["10:00"];
  input.interviewers[0].availableSlots = ["10:00"];
  input.rooms[0].availableSlots = ["10:30"];

  const result = generateSchedule(input);

  assert.equal(result.success, false);
  assert.ok(hasDiagnostic(result, "ROOM_AVAILABILITY"));
});

// 8. Interviewer workload
test("Detects when the only qualified interviewer exceeds the daily limit", () => {
  const input = makeInput();

  input.interviewers[0].maxInterviewsPerDay = 1;

  const result = generateSchedule(input);

  assert.equal(result.success, false);
  assert.ok(
    hasDiagnostic(result, "INTERVIEWER_WORKLOAD_LIMIT")
  );
});

// 9. Multi-slot interview duration
test("Respects a two-slot interview duration", () => {
  const input = makeInput();

  input.tasks = [
    {
      ...input.tasks[0],
      durationSlots: 2,
    },
  ];

  const result = generateSchedule(input);

  assert.equal(result.success, true);
  assert.equal(result.schedule.length, 1);

  const interview = result.schedule[0];

  const expectedEndTimeByStart = {
    "10:00": "11:00",
    "10:30": "11:30",
    "11:00": "12:00",
  };

  assert.ok(
    Object.hasOwn(expectedEndTimeByStart, interview.startTime),
    `Unexpected start time: ${interview.startTime}`
  );

  assert.equal(
    interview.endTime,
    expectedEndTimeByStart[interview.startTime]
  );
});

// 10. Search limit
test("Reports when the search limit is reached", () => {
  const input = makeInput();

  const result = generateSchedule({
    ...input,
    maxSearchNodes: 1,
  });

  assert.equal(result.success, false);
  assert.equal(result.stats.searchLimitReached, true);
  assert.ok(hasDiagnostic(result, "SEARCH_LIMIT"));
});

// 11. Invalid time format
test("Rejects an invalid time format", () => {
  const input = makeInput();

  input.timeSlots = ["25:00"];

  assert.throws(
    () => generateSchedule(input),
    /Time slots must use the HH:MM format/
  );
});

// 12. Duplicate time slots
test("Rejects duplicate time slots", () => {
  const input = makeInput();

  input.timeSlots = ["10:00", "10:00"];

  assert.throws(
    () => generateSchedule(input),
    /Duplicate time slots/
  );
});

// 13. Invalid interview duration
test("Rejects an invalid interview duration", () => {
  const input = makeInput();

  input.tasks[0].durationSlots = 0;

  assert.throws(
    () => generateSchedule(input),
    /positive whole-number duration/
  );
});

// 14. Non-consecutive time slots cannot form a two-slot interview
test("Rejects a duration window across non-consecutive slots", () => {
  const input = makeInput();

  input.timeSlots = ["10:00", "11:00"];
  input.candidates[0].availableSlots = ["10:00", "11:00"];
  input.interviewers[0].availableSlots = ["10:00", "11:00"];
  input.rooms[0].availableSlots = ["10:00", "11:00"];

  input.tasks = [
    {
      ...input.tasks[0],
      durationSlots: 2,
    },
  ];

  const result = generateSchedule(input);

  assert.equal(result.success, false);
  assert.ok(
    hasDiagnostic(result, "CANDIDATE_AVAILABILITY")
  );
});

// 15. A two-slot interview must fit at the final valid boundary
test("Schedules a two-slot interview at the final valid window", () => {
  const input = makeInput();

  input.candidates[0].availableSlots = ["11:00", "11:30"];
  input.interviewers[0].availableSlots = ["11:00", "11:30"];
  input.rooms[0].availableSlots = ["11:00", "11:30"];

  input.tasks = [
    {
      ...input.tasks[0],
      durationSlots: 2,
    },
  ];

  const result = generateSchedule(input);

  assert.equal(result.success, true);
  assert.equal(result.schedule.length, 1);
  assert.equal(result.schedule[0].startTime, "11:00");
  assert.equal(result.schedule[0].endTime, "12:00");
});

// 16. Duplicate candidate IDs
test("Rejects duplicate candidate IDs", () => {
  const input = makeInput();

  input.candidates.push({
    ...input.candidates[0],
  });

  assert.throws(
    () => generateSchedule(input),
    /Duplicate candidate ID/
  );
});

// 17. Duplicate task IDs
test("Rejects duplicate task IDs", () => {
  const input = makeInput();

  input.tasks[1].id = input.tasks[0].id;

  assert.throws(
    () => generateSchedule(input),
    /Duplicate task ID/
  );
});

// 18. Unknown candidate reference
test("Rejects a task referencing a nonexistent candidate", () => {
  const input = makeInput();

  input.tasks[0].candidateId = "missing-candidate";

  assert.throws(
    () => generateSchedule(input),
    /Candidate not found for task/
  );
});

// 19. Backtracking finds a valid alternative after a bad first choice
test("Backtracks to find a valid alternative assignment", () => {
  const input = makeInput();

  input.timeSlots = ["10:00", "10:30", "11:00"];

  input.candidates[0].availableSlots = [
    "10:00",
    "10:30",
    "11:00",
  ];

  input.candidates[1].availableSlots = [
    "10:00",
    "10:30",
  ];

  input.interviewers[0].availableSlots = [
    "10:00",
    "10:30",
    "11:00",
  ];

  input.rooms[0].availableSlots = [
    "10:00",
    "10:30",
    "11:00",
  ];

  input.interviewers[0].maxInterviewsPerDay = 2;

  input.tasks[0].durationSlots = 2;
  input.tasks[1].durationSlots = 1;

  const result = generateSchedule(input);

  assert.equal(result.success, true);
  assert.equal(result.schedule.length, 2);

  const longInterview = result.schedule.find(
    (interview) => interview.taskId === "t1"
  );

  const shortInterview = result.schedule.find(
    (interview) => interview.taskId === "t2"
  );

  assert.equal(longInterview.startTime, "10:30");
  assert.equal(longInterview.endTime, "11:30");

  assert.equal(shortInterview.startTime, "10:00");
  assert.equal(shortInterview.endTime, "10:30");

  assertNoResourceOverlaps(result.schedule, "candidateId");
  assertNoResourceOverlaps(result.schedule, "interviewerId");
  assertNoResourceOverlaps(result.schedule, "roomId");
});

// 20. Duplicate interviewer IDs
test("Rejects duplicate interviewer IDs", () => {
  const input = makeInput();

  input.interviewers.push({
    ...input.interviewers[0],
  });

  assert.throws(
    () => generateSchedule(input),
    /Duplicate interviewer ID/
  );
});

// 21. Duplicate room IDs
test("Rejects duplicate room IDs", () => {
  const input = makeInput();

  input.rooms.push({
    ...input.rooms[0],
  });

  assert.throws(
    () => generateSchedule(input),
    /Duplicate room ID/
  );
});

// 22. Missing interview round name
test("Rejects a task without a round name", () => {
  const input = makeInput();

  input.tasks[0].roundName = "";

  assert.throws(
    () => generateSchedule(input),
    /needs a round name/
  );
});


 // 23. Candidate availability must be an array
test("Rejects invalid candidate availability configuration", () => {
  const input = makeInput();

  input.candidates[0].availableSlots = "10:00";

  assert.throws(
    () => generateSchedule(input),
    /candidate c1 availableSlots must be an array/
  );
});

// 24. Interviewer availability must be an array
test("Rejects invalid interviewer availability configuration", () => {
  const input = makeInput();

  input.interviewers[0].availableSlots = "10:00";

  assert.throws(
    () => generateSchedule(input),
    /interviewer i1 availableSlots must be an array/
  );
});

// 25. Room availability must be an array
test("Rejects invalid room availability configuration", () => {
  const input = makeInput();

  input.rooms[0].availableSlots = "10:00";

  assert.throws(
    () => generateSchedule(input),
    /room r1 availableSlots must be an array/
  );
});

// 26. Interviewer skills must be an array
test("Rejects invalid interviewer skills configuration", () => {
  const input = makeInput();

  input.interviewers[0].skills = "DSA";

  assert.throws(
    () => generateSchedule(input),
    /Interviewer i1 skills must be an array/
  );
});

// 27. Daily workload limit must be a positive integer
test("Rejects an invalid interviewer daily workload limit", () => {
  const input = makeInput();

  input.interviewers[0].maxInterviewsPerDay = 0;

  assert.throws(
    () => generateSchedule(input),
    /maxInterviewsPerDay must be a positive integer/
  );
});

// 28. Required skills must be an array
test("Rejects invalid task required-skills configuration", () => {
  const input = makeInput();

  input.tasks[0].requiredSkills = "DSA";

  assert.throws(
    () => generateSchedule(input),
    /requiredSkills must be an array/
  );
});

// 29. Resource IDs cannot be empty or whitespace
test("Rejects a candidate with an empty resource ID", () => {
  const input = makeInput();

  input.candidates[0].id = "   ";

  assert.throws(
    () => generateSchedule(input),
    /Every candidate needs a non-empty string ID/
  );
});

// 30. Search limit must be a positive integer
test("Rejects an invalid search limit", () => {
  const input = makeInput();

  assert.throws(
    () => generateSchedule({
      ...input,
      maxSearchNodes: 0,
    }),
    /Search limit must be a positive integer/
  );
});


console.log(`\nTest summary: ${passed} passed, ${failed} failed.`);

if (failed > 0) {
  process.exitCode = 1;
}
