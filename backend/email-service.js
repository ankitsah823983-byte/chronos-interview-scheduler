
const nodemailer = require("nodemailer");

const emailUser = process.env.EMAIL_USER;
const emailPassword = process.env.EMAIL_APP_PASSWORD;
const fromName = process.env.EMAIL_FROM_NAME || "Chronos Interview Scheduler";

let transporter = null;

function getTransporter() {
  if (transporter) {
    return transporter;
  }

  if (!emailUser || !emailPassword) {
    throw new Error("Email configuration is missing.");
  }

  transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: emailUser,
      pass: emailPassword,
    },
  });

  return transporter;
}

async function sendEmail({ to, subject, text, html }) {
  if (!to || typeof to !== "string") {
    throw new Error("A valid recipient email is required.");
  }

  // Never send automated test emails to reserved test domains.
  const recipient = to.trim().toLowerCase();

  if (
    recipient.endsWith(".test") ||
    recipient.endsWith("@example.com") ||
    recipient.endsWith("@example.test")
  ) {
    return {
      skipped: true,
      reason: "Test recipient",
    };
  }

  if (process.env.NODE_ENV === "test") {
  return {
    skipped: true,
    reason: "Email delivery is disabled in test environment.",
  };
}

  const mailer = getTransporter();

  return mailer.sendMail({
    from: {
      name: fromName,
      address: emailUser,
    },
    to: recipient,
    subject,
    text,
    ...(html ? { html } : {}),
  });
}

module.exports = {
  sendEmail,
};
