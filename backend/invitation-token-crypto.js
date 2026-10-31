
const {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} = require("node:crypto");

function getEncryptionKey() {
  const value = process.env.INVITATION_TOKEN_ENCRYPTION_KEY;

  if (!value || !/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error(
      "INVITATION_TOKEN_ENCRYPTION_KEY must be a 32-byte hex key."
    );
  }

  return Buffer.from(value, "hex");
}

function encryptInvitationToken(token) {
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("A valid invitation token is required.");
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    iv
  );

  const ciphertext = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return [
    iv.toString("base64url"),
    authTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

function decryptInvitationToken(encryptedToken) {
  if (typeof encryptedToken !== "string") {
    throw new Error("A valid encrypted invitation token is required.");
  }

  const parts = encryptedToken.split(".");

  if (parts.length !== 3 || parts.some((part) => !part)) {
    throw new Error("Invalid encrypted invitation token format.");
  }

  const [ivPart, tagPart, ciphertextPart] = parts;
  const iv = Buffer.from(ivPart, "base64url");
  const authTag = Buffer.from(tagPart, "base64url");
  const ciphertext = Buffer.from(ciphertextPart, "base64url");

  if (iv.length !== 12 || authTag.length !== 16 || ciphertext.length === 0) {
    throw new Error("Invalid encrypted invitation token.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    iv
  );

  decipher.setAuthTag(authTag);

  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

module.exports = {
  encryptInvitationToken,
  decryptInvitationToken,
};
