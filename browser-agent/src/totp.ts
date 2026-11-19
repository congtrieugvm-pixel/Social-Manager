import { createHmac } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Base32 secret (as authenticator apps show it; spaces/dashes/padding allowed) or null if it isn't one. */
export function base32(secret: string): Buffer | null {
  let clean = secret.trim();
  // Some exports store an otpauth:// URI instead of the bare secret.
  if (/^otpauth:/i.test(clean)) { try { clean = new URL(clean).searchParams.get('secret') ?? ''; } catch { return null; } }
  clean = clean.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase();
  if (clean.length < 16 || /[^A-Z2-7]/.test(clean)) return null;
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const char of clean) {
    value = (value << 5) | ALPHABET.indexOf(char); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

/** RFC 6238 TOTP (SHA-1, 30 s, 6 digits) — what TikTok's authenticator-app step expects. */
export function totp(key: Buffer, now = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30000)));
  const mac = createHmac('sha1', key).update(counter).digest();
  const offset = mac[mac.length - 1] & 0xf;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

/** Milliseconds left in the current 30 s window. */
export const totpRemaining = (now = Date.now()) => 30000 - (now % 30000);
