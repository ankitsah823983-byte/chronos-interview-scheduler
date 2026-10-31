
"use strict";

// SAFETY: Tests must NEVER use the production database.
process.env.DB_NAME = "chronos_test_db";
process.env.EMAIL_DELIVERY_MAX_ATTEMPTS = "5";

const assert = require("node:assert/strict");
const Module = require("node:module");
const crypto = require("node:crypto");

const pool = require("./db");
const { encryptInvitationToken } = require("./invitation-token-crypto");

// Mock email-service before loading the delivery worker.
// This test file cannot send real emails.
let emailMode = "success";
let emailCalls = 0;

const emailServicePath = require.resolve("./email-service");
const mockEmailModule = new Module(emailServicePath, module);

mockEmailModule.filename = emailServicePath;
mockEmailModule.loaded = true;
mockEmailModule.exports = {
  async sendEmail() {
    emailCalls++;

    if (emailMode === "temporary-failure") {
      const error = new Error("Mock temporary SMTP failure");
      error.command = "CONN";
      throw error;
    }

    if (emailMode === "uncertain") {
      const error = new Error("Mock uncertain SMTP outcome");
      error.command = "DATA";
      throw error;
    }

    return { messageId: "mock-message-id" };
  },
};

require.cache[emailServicePath] = mockEmailModule;

const {
  deliverInvitationEmail,
  markStaleInvitationSendsUncertain,
} = require("./invitation-email-delivery");

const createdInvitationIds = [];
let coordinatorId;
let candidateId;

function testToken() {
  return `recovery-test-${crypto.randomUUID()}`;
}

async function createFixtures() {
  const dbResult = await pool.query(
    "SELECT current_database() AS name"
  );

  assert.equal(
    dbResult.rows[0].name,
    "chronos_test_db",
    "Safety check failed: connected database is not chronos_test_db"
  );

  const coordinator = await pool.query(
    `INSERT INTO user_accounts
       (full_name, email, password_hash, role)
     VALUES ($1, $2, $3, 'coordinator')
     RETURNING user_id`,
    [
      "Recovery Test Coordinator",
      `coordinator-${testToken()}@example.test`,
      "test-only-password-hash",
    ]
  );

  coordinatorId = coordinator.rows[0].user_id;

  const candidate = await pool.query(
    `INSERT INTO candidates (full_name, email)
     VALUES ($1, $2)
     RETURNING candidate_id`,
    [
      "Recovery Test Candidate",
      `candidate-${testToken()}@example.test`,
    ]
  );

  candidateId = candidate.rows[0].candidate_id;
}

async function createInvitation({
  status = "pending",
  attempts = 0,
  ciphertext = true,
  stale = false,
  expires = true,
  redeemed = false,
  revoked = false,
} = {}) {
  const encrypted = ciphertext
    ? encryptInvitationToken(testToken())
    : null;

  const result = await pool.query(
    `INSERT INTO account_invitations (
       email,
       role,
       candidate_id,
       token_hash,
       token_ciphertext,
       expires_at,
       created_by_user_id,
       email_delivery_status,
       email_delivery_attempts,
       email_last_error,
       email_sent_at,
       email_sending_started_at,
       email_next_attempt_at,
       redeemed_at,
       revoked_at
     )
     VALUES (
       $1, 'candidate', $2, $3, $4,
       CASE WHEN $5 THEN now() + interval '1 day'
            ELSE now() - interval '1 day' END,
       $6, $7, $8, NULL, NULL,
       CASE WHEN $9 THEN now() - interval '30 minutes'
            WHEN $7 = 'sending' THEN now()
            ELSE NULL END,
       now(),
       CASE WHEN $10 THEN now() ELSE NULL END,
       CASE WHEN $11 THEN now() ELSE NULL END
     )
     RETURNING invitation_id`,
    [
      `invite-${testToken()}@example.test`,
      candidateId,
      `test-hash-${crypto.randomUUID()}`,
      encrypted,
      expires,
      coordinatorId,
      status,
      attempts,
      stale,
      redeemed,
      revoked,
    ]
  );

  const invitationId = result.rows[0].invitation_id;
  createdInvitationIds.push(invitationId);

  return invitationId;
}

