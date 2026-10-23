const { generateSchedule } = require("./scheduler");

const timeSlots = [
  "10:00",
  "10:30",
  "11:00",
  "11:30",
];

const candidates = [
  {
    id: "c1",
    name: "Candidate A",
    availableSlots: ["10:00", "10:30"],
  },
  {
    id: "c2",
    name: "Candidate B",
    availableSlots: timeSlots,
  },
];

const interviewers = [
  {
    id: "i1",
    name: "Interviewer X",
    skills: ["DSA"],
    availableSlots: timeSlots,
    maxInterviewsPerDay: 2,
  },
];

const rooms = [
  {
    id: "r1",
    name: "Room 1",
    availableSlots: timeSlots,
  },
];

const tasks = [
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
];

const result = generateSchedule({
  timeSlots,
  candidates,
  interviewers,
  rooms,
  tasks,
});

console.log(JSON.stringify(result, null, 2));
// Test 2: Both interviews require the same single slot.
const conflictResult = generateSchedule({
  timeSlots: ["10:00"],

  candidates: candidates.map((candidate) => ({
    ...candidate,
    availableSlots: ["10:00"],
  })),

  interviewers: interviewers.map((interviewer) => ({
    ...interviewer,
    availableSlots: ["10:00"],
  })),

  rooms: rooms.map((room) => ({
    ...room,
    availableSlots: ["10:00"],
  })),

  tasks,
});

console.log("\nConflict test:");
console.log("Success:", conflictResult.success);
console.log("Reason:", conflictResult.reason);