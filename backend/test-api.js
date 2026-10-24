
const assert = require("node:assert/strict");
const coordinatorSession = require("./test-coordinator-session");

const BASE_URL = "http://localhost:5000";
const TEST_EVENT_DATE = "2026-11-15";

function makePayload() {
  const timeSlots = ["10:00", "10:30", "11:00", "11:30"];

  return {
    eventName: "Chronos API Test Event",
    eventDate: TEST_EVENT_DATE,
    timeSlots,

    candidates: [
      {
        id: "c1",
        name: "Candidate A",
        availableSlots: ["10:00", "10:30"],
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
        roundName: "Technical Interview",
        requiredSkills: ["DSA"],
        durationSlots: 1,
      },
    ],
  };
}

let passed = 0;
let failed = 0;
let savedEventId = null;
let createdDraftEventId = null;
let infeasibleEventId = null;

async function test(name, callback) {
  try {
    await callback();
    passed++;
    console.log(`PASS: ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL: ${name}`);
    console.error(`  ${error.message}`);
  }
}

async function postSchedule(payload) {
  const response = await fetch(`${BASE_URL}/api/schedule`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = await response.json();
  return { response, body };
}

async function getSchedule(eventId) {
  const response = await fetch(
    `${BASE_URL}/api/schedules/${encodeURIComponent(eventId)}`
  );

  const body = await response.json();
  return { response, body };
}

async function postPublish(eventId) {
  const response = await fetch(
    `${BASE_URL}/api/events/${encodeURIComponent(eventId)}/publish`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    }
  );

  const body = await response.json();
  return { response, body };
}

// 1. Generate and persist a draft schedule.
async function testSuccessfulGeneration() {
  const { response, body } = await postSchedule(makePayload());

  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.success, true);
  assert.equal(body.schedule.length, 2);
  assert.deepEqual(body.unscheduledTasks, []);
  assert.ok(body.persistence?.eventId);
  assert.equal(body.persistence.savedInterviews, 2);

  savedEventId = body.persistence.eventId;
}