async function getInvitation(id) {
  const result = await pool.query(
    `SELECT email_delivery_status AS status,
            email_delivery_attempts AS attempts,
            email_last_error AS last_error,
            email_sent_at AS sent_at,
            email_sending_started_at AS sending_started_at,
            email_next_attempt_at AS next_attempt_at
     FROM account_invitations
     WHERE invitation_id = $1`,
    [id]
  );

  assert.equal(
    result.rowCount,
    1,
    "Expected invitation to exist"
  );

  return result.rows[0];
}

const tests = [
  [
    "successful delivery marks invitation sent",
    async () => {
      emailMode = "success";

      const id = await createInvitation();
      const result = await deliverInvitationEmail(id);
      const row = await getInvitation(id);

      assert.equal(result.sent, true);
      assert.equal(row.status, "sent");
      assert.equal(row.attempts, 1);
      assert.ok(row.sent_at);
      assert.equal(row.sending_started_at, null);
    },
  ],

  [
    "temporary email failure marks invitation failed and schedules retry",
    async () => {
      emailMode = "temporary-failure";

      const id = await createInvitation();

      await assert.rejects(
        () => deliverInvitationEmail(id)
      );

      const row = await getInvitation(id);

      assert.equal(row.status, "failed");
      assert.equal(row.attempts, 1);
      assert.ok(row.last_error);
      assert.ok(row.next_attempt_at);
      assert.equal(row.sending_started_at, null);
    },
  ],

  [
    "uncertain SMTP outcome is not marked as an ordinary failure",
    async () => {
      emailMode = "uncertain";

      const id = await createInvitation();

      await assert.rejects(
        () => deliverInvitationEmail(id)
      );

      const row = await getInvitation(id);

      assert.equal(row.status, "uncertain");
      assert.equal(row.attempts, 1);
      assert.equal(row.sending_started_at, null);
    },
  ],

  [
    "stale sending invitation becomes uncertain",
    async () => {
      const id = await createInvitation({
        status: "sending",
        attempts: 1,
        stale: true,
      });

      await markStaleInvitationSendsUncertain();

      const row = await getInvitation(id);

      assert.equal(row.status, "uncertain");
      assert.equal(row.sending_started_at, null);
    },
  ],

  [
    "legacy invitation without ciphertext is not delivered",
    async () => {
      emailMode = "success";

      const id = await createInvitation({
        ciphertext: false,
      });

      const before = emailCalls;
      const result = await deliverInvitationEmail(id);
      const row = await getInvitation(id);

      assert.equal(result.sent, false);
      assert.equal(row.status, "pending");
      assert.equal(row.attempts, 0);
      assert.equal(emailCalls, before);
    },
  ],

  [
    "invitation at retry limit is not delivered",
    async () => {
      emailMode = "success";

      const id = await createInvitation({
        attempts: 5,
      });

      const before = emailCalls;
      const result = await deliverInvitationEmail(id);
      const row = await getInvitation(id);

      assert.equal(result.sent, false);
      assert.equal(row.status, "pending");
      assert.equal(row.attempts, 5);
      assert.equal(emailCalls, before);
    },
  ],

  [
    "expired invitation is not delivered",
    async () => {
      emailMode = "success";

      const id = await createInvitation({
        expires: false,
      });

      const before = emailCalls;
      const result = await deliverInvitationEmail(id);
      const row = await getInvitation(id);

      assert.equal(result.sent, false);
      assert.equal(row.status, "pending");
      assert.equal(row.attempts, 0);
      assert.equal(emailCalls, before);
    },
  ],

  [
    "revoked invitation is not delivered",
    async () => {
      emailMode = "success";

      const id = await createInvitation({
        revoked: true,
      });

      const before = emailCalls;
      const result = await deliverInvitationEmail(id);
      const row = await getInvitation(id);

      assert.equal(result.sent, false);
      assert.equal(row.status, "pending");
      assert.equal(row.attempts, 0);
      assert.equal(emailCalls, before);
    },
  ],

  [
    "redeemed invitation is not delivered",
    async () => {
      emailMode = "success";

      const id = await createInvitation({
        redeemed: true,
      });

      const before = emailCalls;
      const result = await deliverInvitationEmail(id);
      const row = await getInvitation(id);

      assert.equal(result.sent, false);
      assert.equal(row.status, "pending");
      assert.equal(row.attempts, 0);
      assert.equal(emailCalls, before);
    },
  ],

  [
    "retry is blocked before its scheduled time and allowed when due",
    async () => {
      emailMode = "success";

      const id = await createInvitation({
        status: "failed",
        attempts: 1,
      });

      await pool.query(
        `UPDATE account_invitations
         SET email_next_attempt_at = now() + interval '10 minutes'
         WHERE invitation_id = $1`,
        [id]
      );

      const callsBefore = emailCalls;

      // Attempt before the retry time.
      const earlyResult = await deliverInvitationEmail(id);
      const earlyRow = await getInvitation(id);

      assert.equal(earlyResult.sent, false);
      assert.equal(earlyRow.status, "failed");
      assert.equal(earlyRow.attempts, 1);
      assert.equal(emailCalls, callsBefore);

      // Simulate the retry becoming due.
      await pool.query(
        `UPDATE account_invitations
         SET email_next_attempt_at = now() - interval '1 second'
         WHERE invitation_id = $1`,
        [id]
      );

      const dueResult = await deliverInvitationEmail(id);
      const dueRow = await getInvitation(id);

      assert.equal(dueResult.sent, true);
      assert.equal(dueRow.status, "sent");
      assert.equal(dueRow.attempts, 2);
      assert.equal(emailCalls, callsBefore + 1);
    },
  ],

  [
    "concurrent delivery attempts claim the invitation only once",
    async () => {
      emailMode = "success";

      const id = await createInvitation();
      const callsBefore = emailCalls;

      const results = await Promise.all([
        deliverInvitationEmail(id),
        deliverInvitationEmail(id),
      ]);

      const row = await getInvitation(id);

      assert.equal(
        results.filter((result) => result.sent === true).length,
        1,
        "Exactly one attempt should claim and deliver the invitation"
      );

      assert.equal(
        results.filter((result) => result.sent === false).length,
        1,
        "The other attempt should be rejected as ineligible"
      );

      assert.equal(emailCalls, callsBefore + 1);
      assert.equal(row.status, "sent");
      assert.equal(row.attempts, 1);
    },
  ],
];

