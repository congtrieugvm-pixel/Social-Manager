// AES-256-GCM via Web Crypto API. Switched from `node:crypto.createCipheriv`
// because opennextjs/Cloudflare Workers' unenv polyfill throws
// "crypto.createDecipheriv is not implemented yet" — the polyfill is
// incomplete and we can't use the real Node module at runtime.
//
// Web Crypto is available natively on both Node 16+ and CF Workers, so this
// version works in every runtime. Trade-off: encrypt/decrypt become async.
// All callers updated via scripts/sweep-crypto-callers.js.
//
// Wire-format compatibility: the on-disk encoding is unchanged
//   `${ivBase64}:${ciphertext+tag base64}`
// because Web Crypto AES-GCM appends the 16-byte tag to ciphertext, which
// happens to be exactly the same byte layout the old node:crypto path
// produced. So existing ciphertexts (from local SQLite + migrated to D1)
// decrypt cleanly without re-encryption.

const ALGO = "AES-GCM";
const IV_BYTES = 12;
const KEY_BYTES = 32;

let cachedKey: CryptoKey | null = null;

async function getKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const raw = process.env.ENCRYPTION_KEY;
  let bytes: Uint8Array;
  if (raw) {
    bytes = new Uint8Array(Buffer.from(raw, "base64"));
    if (bytes.length !== KEY_BYTES) {
      throw new Error("ENCRYPTION_KEY must decode to 32 bytes (base64)");
    }
  } else {
    // Dev fallback — derive a deterministic key from a magic string. SAME
    // key as before so existing local DBs (sha256("tiktok-manager-dev-key"))
    // continue to decrypt. Production should always set ENCRYPTION_KEY.
    const seed = new TextEncoder().encode("tiktok-manager-dev-key");
    const hash = await crypto.subtle.digest("SHA-256", seed);
    bytes = new Uint8Array(hash);
  }
  // Wrap in a fresh ArrayBuffer to satisfy TS BufferSource type narrowing
  // (Uint8Array<ArrayBufferLike> from Buffer.from() doesn't match exactly).
  const buf = new Uint8Array(bytes).buffer;
  cachedKey = await crypto.subtle.importKey("raw", buf, ALGO, false, [
    "encrypt",
    "decrypt",
  ]);
  return cachedKey;
}

export async function encrypt(
  plaintext: string | null | undefined,
): Promise<string | null> {
  if (plaintext == null || plaintext === "") return null;
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const enc = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: ALGO, iv }, key, enc);
  return `${Buffer.from(iv).toString("base64")}:${Buffer.from(ciphertext).toString("base64")}`;
}

export async function decrypt(
  value: string | null | undefined,
): Promise<string | null> {
  if (!value) return null;
  const sep = value.indexOf(":");
  if (sep < 0) return null;
  const ivB64 = value.slice(0, sep);
  const payloadB64 = value.slice(sep + 1);
  if (!ivB64 || !payloadB64) return null;
  try {
    const key = await getKey();
    const iv = new Uint8Array(Buffer.from(ivB64, "base64"));
    const payload = new Uint8Array(Buffer.from(payloadB64, "base64"));
    const dec = await crypto.subtle.decrypt({ name: ALGO, iv }, key, payload);
    return new TextDecoder().decode(dec);
  } catch {
    return null;
  }
}
