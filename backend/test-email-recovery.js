
"use strict";

// Safety-first email recovery tests.
// Only chronos_test_db is permitted. Real SMTP is blocked.

require("dotenv").config();

process.env.DB_NAME = "chronos_test_db";
process.env.EMAIL_DELIVERY_MAX_ATTEMPTS = "5";
process.env.EMAIL_DELIVERY_STALE_SENDING_MS = "60000";

const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { test, before, after, beforeEach } = require("node:test");

// Block real SMTP transport before loading delivery modules.
const nodemailer = require("nodemailer");
nodemailer.createTransport = () => {
  throw new Error("SAFETY BLOCK: real SMTP transport is forbidden in tests");
};

// Mock sendEmail before delivery modules import it.
let mockImplementation = async () => ({ messageId: "mock-message" });
const mockCalls = [];

const emailService = require("./email-service");
emailService.sendEmail = async (message) => {
  mockCalls.push(message);
  return mockImplementation(message);
};

const pool = require("./db");
const { createDeliveryJob, deliverEmail } = require("./email-delivery");
const {
  markStaleInvitationSendsUncertain,
} = require("./invitation-email-delivery");

const RUN_ID = randomUUID();
const JOB_PREFIX = `recovery-test:${RUN_ID}:`;

const testInvitationIds = [];
const testCoordinatorIds = [];
const testCandidateIds = [];

before(async () => {
  const result = await pool.query("SELECT current_database() AS db");
  const actualDb = result.rows[0].db;

  console.log("Recovery test database:", actualDb);

  if (actualDb !== "chronos_test_db") {
    throw new Error(
      `SAFETY ABORT: expected chronos_test_db, got ${actualDb}`
    );
  }
});

beforeEach(() => {
  mockCalls.length = 0;
  mockImplementation = async () => ({ messageId: "mock-message" });
});

after(async () => {
  const errors = [];

  async function cleanup(label, action) {
    try {
      await action();
    } catch (error) {
      errors.push(`${label}: ${error.message}`);
    }
  }

  try {
    for (const id of testInvitationIds) {
      await cleanup(`invitation ${id}`, () =>
        pool.query(
          "DELETE FROM account_invitations WHERE invitation_id = $1",
          [id]
        )
      );
    }

    for (const id of testCoordinatorIds) {
      await cleanup(`coordinator ${id}`, () =>
        pool.query(
          "DELETE FROM user_accounts WHERE user_id = $1",
          [id]
        )
      );
    }

    for (const id of testCandidateIds) {
      await cleanup(`candidate ${id}`, () =>
        pool.query(
          "DELETE FROM candidates WHERE candidate_id = $1",
          [id]
        )
      );
    }

    await cleanup("test email jobs", () =>
      pool.query(
        "DELETE FROM email_delivery_jobs WHERE dedupe_key LIKE $1",
        [`${JOB_PREFIX}%`]
      )
    );
  } finally {
    await pool.end();
  }

  if (errors.length) {
    throw new Error(`Cleanup errors:\n${errors.join("\n")}`);
  }
});

async function createTestJob(label) {
  const result = await createDeliveryJob({
    userId: null,
    eventId: null,
    recipientEmail: `recovery-${randomUUID()}@example.test`,
    deliveryType: "event_assignment",
    dedupeKey: `${JOB_PREFIX}${label}:${randomUUID()}`,
    subject: "Mock recovery test",
    textBody: "This message must never be sent to a real recipient.",
  });

  assert.ok(result?.deliveryId, "Expected a delivery job");
  return result.deliveryId;
}

async function getJob(deliveryId) {
  const result = await pool.query(
    `SELECT status, attempts, last_error, next_attempt_at,
            sending_started_at, sent_at
     FROM email_delivery_jobs
     WHERE delivery_id = $1`,
    [deliveryId]
  );

  assert.equal(result.rowCount, 1, "Expected test job to exist");
  return result.rows[0];
}

test("successful event email becomes sent", async () => {
  const deliveryId = await createTestJob("success");

  const result = await deliverEmail(deliveryId);
  const job = await getJob(deliveryId);

  assert.equal(result.sent, true);
  assert.equal(job.status, "sent");
  assert.equal(job.attempts, 1);
  assert.ok(job.sent_at);
  assert.equal(mockCalls.length, 1);
});

