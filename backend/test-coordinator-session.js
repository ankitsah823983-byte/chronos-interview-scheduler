
const { randomUUID } = require("node:crypto");
const bcrypt = require("bcryptjs");
const pool = require("./db");

const BASE_URL = "http://localhost:5000";
const originalFetch = global.fetch;

let testUserId = null;
let sessionCookie = null;
let cleanedUp = false;

async function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;

  global.fetch = originalFetch;

  if (sessionCookie) {
    try {
      await originalFetch(`${BASE_URL}/api/auth/logout`, {
        method: "POST",
        headers: {
          Cookie: sessionCookie,
        },
      });
    } catch (error) {
      console.warn("Test session logout failed:", error.message);
    }
  }

  if (testUserId) {
    try {
      await pool.query(
        `DELETE FROM user_accounts
         WHERE user_id = $1`,
        [testUserId]
      );
    } catch (error) {
      console.warn("Test account cleanup failed:", error.message);
    }
  }

  await pool.end();
}

async function setup() {
  const uniqueId = randomUUID();
  const email = `chronos-api-coordinator-${uniqueId}@example.test`;
  const password = `TestCoordinator#${randomUUID()}`;
  const passwordHash = await bcrypt.hash(password, 12);

  const accountResult = await pool.query(
    `INSERT INTO user_accounts
       (full_name, email, password_hash, role)
     VALUES ($1, $2, $3, 'coordinator')
     RETURNING user_id`,
    ["Chronos API Test Coordinator", email, passwordHash]
  );

  testUserId = accountResult.rows[0].user_id;

  const loginResponse = await originalFetch(
    `${BASE_URL}/api/auth/login`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        password,
      }),
    }
  );

  const loginBody = await loginResponse.json();

  if (!loginResponse.ok || !loginBody.success) {
    throw new Error(
      `Could not create the API test session: ${
        loginBody.error || loginResponse.status
      }`
    );
  }

  const setCookie = loginResponse.headers.get("set-cookie");

  if (!setCookie) {
    throw new Error("The login response did not set a session cookie.");
  }

  sessionCookie = setCookie.split(";")[0];

  // Automatically attach the temporary coordinator cookie to Chronos API
  // requests made by test-api.js. Authentication endpoints stay untouched.
  global.fetch = async (input, options = {}) => {
    const inputUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;

    if (!inputUrl || !inputUrl.startsWith(`${BASE_URL}/`)) {
      return originalFetch(input, options);
    }

    const pathname = new URL(inputUrl).pathname;

    if (pathname.startsWith("/api/auth/")) {
      return originalFetch(input, options);
    }

    const headers = new Headers(
      options.headers ||
        (typeof Request !== "undefined" && input instanceof Request
          ? input.headers
          : undefined)
    );

    headers.set("Cookie", sessionCookie);

    return originalFetch(input, {
      ...options,
      headers,
    });
  };

  console.log("Test coordinator session ready.");
}

const ready = setup().catch(async (error) => {
  await cleanup();
  throw error;
});

module.exports = {
  ready,
  cleanup,
};
