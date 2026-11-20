import { randomBytes, createHash } from 'node:crypto';

// OAuth2 for consumer Hotmail/Outlook mailboxes using the public Thunderbird client id.
// This is the "token you can read codes with online": a refresh token + client id, redeemed
// for an IMAP-scoped access token. Stored per account as enc_mail_token + mail_client_id.

export const MAIL_CLIENT_ID = '9e5f94bc-e8a4-4e73-b8be-63364c29d753';
const AUTHORIZE = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize';
const TOKEN = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token';
export const MAIL_REDIRECT = 'https://login.microsoftonline.com/common/oauth2/nativeclient';
export const MAIL_SCOPE = 'https://outlook.office.com/IMAP.AccessAsUser.All offline_access';

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** PKCE pair for the public client. */
export function pkce() {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export function authorizeUrl(email: string, challenge: string, state: string, clientId = MAIL_CLIENT_ID) {
  return `${AUTHORIZE}?${new URLSearchParams({
    client_id: clientId, response_type: 'code', redirect_uri: MAIL_REDIRECT, response_mode: 'query',
    scope: MAIL_SCOPE, login_hint: email, prompt: 'login', state, code_challenge: challenge, code_challenge_method: 'S256',
  })}`;
}

export interface MailTokens { refreshToken: string; accessToken: string; expiresAt: number }

async function tokenRequest(body: Record<string, string>): Promise<MailTokens> {
  const res = await fetch(TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body), signal: AbortSignal.timeout(20000) });
  const data = await res.json().catch(() => ({})) as Record<string, string>;
  if (!res.ok || !data.access_token) throw new Error(`MAIL_TOKEN_FAILED:${data.error ?? res.status}`);
  return { refreshToken: data.refresh_token ?? '', accessToken: data.access_token, expiresAt: Date.now() + (Number(data.expires_in ?? 3600) - 60) * 1000 };
}

/** Exchange the authorization code captured from the redirect for tokens. */
export function exchangeCode(code: string, verifier: string, clientId = MAIL_CLIENT_ID) {
  return tokenRequest({ client_id: clientId, grant_type: 'authorization_code', code, redirect_uri: MAIL_REDIRECT, code_verifier: verifier });
}

/** Redeem a stored refresh token for a fresh access token (used before every read). */
export function refreshTokens(refreshToken: string, clientId = MAIL_CLIENT_ID) {
  return tokenRequest({ client_id: clientId, grant_type: 'refresh_token', refresh_token: refreshToken, scope: MAIL_SCOPE });
}

// ── fviainboxes.com: a public temp-mail inbox (no password), the recovery mailbox for
// these Hotmail accounts. Used to read the Microsoft security code during the first login.
const FVIA_DOMAINS = ['fviainboxes.com', 'fviadropinbox.com', 'fviamail.work', 'dropinboxes.com'];
export interface FviaMessage { id?: string; from?: string; subject?: string; body?: string; text?: string; html?: string; date?: string; receivedAt?: string; created_at?: string }

/** Split a recovery address into the temp-mail username + domain. */
export function fviaAddress(recoveryEmail: string) {
  const [user, domain] = recoveryEmail.trim().toLowerCase().split('@');
  if (!user || !FVIA_DOMAINS.includes(domain)) return null;
  return { user, domain };
}

export async function fviaMessages(user: string, domain: string): Promise<FviaMessage[]> {
  const res = await fetch(`https://${domain}/messages?${new URLSearchParams({ username: user, domain })}`,
    { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`FVIA_FAILED:${res.status}`);
  const data = await res.json().catch(() => ({})) as { result?: FviaMessage[] };
  return Array.isArray(data.result) ? data.result : [];
}