test("temporary SMTP failure becomes failed and schedules retry", async () => {
  const deliveryId = await createTestJob("temporary-failure");

  mockImplementation = async () => {
    const error = new Error("Simulated connection failure");
    error.command = "CONN";
    throw error;
  };

  await assert.rejects(
    deliverEmail(deliveryId),
    /Simulated connection failure/
  );

  const job = await getJob(deliveryId);

  assert.equal(job.status, "failed");
  assert.equal(job.attempts, 1);
  assert.match(job.last_error, /Simulated connection failure/);
  assert.ok(new Date(job.next_attempt_at).getTime() > Date.now());
  assert.equal(mockCalls.length, 1);
});

test("unknown SMTP outcome becomes uncertain and is not resent", async () => {
  const deliveryId = await createTestJob("unknown-outcome");

  mockImplementation = async () => {
    const error = new Error("Simulated lost SMTP confirmation");
    error.command = "DATA";
    throw error;
  };

  await assert.rejects(
    deliverEmail(deliveryId),
    /Simulated lost SMTP confirmation/
  );

  const firstJob = await getJob(deliveryId);

  assert.equal(firstJob.status, "uncertain");
  assert.equal(firstJob.attempts, 1);
  assert.equal(mockCalls.length, 1);

  const secondResult = await deliverEmail(deliveryId);
  const secondJob = await getJob(deliveryId);

  assert.equal(secondResult.sent, false);
  assert.equal(secondJob.status, "uncertain");
  assert.equal(secondJob.attempts, 1);
  assert.equal(mockCalls.length, 1);
});

test("job at retry limit is not sent again", async () => {
  const deliveryId = await createTestJob("retry-limit");

  await pool.query(
    `UPDATE email_delivery_jobs
     SET attempts = 5,
         next_attempt_at = now() - interval '1 minute'
     WHERE delivery_id = $1`,
    [deliveryId]
  );

  const result = await deliverEmail(deliveryId);
  const job = await getJob(deliveryId);

  assert.equal(result.sent, false);
  assert.equal(job.status, "pending");
  assert.equal(job.attempts, 5);
  assert.equal(mockCalls.length, 0);
});

test("concurrent attempts send an event email only once", async () => {
  const deliveryId = await createTestJob("concurrent");

  const results = await Promise.all([
    deliverEmail(deliveryId),
    deliverEmail(deliveryId),
  ]);

  const job = await getJob(deliveryId);

  assert.equal(
    results.filter((result) => result.sent === true).length,
    1,
    "Exactly one attempt should claim and send the job"
  );

  assert.equal(job.status, "sent");
  assert.equal(job.attempts, 1);
  assert.equal(mockCalls.length, 1);
});

test("stale invitation sending becomes uncertain without resending", async () => {
  const suffix = randomUUID();

  const candidateResult = await pool.query(
    `INSERT INTO candidates (full_name, email)
     VALUES ($1, $2)
     RETURNING candidate_id`,
    [
      `Recovery Test Candidate ${suffix}`,
      `candidate-${suffix}@example.test`,
    ]
  );

  const candidateId = candidateResult.rows[0].candidate_id;
  testCandidateIds.push(candidateId);

  const coordinatorResult = await pool.query(
    `INSERT INTO user_accounts
       (full_name, email, password_hash, role, candidate_id, interviewer_id)
     VALUES ($1, $2, $3, 'coordinator', NULL, NULL)
     RETURNING user_id`,
    [
      `Recovery Test Coordinator ${suffix}`,
      `coordinator-${suffix}@example.test`,
      `test-only-not-a-real-password-hash-${suffix}`,
    ]
  );

  const coordinatorId = coordinatorResult.rows[0].user_id;
  testCoordinatorIds.push(coordinatorId);

  const invitationResult = await pool.query(
    `INSERT INTO account_invitations
       (email, role, candidate_id, token_hash, expires_at,
        created_by_user_id, email_delivery_status,
        email_sending_started_at)
     VALUES ($1, 'candidate', $2, $3,
             now() + interval '1 day', $4, 'sending',
             now() - interval '2 hours')
     RETURNING invitation_id`,
    [
      `invite-${suffix}@example.test`,
      candidateId,
      `recovery-token-hash-${suffix}`,
      coordinatorId,
    ]
  );

  const invitationId = invitationResult.rows[0].invitation_id;
  testInvitationIds.push(invitationId);

  await markStaleInvitationSendsUncertain();

  const result = await pool.query(
    `SELECT email_delivery_status, email_sending_started_at
     FROM account_invitations
     WHERE invitation_id = $1`,
    [invitationId]
  );

  assert.equal(result.rowCount, 1);
  assert.equal(result.rows[0].email_delivery_status, "uncertain");
  assert.equal(result.rows[0].email_sending_started_at, null);
  assert.equal(mockCalls.length, 0);
});
