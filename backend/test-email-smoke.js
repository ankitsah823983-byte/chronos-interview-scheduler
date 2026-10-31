
"use strict";

require("dotenv").config();

const nodemailer = require("nodemailer");

async function main() {
  const emailUser = process.env.EMAIL_USER;
  const emailPassword = process.env.EMAIL_APP_PASSWORD;
  const fromName =
    process.env.EMAIL_FROM_NAME || "Chronos Interview Scheduler";

  if (!emailUser || !emailPassword) {
    throw new Error("EMAIL_USER or EMAIL_APP_PASSWORD is missing.");
  }

  // Require an explicit recipient on the command line.
  const recipient = process.argv[2]?.trim();

  if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    throw new Error(
      "Provide your dedicated test inbox as the only command-line argument."
    );
  }

  // Do not send to the configured sender by accident.
  if (recipient.toLowerCase() === emailUser.trim().toLowerCase()) {
    throw new Error(
      "Recipient must be your dedicated test inbox, not the sender account."
    );
  }

  const confirmation = process.argv[3];

  if (confirmation !== "--confirm-send-one-test-email") {
    throw new Error(
      "Sending requires the explicit --confirm-send-one-test-email argument."
    );
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: emailUser,
      pass: emailPassword,
    },
  });

  try {
    await transporter.verify();
    console.log("SMTP authentication/connection verified.");

    const result = await transporter.sendMail({
      from: {
        name: fromName,
        address: emailUser,
      },
      to: recipient,
      subject: "Chronos SMTP smoke test",
      text: [
        "This is a single controlled SMTP smoke test.",
        "",
        "It contains no invitation token or user data.",
        "If you received this message, outbound email delivery is working.",
        "",
        "Chronos Interview Scheduler",
      ].join("\n"),
    });

    console.log("SMTP accepted the test message.");
    console.log("Message ID:", result.messageId || "(not provided)");
    console.log("Recipient:", recipient);
    console.log("Check the inbox and Spam folder.");
  } finally {
    transporter.close();
  }
}

main().catch((error) => {
  console.error("SMTP smoke test failed:", error.message);
  process.exitCode = 1;
});
