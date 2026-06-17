import crypto from "crypto";

const ENCRYPTION_ALGORITHM = "aes-256-gcm";

const getEncryptionKey = () =>
  crypto
    .createHash("sha256")
    .update(
      process.env.POS_PIN_ENCRYPTION_KEY ||
        process.env.VOLTA_SECRET ||
        process.env.SESSION_SECRET ||
        process.env.JWT_SECRET ||
        process.env.DATABASE_URL ||
        "volta-pos-pin-development-key",
      "utf8"
    )
    .digest();

export const hashSecret = (secret) => {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(secret), salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
};

export const verifySecret = (secret, storedHash) => {
  const [algorithm, salt, hash] = String(storedHash || "").split(":");
  if (algorithm !== "scrypt" || !salt || !hash) return false;

  const candidate = crypto.scryptSync(String(secret), salt, 64);
  const expected = Buffer.from(hash, "hex");
  return expected.length === candidate.length && crypto.timingSafeEqual(expected, candidate);
};

export const generateSixDigitPin = () =>
  String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");

export const isSixDigitPin = (value) => /^\d{6}$/.test(String(value || "").trim());

export const encryptPin = (pin) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(pin), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `aes256gcm:${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
};

export const decryptPin = (encryptedPin) => {
  const [algorithm, ivHex, tagHex, encryptedHex] = String(encryptedPin || "").split(":");
  if (algorithm !== "aes256gcm" || !ivHex || !tagHex || !encryptedHex) return null;

  try {
    const decipher = crypto.createDecipheriv(
      ENCRYPTION_ALGORITHM,
      getEncryptionKey(),
      Buffer.from(ivHex, "hex")
    );
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedHex, "hex")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
};

export const buildPosPinData = (pin) => ({
  posPinHash: hashSecret(pin),
  posPinEncrypted: encryptPin(pin),
  posPinUpdatedAt: new Date(),
  posCredentialsEnabled: true,
});

export async function ensureStorePosCredentialColumns(prisma) {
  const columns = [
    ["posPinHash", "TEXT NULL"],
    ["posPinEncrypted", "TEXT NULL"],
    ["posPinUpdatedAt", "DATETIME NULL"],
    ["posCredentialsEnabled", "BOOLEAN NOT NULL DEFAULT true"],
  ];

  let existingColumns = new Set();

  try {
    const rows = await prisma.$queryRawUnsafe("SHOW COLUMNS FROM `Store`");
    existingColumns = new Set(
      (rows || []).map((row) => String(row.Field || row.field || "").trim())
    );
  } catch (error) {
    console.warn("[pos-credentials] Store column introspection failed:", error?.message || error);
  }

  for (const [columnName, definition] of columns) {
    if (existingColumns.has(columnName)) continue;

    try {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE \`Store\` ADD COLUMN \`${columnName}\` ${definition}`
      );
    } catch (error) {
      const message = `${error?.message || ""} ${error?.meta?.message || ""}`;
      if (!message.includes("Duplicate column name")) {
        throw error;
      }
    }
  }
}
