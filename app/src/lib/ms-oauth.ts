import { decrypt, encrypt } from "@/lib/crypto";

export const OAUTH_TTL_SECONDS = 600;
export const OAUTH_COOKIE_PATH = "/api/oauth/microsoft";
const NONCE_RE = /^[A-Za-z0-9_-]{43}$/;

export interface OAuthAttempt {
  accountId: number;
  ownerId: number;
  email: string;
  nonce: string;
  verifier: string;
  sessionHash: string;
  clientId: string;
  redirectUri: string;
  expiresAt: number;
}

export function randomOAuthValue(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

export async function sha256(value: string): Promise<string> {
  return Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))).toString("base64url");
}

export function oauthCookieName(nonce: string): string | null {
  return NONCE_RE.test(nonce) ? `sm_ms_oauth_${nonce}` : null;
}

export function normalizeMailbox(email: string): string {
  return email.trim().toLowerCase();
}

export async function sealOAuthAttempt(attempt: OAuthAttempt): Promise<string> {
  const value = await encrypt(JSON.stringify(attempt));
  if (!value) throw new Error("Không tạo được phiên kết nối Microsoft.");
  return value;
}

export async function readOAuthAttempt(
  value: string | undefined, nonce: string, ownerId: number, sessionToken: string,
): Promise<OAuthAttempt> {
  const invalid = () => new Error("Phiên kết nối đã hết hạn hoặc không khớp. Hãy bấm Get Token lại.");
  if (!value || !sessionToken || !oauthCookieName(nonce)) throw invalid();
  let attempt: OAuthAttempt;
  try {
    const plain = await decrypt(value);
    if (!plain) throw invalid();
    attempt = JSON.parse(plain);
  } catch { throw invalid(); }
  const now = Math.floor(Date.now() / 1000);
  if (
    !Number.isSafeInteger(attempt.accountId) || attempt.accountId <= 0 ||
    attempt.ownerId !== ownerId || attempt.nonce !== nonce ||
    !Number.isFinite(attempt.expiresAt) || attempt.expiresAt <= now ||
    attempt.expiresAt > now + OAUTH_TTL_SECONDS ||
    typeof attempt.email !== "string" || !attempt.email ||
    typeof attempt.clientId !== "string" || !attempt.clientId ||
    typeof attempt.redirectUri !== "string" ||
    !NONCE_RE.test(attempt.verifier) ||
    attempt.sessionHash !== await sha256(sessionToken)
  ) throw invalid();
  return attempt;
}

// Escape both HTML and the inline JS payload; upstream errors are untrusted.
export function oauthResultHtml(input: {
  ok: boolean; message: string; accountId: number | null; email?: string;
}): string {
  const message = input.message.replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]!);
  const payload = JSON.stringify({ type: "ms-oauth-result", ...input })
    .replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  return `<!doctype html><html lang="vi"><meta charset="utf-8"><title>Get Token Hotmail</title>
<style>body{background:#101010;color:#eee;font:15px system-ui;padding:40px;text-align:center}main{max-width:460px;margin:auto}p{line-height:1.6}button{padding:10px 20px;cursor:pointer}</style>
<main><h1>${input.ok ? "Đã lưu token Hotmail" : "Chưa kết nối được Hotmail"}</h1><p>${message}</p>
<p>Bạn có thể đóng cửa sổ này và quay lại ứng dụng.</p><button onclick="window.close()">Đóng cửa sổ</button></main>
<script>if(window.opener){window.opener.postMessage(${payload},window.location.origin)}
${input.ok ? "setTimeout(function(){window.close()},1200)" : ""}</script></html>`;
}
