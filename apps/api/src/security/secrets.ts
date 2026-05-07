import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const algorithm = "aes-256-gcm";

export function encryptSecret(value: string, secret: string) {
  const key = createHash("sha256").update(secret).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(".");
}

export function decryptSecret(payload: string, secret: string) {
  const [ivBase64, tagBase64, encryptedBase64] = payload.split(".");

  if (!ivBase64 || !tagBase64 || !encryptedBase64) {
    throw new Error("Invalid encrypted secret payload.");
  }

  const key = createHash("sha256").update(secret).digest();
  const decipher = createDecipheriv(algorithm, key, Buffer.from(ivBase64, "base64"));
  decipher.setAuthTag(Buffer.from(tagBase64, "base64"));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(encryptedBase64, "base64")), decipher.final()]);

  return decrypted.toString("utf8");
}

export function last4(value: string) {
  return value.slice(-4);
}
