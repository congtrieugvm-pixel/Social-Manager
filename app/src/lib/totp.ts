import { TOTP, URI, Secret } from "otpauth";

export interface TotpResult {
  code: string;
  remainingMs: number;
  period: number;
}

// Accepts raw Base32 secret (spaces/dashes allowed, case-insensitive)
// or full otpauth:// URI. Returns null if unusable.
export function generateTotpCode(rawSecret: string): TotpResult | null {
  if (!rawSecret) return null;
  const trimmed = rawSecret.trim();
  if (!trimmed) return null;

  let totp: TOTP | null = null;

  if (trimmed.toLowerCase().startsWith("otpauth://")) {
    try {
      const obj = URI.parse(trimmed);
      if (obj instanceof TOTP) totp = obj;
    } catch {
      return null;
    }
  }

  if (!totp) {
    const cleaned = trimmed.replace(/[\s-]+/g, "").toUpperCase();
    if (!/^[A-Z2-7]+=*$/.test(cleaned)) return null;
    try {
      totp = new TOTP({
        secret: Secret.fromBase32(cleaned),
        digits: 6,
        period: 30,
        algorithm: "SHA1",
      });
    } catch {
      return null;
    }
  }

  const period = totp.period;
  const code = totp.generate();
  const now = Date.now();
  const remainingMs = period * 1000 - (now % (period * 1000));
  return { code, remainingMs, period };
}