// 2. Create a draft event independently of schedule generation.
async function testCreateDraftEvent() {
  const response = await fetch(`${BASE_URL}/api/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      eventName: "Chronos Draft Creation Test Event",
      eventDate: "2026-12-10",
    }),
  });

  const body = await response.json();

  assert.equal(response.status, 201, JSON.stringify(body));
  assert.equal(body.success, true);
  assert.ok(body.event?.eventId);
  assert.equal(
    body.event.eventName,
    "Chronos Draft Creation Test Event"
  );
  assert.equal(body.event.eventDate, "2026-12-10");
  assert.equal(body.event.status, "draft");

  createdDraftEventId = body.event.eventId;

  const { response: getResponse, body: getBody } =
    await getSchedule(createdDraftEventId);

  assert.equal(getResponse.status, 200);
  assert.equal(getBody.event.status, "draft");
  assert.equal(getBody.savedInterviews, 0);
  assert.deepEqual(getBody.schedule, []);
}

// 3. Reject missing scheduling arrays.
async function testMissingArrays() {
  const { response, body } = await postSchedule({
    timeSlots: [],
  });

  assert.equal(response.status, 400);
  assert.equal(body.success, false);
  assert.match(body.error, /fields must be arrays/i);
}

// 4. Reject empty arrays.
async function testEmptyArrays() {
  const payload = makePayload();
  payload.tasks = [];

  const { response, body } = await postSchedule(payload);

  assert.equal(response.status, 400);
  assert.equal(body.success, false);
  assert.match(body.error, /at least one item/i);
}

// 5. Reject invalid time format.
async function testInvalidTime() {
  const payload = makePayload();
  payload.timeSlots = ["25:00"];

  const { response, body } = await postSchedule(payload);

  assert.equal(response.status, 400);
  assert.equal(body.success, false);
  assert.match(body.error, /HH:MM format/i);
}

// 6. Reject missing event date for a new event.
async function testMissingEventDate() {
  const payload = makePayload();
  delete payload.eventDate;

  const { response, body } = await postSchedule(payload);

  assert.equal(response.status, 400);
  assert.match(body.error, /valid date/i);
}

// 7. Reject an impossible calendar date.
async function testImpossibleDate() {
  const payload = makePayload();
  payload.eventDate = "2026-02-30";

  const { response, body } = await postSchedule(payload);

  assert.equal(response.status, 400);
  assert.match(body.error, /valid date/i);
}

// 8. An infeasible schedule must not be published.
async function testInfeasibleSchedule() {
  const payload = makePayload();
  payload.timeSlots = ["10:00"];

  for (const candidate of payload.candidates) {
    candidate.availableSlots = ["10:00"];
  }

  for (const interviewer of payload.interviewers) {
    interviewer.availableSlots = ["10:00"];
  }

  for (const room of payload.rooms) {
    room.availableSlots = ["10:00"];
  }

  const { response, body } = await postSchedule(payload);

  assert.equal(response.status, 422);
  assert.equal(body.success, false);
  assert.deepEqual(body.schedule, []);
  assert.ok(body.persistence?.eventId);
  assert.equal(body.persistence.savedInterviews, 0);

  assert.ok(
    body.diagnostics.some(
      (item) => item.code === "SHARED_RESOURCE_CONFLICT"
    ),
    "Expected a shared-resource conflict diagnostic"
  );

  infeasibleEventId = body.persistence.eventId;
}

// 9. The event list includes metadata and interview counts.
async function testListSavedEvents() {
  assert.ok(savedEventId);
  assert.ok(createdDraftEventId);

  const response = await fetch(`${BASE_URL}/api/events`);
  const body = await response.json();

  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.success, true);
  assert.ok(Array.isArray(body.events));
  assert.equal(body.total, body.events.length);

  const scheduledEvent = body.events.find(
    (item) => item.eventId === savedEventId
  );

  assert.ok(scheduledEvent);
  assert.equal(scheduledEvent.eventName, "Chronos API Test Event");
  assert.equal(scheduledEvent.eventDate, TEST_EVENT_DATE);
  assert.equal(scheduledEvent.status, "draft");
  assert.equal(scheduledEvent.interviewCount, 2);

  const emptyDraft = body.events.find(
    (item) => item.eventId === createdDraftEventId
  );

  assert.ok(emptyDraft);
  assert.equal(emptyDraft.status, "draft");
  assert.equal(emptyDraft.interviewCount, 0);
}

// 10. Reusing a draft must not create duplicate interviews.
async function testReuseDraftWithoutDuplicates() {
  assert.ok(createdDraftEventId);

  for (let attempt = 1; attempt <= 2; attempt++) {
    const payload = {
      ...makePayload(),
      eventId: createdDraftEventId,
    };

    const { response, body } = await postSchedule(payload);

    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.success, true);
    assert.equal(body.persistence.eventId, createdDraftEventId);
    assert.equal(body.persistence.reusedEvent, true);
    assert.equal(body.persistence.schedulePersisted, true);
    assert.equal(body.persistence.savedInterviews, 2);
  }

  const { response, body } = await getSchedule(createdDraftEventId);

  assert.equal(response.status, 200);
  assert.equal(body.event.eventId, createdDraftEventId);
  assert.equal(body.event.status, "draft");
  assert.equal(body.savedInterviews, 2);
  assert.equal(body.schedule.length, 2);
}

// 11. Failed regeneration must preserve the previous saved schedule.
async function testFailedRegenerationPreservesDraft() {
  const payload = {
    ...makePayload(),
    eventId: createdDraftEventId,
    timeSlots: ["10:00"],
  };

  for (const candidate of payload.candidates) {
    candidate.availableSlots = ["10:00"];
  }

  for (const interviewer of payload.interviewers) {
    interviewer.availableSlots = ["10:00"];
  }

  for (const room of payload.rooms) {
    room.availableSlots = ["10:00"];
  }

  const { response, body } = await postSchedule(payload);

  assert.equal(response.status, 422);
  assert.equal(body.success, false);
  assert.equal(body.persistence.eventId, createdDraftEventId);
  assert.equal(body.persistence.reusedEvent, true);
  assert.equal(body.persistence.schedulePersisted, false);
  assert.equal(body.persistence.savedInterviews, 2);

  const { response: getResponse, body: getBody } =
    await getSchedule(createdDraftEventId);

  assert.equal(getResponse.status, 200);
  assert.equal(getBody.event.status, "draft");
  assert.equal(getBody.savedInterviews, 2);
  assert.equal(getBody.schedule.length, 2);
}

// 12. Retrieve saved event metadata.
async function testRetrieveEventMetadata() {
  const { response, body } = await getSchedule(savedEventId);

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.event.eventId, savedEventId);
  assert.equal(body.event.eventName, "Chronos API Test Event");
  assert.equal(body.event.eventDate, TEST_EVENT_DATE);
  assert.equal(body.event.status, "draft");
  assert.equal(body.savedInterviews, 2);
}

// 13. Retrieve full saved configuration.
async function testRetrieveEventConfiguration() {
  const { response, body } = await getSchedule(savedEventId);

  assert.equal(response.status, 200);
  assert.equal(body.success, true);

  const configuration = body.configuration;
  assert.ok(configuration);

  assert.deepEqual(
    configuration.timeSlots,
    ["10:00", "10:30", "11:00", "11:30"]
  );

  assert.equal(configuration.candidates.length, 2);

  const candidateA = configuration.candidates.find(
    (candidate) => candidate.name === "Candidate A"
  );

  const candidateB = configuration.candidates.find(
    (candidate) => candidate.name === "Candidate B"
  );

  assert.ok(candidateA);
  assert.ok(candidateB);
  assert.deepEqual(candidateA.availableSlots, ["10:00", "10:30"]);
  assert.deepEqual(
    candidateB.availableSlots,
    ["10:00", "10:30", "11:00", "11:30"]
  );

  assert.equal(configuration.interviewers.length, 1);

  const interviewer = configuration.interviewers[0];

  assert.equal(interviewer.name, "Interviewer X");
  assert.ok(interviewer.skills.includes("DSA"));
  assert.deepEqual(
    interviewer.availableSlots,
    ["10:00", "10:30", "11:00", "11:30"]
  );
  assert.equal(interviewer.maxInterviewsPerDay, 2);

  assert.equal(configuration.rooms.length, 1);

  const room = configuration.rooms[0];

  assert.equal(room.name, "Room 1");
  assert.deepEqual(
    room.availableSlots,
    ["10:00", "10:30", "11:00", "11:30"]
  );

  assert.equal(configuration.tasks.length, 2);

  const codingTask = configuration.tasks.find(
    (task) => task.roundName === "Coding Interview"
  );

  const technicalTask = configuration.tasks.find(
    (task) => task.roundName === "Technical Interview"
  );

  assert.ok(codingTask);
  assert.ok(technicalTask);
  assert.equal(codingTask.candidateId, candidateA.id);
  assert.equal(technicalTask.candidateId, candidateB.id);
  assert.deepEqual(codingTask.requiredSkills, ["DSA"]);
  assert.equal(codingTask.durationSlots, 1);
  assert.deepEqual(technicalTask.requiredSkills, ["DSA"]);
  assert.equal(technicalTask.durationSlots, 1);
}

// 14. Retrieve interview details and unique IDs.
async function testRetrieveInterviewDetails() {
  const { response, body } = await getSchedule(savedEventId);

  assert.equal(response.status, 200);
  assert.equal(body.schedule.length, 2);

  const interviewIds = body.schedule.map(
    (interview) => interview.interviewId
  );

  assert.ok(interviewIds.every((id) => id !== null && id !== undefined));
  assert.equal(new Set(interviewIds).size, 2);

  for (const interview of body.schedule) {
    assert.ok(interview.taskId);
    assert.ok(interview.candidateId);
    assert.ok(interview.candidateName);
    assert.ok(interview.roundName);
    assert.ok(interview.interviewerName);
    assert.equal(interview.interviewerIds.length, 1);
    assert.ok(interview.roomName);
    assert.ok(interview.startTime);
    assert.ok(interview.endTime);
    assert.equal(interview.status, "draft");
  }
}

// 15. Unknown schedule returns 404.
async function testUnknownEvent() {
  const unknownId = "11111111-1111-4111-8111-111111111111";
  const { response, body } = await getSchedule(unknownId);

  assert.equal(response.status, 404);
  assert.equal(body.success, false);
}

// 16. Malformed publish UUID returns 400.
async function testInvalidPublishId() {
  const { response, body } = await postPublish("not-a-uuid");

  assert.equal(response.status, 400);
  assert.equal(body.success, false);
  assert.match(body.error, /valid UUID/i);
}

// 17. Event without interviews cannot be published.
async function testPublishEmptyEvent() {
  const { response, body } = await postPublish(infeasibleEventId);

  assert.equal(response.status, 409);
  assert.equal(body.success, false);
  assert.match(body.error, /at least one interview/i);

  const { body: eventBody } = await getSchedule(infeasibleEventId);
  assert.equal(eventBody.event.status, "draft");
}

// 18. Publish a valid draft schedule.
async function testPublishValidEvent() {
  const { response, body } = await postPublish(savedEventId);

  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.success, true);
  assert.equal(body.event.eventId, savedEventId);
  assert.equal(body.event.status, "published");
  assert.equal(body.publishedInterviews, 2);
}

// 19. Published status persists.
async function testPublishedStatusPersists() {
  const { response, body } = await getSchedule(savedEventId);

  assert.equal(response.status, 200);
  assert.equal(body.event.status, "published");
  assert.equal(body.schedule.length, 2);

  for (const interview of body.schedule) {
    assert.equal(interview.status, "published");
  }
}

// 20. Repeated publication is safe.
async function testRepeatedPublish() {
  const { response, body } = await postPublish(savedEventId);

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.alreadyPublished, true);
  assert.equal(body.publishedInterviews, 2);
}

// 21. Published event cannot be regenerated.
async function testCannotRegeneratePublishedEvent() {
  const payload = {
    ...makePayload(),
    eventId: savedEventId,
  };

  const { response, body } = await postSchedule(payload);

  assert.equal(response.status, 409);
  assert.equal(body.success, false);
  assert.match(body.error, /draft event/i);

  const { body: getBody } = await getSchedule(savedEventId);
  assert.equal(getBody.event.status, "published");
  assert.equal(getBody.savedInterviews, 2);
}

// 22. Publishing an unknown event returns 404.
async function testPublishUnknownEvent() {
  const unknownId = "22222222-2222-4222-8222-222222222222";
  const { response, body } = await postPublish(unknownId);

  assert.equal(response.status, 404);
  assert.equal(body.success, false);
  assert.match(body.error, /not found/i);
}

async function main() {
  await coordinatorSession.ready;

  try {
    console.log("Chronos API and event lifecycle tests\n");

    await test("Generates and persists a valid draft schedule", testSuccessfulGeneration);
    await test("Creates an independent draft event", testCreateDraftEvent);
    await test("Rejects missing scheduling arrays", testMissingArrays);
    await test("Rejects empty scheduling arrays", testEmptyArrays);
    await test("Rejects invalid time formatting", testInvalidTime);
    await test("Rejects a missing event date", testMissingEventDate);
    await test("Rejects an impossible calendar date", testImpossibleDate);
    await test("Returns 422 for an infeasible schedule", testInfeasibleSchedule);
    await test("Lists saved events and interview counts", testListSavedEvents);
    await test("Reuses a draft without duplicate interviews", testReuseDraftWithoutDuplicates);
    await test("Preserves draft interviews when regeneration fails", testFailedRegenerationPreservesDraft);
    await test("Retrieves saved event metadata", testRetrieveEventMetadata);
    await test("Retrieves the full event configuration", testRetrieveEventConfiguration);
    await test("Retrieves interview details and unique IDs", testRetrieveInterviewDetails);
    await test("Returns 404 for an unknown event", testUnknownEvent);
    await test("Rejects an invalid publish UUID", testInvalidPublishId);
    await test("Rejects publishing an event with no interviews", testPublishEmptyEvent);
    await test("Publishes a valid draft schedule", testPublishValidEvent);
    await test("Persists published event and interview statuses", testPublishedStatusPersists);
    await test("Handles repeated publish requests safely", testRepeatedPublish);
    await test("Rejects regeneration of a published event", testCannotRegeneratePublishedEvent);
    await test("Returns 404 when publishing an unknown event", testPublishUnknownEvent);

    console.log(`\nTest summary: ${passed} passed, ${failed} failed.`);

    if (failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    await coordinatorSession.cleanup();
  }
}

main().catch(async (error) => {
  console.error("API test runner failed:", error.message);
  process.exitCode = 1;

  try {
    await coordinatorSession.cleanup();
  } catch (cleanupError) {
    console.error("Test cleanup failed:", cleanupError.message);
  }
});
