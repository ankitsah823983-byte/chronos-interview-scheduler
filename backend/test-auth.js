
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const pool = require("./db");

const BASE_URL = "http://localhost:5000";
const TEST_EMAIL = `chronos-auth-${randomUUID()}@example.test`;
const TEST_PASSWORD = "ChronosTestPass#2026";

let passed = 0;
let failed = 0;
let sessionCookie = null;
let registeredUserId = null;

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

async function register(payload) {
  return requestJson("/api/auth/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

async function login(email, password) {
  return requestJson("/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });
}

function cookieFrom(response) {
  const setCookie = response.headers.get("set-cookie");

  assert.ok(setCookie, "Expected the server to set a session cookie");

  return setCookie.split(";")[0];
}

// 1. Account information must not be accessible without a session.
async function testUnauthenticatedMe() {
  const { response, body } = await requestJson("/api/auth/me");

  assert.equal(response.status, 401);
  assert.equal(body.success, false);
}

// 2. Reject incomplete registration requests.
async function testInvalidRegistration() {
  const { response, body } = await register({
    email: TEST_EMAIL,
  });

  assert.equal(response.status, 400);
  assert.equal(body.success, false);
}

// 3. Public registration must not grant coordinator privileges.
async function testCannotRegisterAsCoordinator() {
  const { response, body } = await register({
    fullName: "Unauthorized Coordinator",
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
    role: "coordinator",
  });

  assert.equal(response.status, 400);
  assert.equal(body.success, false);
}

// 4. Public registration must not grant interviewer privileges.
async function testCannotRegisterAsInterviewer() {
  const { response, body } = await register({
    fullName: "Unauthorized Interviewer",
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
    role: "interviewer",
  });

  assert.equal(response.status, 400);
  assert.equal(body.success, false);
}

// 5. A valid public registration creates a candidate account.
async function testCandidateRegistrationAndPasswordHash() {
  const { response, body } = await register({
    fullName: "Chronos Auth Test Candidate",
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });

  assert.equal(response.status, 201, JSON.stringify(body));
  assert.equal(body.success, true);
  assert.equal(body.user.fullName, "Chronos Auth Test Candidate");
  assert.equal(body.user.email, TEST_EMAIL);
  assert.equal(body.user.role, "candidate");
  assert.ok(body.user.userId);
  assert.ok(body.user.candidateId);

  assert.equal(body.user.password, undefined);
  assert.equal(body.user.passwordHash, undefined);
  assert.equal(body.user.password_hash, undefined);

  registeredUserId = body.user.userId;

  const result = await pool.query(
    `SELECT password_hash
     FROM user_accounts
     WHERE user_id = $1`,
    [registeredUserId]
  );

  assert.equal(result.rowCount, 1);

  const passwordHash = result.rows[0].password_hash;

  assert.notEqual(passwordHash, TEST_PASSWORD);
  assert.match(
    passwordHash,
    /^\$2[aby]\$\d{2}\$/,
    "Expected a bcrypt password hash"
  );
}

// 6. Duplicate email addresses must be rejected case-insensitively.
async function testDuplicateEmail() {
  const { response, body } = await register({
    fullName: "Duplicate Test Candidate",
    email: TEST_EMAIL.toUpperCase(),
    password: TEST_PASSWORD,
  });

  assert.equal(response.status, 409);
  assert.equal(body.success, false);
}

// 7. Incorrect credentials must not start a session.
async function testIncorrectPassword() {
  const { response, body } = await login(
    TEST_EMAIL,
    "DefinitelyWrongPassword#2026"
  );

  assert.equal(response.status, 401);
  assert.equal(body.success, false);
}

// 8. Valid credentials should create a session.
async function testValidLogin() {
  const { response, body } = await login(
    TEST_EMAIL,
    TEST_PASSWORD
  );

  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.success, true);
  assert.equal(body.user.role, "candidate");
  assert.equal(body.user.userId, registeredUserId);

  assert.equal(body.user.password, undefined);
  assert.equal(body.user.passwordHash, undefined);

  sessionCookie = cookieFrom(response);
}

// 9. The session should identify the logged-in user.
async function testAuthenticatedMe() {
  assert.ok(sessionCookie, "Login must establish a session");

  const { response, body } = await requestJson("/api/auth/me", {
    headers: {
      Cookie: sessionCookie,
    },
  });

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.user.userId, registeredUserId);
  assert.equal(body.user.email, TEST_EMAIL);
  assert.equal(body.user.role, "candidate");
}

// 10. Logout should invalidate the session.
async function testLogout() {
  assert.ok(sessionCookie, "A session cookie is required");

  const { response, body } = await requestJson("/api/auth/logout", {
    method: "POST",
    headers: {
      Cookie: sessionCookie,
    },
  });

  assert.equal(response.status, 200);
  assert.equal(body.success, true);

  const { response: meResponse, body: meBody } =
    await requestJson("/api/auth/me", {
      headers: {
        Cookie: sessionCookie,
      },
    });

  assert.equal(meResponse.status, 401);
  assert.equal(meBody.success, false);
}

async function main() {
  console.log("Chronos authentication tests\n");

  await test(
    "Rejects account access without a session",
    testUnauthenticatedMe
  );

  await test(
    "Rejects incomplete registration requests",
    testInvalidRegistration
  );

  await test(
    "Prevents public coordinator registration",
    testCannotRegisterAsCoordinator
  );

  await test(
    "Prevents public interviewer registration",
    testCannotRegisterAsInterviewer
  );

  await test(
    "Creates a candidate account with a hashed password",
    testCandidateRegistrationAndPasswordHash
  );

  await test(
    "Rejects duplicate email addresses regardless of case",
    testDuplicateEmail
  );

  await test(
    "Rejects incorrect login credentials",
    testIncorrectPassword
  );

  await test(
    "Creates a session after valid login",
    testValidLogin
  );

  await test(
    "Returns the authenticated user's identity",
    testAuthenticatedMe
  );

  await test(
    "Invalidates the session after logout",
    testLogout
  );

  console.log(`\nTest summary: ${passed} passed, ${failed} failed.`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error("Authentication test runner failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
