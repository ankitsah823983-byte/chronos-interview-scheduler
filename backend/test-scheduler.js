
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

// 2. Shared-resource conflict
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
  assert.ok(hasDiagnostic(result, "SHARED_RESOURCE_CONFLICT"));
});

// 3. Required skills
test("Rejects a task when no interviewer has the required skills", () => {
  const input = makeInput();

  input.tasks = [input.tasks[0]];
  input.interviewers[0].skills = ["Java"];

  const result = generateSchedule(input);

  assert.equal(result.success, false);
  assert.ok(hasDiagnostic(result, "SKILL_MISMATCH"));
});

// 4. Candidate availability
test("Detects unavailable candidates", () => {
  const input = makeInput();

  input.tasks = [input.tasks[0]];
  input.candidates[0].availableSlots = [];

  const result = generateSchedule(input);

  assert.equal(result.success, false);
  assert.ok(hasDiagnostic(result, "CANDIDATE_AVAILABILITY"));
});

// 5. Interviewer availability
test("Detects when a qualified interviewer is unavailable", () => {
  const input = makeInput();

  input.tasks = [input.tasks[0]];
  input.candidates[0].availableSlots = ["10:00"];
  input.interviewers[0].availableSlots = ["10:30"];

  const result = generateSchedule(input);

  assert.equal(result.success, false);
  assert.ok(hasDiagnostic(result, "INTERVIEWER_AVAILABILITY"));
});

// 6. Room availability
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

// 7. Interviewer workload
test("Detects when the only qualified interviewer exceeds the daily limit", () => {
  const input = makeInput();

  input.interviewers[0].maxInterviewsPerDay = 1;

  const result = generateSchedule(input);

  assert.equal(result.success, false);
  assert.ok(hasDiagnostic(result, "INTERVIEWER_WORKLOAD_LIMIT"));
});

// 8. Multi-slot interview duration
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
  assert.equal(result.schedule[0].endTime,
    result.schedule[0].startTime === "10:00" ? "11:00" :
    result.schedule[0].startTime === "10:30" ? "11:30" :
    "");

  assert.ok(
    ["10:00", "10:30"].includes(result.schedule[0].startTime)
  );
});

// 9. Search limit
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

// 10. Invalid time format
test("Rejects an invalid time format", () => {
  const input = makeInput();

  input.timeSlots = ["25:00"];

  assert.throws(
    () => generateSchedule(input),
    /Time slots must use the HH:MM format/
  );
});

// 11. Duplicate time slots
test("Rejects duplicate time slots", () => {
  const input = makeInput();

  input.timeSlots = ["10:00", "10:00"];

  assert.throws(
    () => generateSchedule(input),
    /Duplicate time slots/
  );
});

// 12. Invalid interview duration
test("Rejects an invalid interview duration", () => {
  const input = makeInput();

  input.tasks[0].durationSlots = 0;

  assert.throws(
    () => generateSchedule(input),
    /positive whole-number duration/
  );
});

console.log(`\nTest summary: ${passed} passed, ${failed} failed.`);

if (failed > 0) {
  process.exitCode = 1;
}
