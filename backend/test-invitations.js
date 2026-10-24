
const assert = require("node:assert/strict");
const { randomUUID, createHash } = require("node:crypto");
const pool = require("./db");
const coordinatorSession = require("./test-coordinator-session");

const BASE_URL = "http://localhost:5000";

const testSuffix = randomUUID();

const candidate = {
  name: "Chronos Invitation Candidate",
  email: `chronos-invite-candidate-${testSuffix}@example.test`,
  id: null,
};

const interviewer = {
  name: "Chronos Invitation Interviewer",
  email: `chronos-invite-interviewer-${testSuffix}@example.test`,
  id: null,
};

const candidatePassword = `CandidateInvite#${randomUUID()}`;
const interviewerPassword = `InterviewerInvite#${randomUUID()}`;

let candidateInvitation = null;
let interviewerInvitation = null;
let passed = 0;
let failed = 0;
let cleanupStarted = false;

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

async function createInvitation(payload) {
  return requestJson("/api/invitations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

async function redeemInvitation(token, password) {
  return requestJson("/api/auth/redeem-invitation", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ token, password }),
  });
}

async function createTestProfiles() {
  const candidateResult = await pool.query(
    `INSERT INTO candidates (full_name, email)
     VALUES ($1, $2)
     RETURNING candidate_id`,
    [candidate.name, candidate.email]
  );

  candidate.id = candidateResult.rows[0].candidate_id;

  const interviewerResult = await pool.query(
    `INSERT INTO interviewers (full_name, email)
     VALUES ($1, $2)
     RETURNING interviewer_id`,
    [interviewer.name, interviewer.email]
  );

  interviewer.id = interviewerResult.rows[0].interviewer_id;
}

async function assertStoredTokenHash(invitation) {
  const expectedHash = createHash("sha256")
    .update(invitation.token)
    .digest("hex");

  const result = await pool.query(
    `SELECT token_hash
     FROM account_invitations
     WHERE invitation_id = $1`,
    [invitation.invitationId]
  );

  assert.equal(result.rowCount, 1);
  assert.equal(result.rows[0].token_hash, expectedHash);
  assert.notEqual(result.rows[0].token_hash, invitation.token);
}

async function cleanup() {
  if (cleanupStarted) return;
  cleanupStarted = true;

  const emails = [candidate.email, interviewer.email];

  try {
    await pool.query(
      `DELETE FROM account_invitations
       WHERE email = ANY($1::text[])`,
      [emails]
    );

    await pool.query(
      `DELETE FROM user_accounts
       WHERE email = ANY($1::text[])`,
      [emails]
    );

    if (candidate.id) {
      await pool.query(
        `DELETE FROM candidates WHERE candidate_id = $1`,
        [candidate.id]
      );
    }

    if (interviewer.id) {
      await pool.query(
        `DELETE FROM interviewers WHERE interviewer_id = $1`,
        [interviewer.id]
      );
    }
  } catch (error) {
    console.error("Invitation test cleanup failed:", error.message);
    process.exitCode = 1;
  }

  await coordinatorSession.cleanup();
}

