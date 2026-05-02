import crypto from "node:crypto";

const ALGO = "aes-256-gcm";

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    // Fallback for local MVP — dev-only key. Set ENCRYPTION_KEY in production.
    return crypto.createHash("sha256").update("tiktok-manager-dev-key").digest();
  }
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error("ENCRYPTION_KEY must decode to 32 bytes (base64)");
  }
  return buf;
}

export function encrypt(plaintext: string | null | undefined): string | null {
  if (plaintext == null || plaintext === "") return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Store as `iv:ciphertext+tag` base64
  return `${iv.toString("base64")}:${Buffer.concat([enc, tag]).toString("base64")}`;
}

export function decrypt(value: string | null | undefined): string | null {
  if (!value) return null;
  const [ivB64, payloadB64] = value.split(":");
  if (!ivB64 || !payloadB64) return null;
  const iv = Buffer.from(ivB64, "base64");
  const payload = Buffer.from(payloadB64, "base64");
  const tag = payload.subarray(payload.length - 16);
  const enc = payload.subarray(0, payload.length - 16);
  const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString("utf8");
}
