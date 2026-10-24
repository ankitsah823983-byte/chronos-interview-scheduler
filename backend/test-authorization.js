
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const bcrypt = require("bcryptjs");
const pool = require("./db");

const BASE_URL = "http://localhost:5000";
const SAMPLE_EVENT_ID = "33333333-3333-4333-8333-333333333333";

const fixtures = {
  coordinator: {
    fullName: "Chronos Authorization Test Coordinator",
    email: `chronos-coordinator-${randomUUID()}@example.test`,
    password: `TestCoordinator#${randomUUID()}`,
  },
  candidate: {
    fullName: "Chronos Authorization Test Candidate",
    email: `chronos-candidate-${randomUUID()}@example.test`,
    password: `TestCandidate#${randomUUID()}`,
  },
};

const userIds = [];
const candidateIds = [];
const eventIds = [];
const sessionCookies = [];

let passed = 0;
let failed = 0;

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

async function requestJson(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, options);
  const body = await response.json();
  return { response, body };
}

async function createAccount({ fullName, email, password, role }) {
  const passwordHash = await bcrypt.hash(password, 12);

  let candidateId = null;

  if (role === "candidate") {
    const candidateResult = await pool.query(
      `INSERT INTO candidates (full_name, email)
       VALUES ($1, $2)
       RETURNING candidate_id`,
      [fullName, email]
    );

    candidateId = candidateResult.rows[0].candidate_id;
    candidateIds.push(candidateId);
  }

  const accountResult = await pool.query(
    `INSERT INTO user_accounts
       (full_name, email, password_hash, role, candidate_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING user_id`,
    [fullName, email, passwordHash, role, candidateId]
  );

  const userId = accountResult.rows[0].user_id;
  userIds.push(userId);

  return userId;
}

async function loginAndGetCookie({ email, password }) {
  const { response, body } = await requestJson("/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.success, true);

  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie, "Login should create a session cookie");

  const cookie = setCookie.split(";")[0];
  sessionCookies.push(cookie);

  return cookie;
}

function protectedRequests(cookie) {
  const headers = cookie ? { Cookie: cookie } : {};

  return [
    {
      name: "list recruitment events",
      path: "/api/events",
      options: { headers },
    },
    {
      name: "create recruitment event",
      path: "/api/events",
      options: {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          eventName: "Authorization Test Event",
          eventDate: "2026-12-20",
        }),
      },
    },
    {
      name: "generate interview schedule",
      path: "/api/schedule",
      options: {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      },
    },
    {
      name: "retrieve saved schedule",
      path: `/api/schedules/${SAMPLE_EVENT_ID}`,
      options: { headers },
    },
    {
      name: "publish an event",
      path: `/api/events/${SAMPLE_EVENT_ID}/publish`,
      options: {
        method: "POST",
        headers,
      },
    },
  ];
}

async function assertProtectedRouteStatuses(cookie, expectedStatus) {
  const requests = protectedRequests(cookie);

  for (const request of requests) {
    const { response, body } = await requestJson(
      request.path,
      request.options
    );

    assert.equal(
      response.status,
      expectedStatus,
      `${request.name}: expected HTTP ${expectedStatus}, received HTTP ${response.status}. Response: ${JSON.stringify(body)}`
    );

    assert.equal(
      body.success,
      false,
      `${request.name}: rejected request should return success:false`
    );
  }
}

async function cleanup() {
  // Invalidate test sessions before deleting the test accounts.
  for (const cookie of sessionCookies) {
    try {
      await fetch(`${BASE_URL}/api/auth/logout`, {
        method: "POST",
        headers: {
          Cookie: cookie,
        },
      });
    } catch (error) {
      console.warn("Test logout cleanup failed:", error.message);
    }
  }

  // Delete only records created by this test run.
  try {
    if (eventIds.length > 0) {
      await pool.query(
        `DELETE FROM recruitment_events
         WHERE event_id = ANY($1::uuid[])`,
        [eventIds]
      );
    }

    if (userIds.length > 0) {
      await pool.query(
        `DELETE FROM user_accounts
         WHERE user_id = ANY($1::uuid[])`,
        [userIds]
      );
    }

    if (candidateIds.length > 0) {
      await pool.query(
        `DELETE FROM candidates
         WHERE candidate_id = ANY($1::uuid[])`,
        [candidateIds]
      );
    }
  } catch (error) {
    console.error("Authorization test cleanup failed:", error.message);
    process.exitCode = 1;
  }

  await pool.end();
}

async function main() {
  try {
    await createAccount({
      ...fixtures.coordinator,
      role: "coordinator",
    });

    await createAccount({
      ...fixtures.candidate,
      role: "candidate",
    });

    const coordinatorCookie = await loginAndGetCookie(
      fixtures.coordinator
    );

    const candidateCookie = await loginAndGetCookie(
      fixtures.candidate
    );

    console.log("Chronos role-based authorization tests\n");

    await test(
      "Rejects unauthenticated requests on all coordinator routes",
      async () => {
        await assertProtectedRouteStatuses(null, 401);
      }
    );

    await test(
      "Rejects candidate access to all coordinator routes",
      async () => {
        await assertProtectedRouteStatuses(candidateCookie, 403);
      }
    );

    await test(
      "Allows an authenticated coordinator to list events",
      async () => {
        const { response, body } = await requestJson("/api/events", {
          headers: { Cookie: coordinatorCookie },
        });

        assert.equal(response.status, 200, JSON.stringify(body));
        assert.equal(body.success, true);
        assert.ok(Array.isArray(body.events));
      }
    );

    await test(
      "Allows a coordinator to create a draft event",
      async () => {
        const { response, body } = await requestJson("/api/events", {
          method: "POST",
          headers: {
            Cookie: coordinatorCookie,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            eventName: "Chronos Authorization Test Event",
            eventDate: "2026-12-20",
          }),
        });

        assert.equal(response.status, 201, JSON.stringify(body));
        assert.equal(body.success, true);
        assert.equal(body.event.status, "draft");

        eventIds.push(body.event.eventId);
      }
    );

    console.log(`\nTest summary: ${passed} passed, ${failed} failed.`);

    if (failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    await cleanup();
  }
}

main().catch(async (error) => {
  console.error("Authorization test runner failed:", error.message);
  process.exitCode = 1;

  await cleanup();
});
