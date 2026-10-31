
require("./db"); // Loads backend/.env before reading email settings.

const { sendEmail } = require("./email-service");

async function main() {
  const recipient = process.env.TEST_EMAIL_RECIPIENT;

  if (!recipient) {
    console.error(
      "Please set TEST_EMAIL_RECIPIENT in your backend/.env file."
    );
    process.exitCode = 1;
    return;
  }

  try {
    console.log("Sending test email...");

    const result = await sendEmail({
      to: recipient,
      subject: "Chronos Email Test",
      text: [
        "Hi!",
        "",
        "This is a test email from Chronos Interview Scheduler.",
        "",
        "If you received this message, Gmail email delivery is working.",
        "",
        "Chronos Interview Scheduler",
      ].join("\n"),
    });

    if (result.skipped) {
      console.error("Email was skipped:", result.reason);
      process.exitCode = 1;
      return;
    }

    console.log("Email accepted by Gmail SMTP.");
    console.log("Message ID:", result.messageId);
    console.log("Check your inbox and spam folder.");
  } catch (error) {
    console.error("Test email failed:", error.message);
    process.exitCode = 1;
  }
}

main();
