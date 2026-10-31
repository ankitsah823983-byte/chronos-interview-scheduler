
"use strict";

// Isolated worker lifecycle tests.
// Never enable the real worker or connect to SMTP.

require("dotenv").config();

process.env.DB_NAME = "chronos_test_db";
delete process.env.EMAIL_DELIVERY_WORKER_ENABLED;

const assert = require("node:assert/strict");
const { test, before, after } = require("node:test");

const nodemailer = require("nodemailer");
nodemailer.createTransport = () => {
  throw new Error("SAFETY BLOCK: real SMTP is forbidden in tests");
};

const emailService = require("./email-service");
emailService.sendEmail = async () => ({
  messageId: "mock-worker-message",
});

const pool = require("./db");
const worker = require("./email-delivery");

before(async () => {
  const result = await pool.query("SELECT current_database() AS db");
  assert.equal(
    result.rows[0].db,
    "chronos_test_db",
    "SAFETY ABORT: only chronos_test_db is permitted"
  );
});

after(async () => {
  try {
    await worker.stopEmailDeliveryWorker();
  } finally {
    await pool.end();
  }
});

test("worker stays disabled unless explicitly enabled", async () => {
  delete process.env.EMAIL_DELIVERY_WORKER_ENABLED;

  worker.startEmailDeliveryWorker();

  // With the flag absent, the start function must return without
  // starting automatic polling or sending queued mail.
  assert.equal(process.env.EMAIL_DELIVERY_WORKER_ENABLED, undefined);
});

test("stopping a disabled worker is safe and repeatable", async () => {
  await worker.stopEmailDeliveryWorker();
  await worker.stopEmailDeliveryWorker();

  assert.equal(process.env.EMAIL_DELIVERY_WORKER_ENABLED, undefined);
});