async function main() {
  try {
    await coordinatorSession.ready;
    await createTestProfiles();

    console.log("Chronos account invitation tests\n");

    // 1. The coordinator must provide a valid role and profile ID.
    await test(
      "Rejects an invitation without the required profile",
      async () => {
        const { response, body } = await createInvitation({
          role: "candidate",
        });

        assert.equal(response.status, 400);
        assert.equal(body.success, false);
      }
    );

    // 2. Invitations must not be used to create coordinator accounts.
    await test(
      "Rejects invitations for the coordinator role",
      async () => {
        const { response, body } = await createInvitation({
          role: "coordinator",
          candidateId: candidate.id,
        });

        assert.equal(response.status, 400);
        assert.equal(body.success, false);
      }
    );

    // 3. A nonexistent profile must not be invited.
    await test(
      "Rejects an invitation for an unknown candidate",
      async () => {
        const { response, body } = await createInvitation({
          role: "candidate",
          candidateId: randomUUID(),
        });

        assert.equal(response.status, 404);
        assert.equal(body.success, false);
      }
    );

    // 4. Create a candidate invitation and verify token hashing.
    await test(
      "Creates a candidate invitation with a hashed one-time token",
      async () => {
        const { response, body } = await createInvitation({
          role: "candidate",
          candidateId: candidate.id,
        });

        assert.equal(response.status, 201, JSON.stringify(body));
        assert.equal(body.success, true);
        assert.equal(body.invitation.role, "candidate");
        assert.equal(body.invitation.email, candidate.email);
        assert.ok(body.invitation.invitationId);
        assert.ok(body.invitation.expiresAt);
        assert.ok(body.token);

        candidateInvitation = {
          invitationId: body.invitation.invitationId,
          token: body.token,
        };

        await assertStoredTokenHash(candidateInvitation);
      }
    );

    // 5. Redeeming must link the account to the original candidate profile.
    await test(
      "Redeems a candidate invitation and links the existing profile",
      async () => {
        assert.ok(candidateInvitation);

        const { response, body } = await redeemInvitation(
          candidateInvitation.token,
          candidatePassword
        );

        assert.equal(response.status, 201, JSON.stringify(body));
        assert.equal(body.success, true);
        assert.equal(body.user.role, "candidate");
        assert.equal(body.user.email, candidate.email);
        assert.equal(body.user.fullName, candidate.name);
        assert.equal(body.user.candidateId, candidate.id);
        assert.equal(body.user.interviewerId, null);

        assert.equal(body.user.password, undefined);
        assert.equal(body.user.passwordHash, undefined);

        const result = await pool.query(
          `SELECT
             candidate_id,
             interviewer_id,
             password_hash,
             role
           FROM user_accounts
           WHERE user_id = $1`,
          [body.user.userId]
        );

        assert.equal(result.rowCount, 1);
        assert.equal(result.rows[0].candidate_id, candidate.id);
        assert.equal(result.rows[0].interviewer_id, null);
        assert.equal(result.rows[0].role, "candidate");
        assert.notEqual(
          result.rows[0].password_hash,
          candidatePassword
        );
      }
    );

    // 6. An invitation can only be redeemed once.
    await test(
      "Rejects redemption of a previously used invitation",
      async () => {
        assert.ok(candidateInvitation);

        const { response, body } = await redeemInvitation(
          candidateInvitation.token,
          candidatePassword
        );

        assert.equal(response.status, 410);
        assert.equal(body.success, false);
      }
    );

    // 7. A used profile cannot receive another account invitation.
    await test(
      "Rejects another invitation after the candidate has an account",
      async () => {
        const { response, body } = await createInvitation({
          role: "candidate",
          candidateId: candidate.id,
        });

        assert.equal(response.status, 409);
        assert.equal(body.success, false);
      }
    );

    // 8. Unknown tokens must not create an account.
    await test(
      "Rejects an invalid invitation token",
      async () => {
        const { response, body } = await redeemInvitation(
          randomUUID(),
          `InvalidToken#${randomUUID()}`
        );

        assert.equal(response.status, 400);
        assert.equal(body.success, false);
      }
    );

    // 9. Interviewer invitations must link the correct interviewer profile.
    await test(
      "Creates and redeems an invitation for an interviewer",
      async () => {
        const createResult = await createInvitation({
          role: "interviewer",
          interviewerId: interviewer.id,
        });

        assert.equal(
          createResult.response.status,
          201,
          JSON.stringify(createResult.body)
        );

        const invitation = createResult.body.invitation;

        assert.equal(invitation.role, "interviewer");
        assert.equal(invitation.email, interviewer.email);
        assert.ok(invitation.invitationId);
        assert.ok(createResult.body.token);

        interviewerInvitation = {
          invitationId: invitation.invitationId,
          token: createResult.body.token,
        };

        await assertStoredTokenHash(interviewerInvitation);

        const redeemResult = await redeemInvitation(
          interviewerInvitation.token,
          interviewerPassword
        );

        assert.equal(
          redeemResult.response.status,
          201,
          JSON.stringify(redeemResult.body)
        );

        assert.equal(redeemResult.body.success, true);
        assert.equal(redeemResult.body.user.role, "interviewer");
        assert.equal(
          redeemResult.body.user.email,
          interviewer.email
        );
        assert.equal(
          redeemResult.body.user.interviewerId,
          interviewer.id
        );
        assert.equal(redeemResult.body.user.candidateId, null);
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
  console.error("Invitation test runner failed:", error.message);
  process.exitCode = 1;

  try {
    await cleanup();
  } catch (cleanupError) {
    console.error("Cleanup failed:", cleanupError.message);
  }
});