async function cleanup() {
  if (createdInvitationIds.length > 0) {
    await pool.query(
      `DELETE FROM account_invitations
       WHERE invitation_id = ANY($1::uuid[])`,
      [createdInvitationIds]
    );
  }

  if (coordinatorId) {
    await pool.query(
      "DELETE FROM user_accounts WHERE user_id = $1",
      [coordinatorId]
    );
  }

  if (candidateId) {
    await pool.query(
      "DELETE FROM candidates WHERE candidate_id = $1",
      [candidateId]
    );
  }
}

async function main() {
  let passed = 0;
  let failed = 0;

  try {
    await createFixtures();

    console.log(
      "Safety check passed: connected to chronos_test_db"
    );
    console.log(
      "Email service is mocked; no real emails will be sent.\n"
    );

    for (const [name, run] of tests) {
      try {
        await run();
        passed++;
        console.log(`PASS: ${name}`);
      } catch (error) {
        failed++;
        console.error(`FAIL: ${name}`);
        console.error(`     ${error.message}`);
      }
    }
  } catch (error) {
    failed++;
    console.error("Test setup failed:", error.message);
  } finally {
    try {
      await cleanup();
    } catch (error) {
      failed++;
      console.error("Test cleanup failed:", error.message);
    }

    await pool.end();
  }

  console.log(
    `\nResults: ${passed} passed, ${failed} failed`
  );

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main();
