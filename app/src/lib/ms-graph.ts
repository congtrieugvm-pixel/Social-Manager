import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { decrypt, encrypt } from "@/lib/crypto";
import { MicrosoftError, microsoftJson } from "@/lib/ms-http";

export const OAUTH_SCOPES = ["offline_access", "https://graph.microsoft.com/Mail.Read", "https://graph.microsoft.com/User.Read"];

export function microsoftConfig() {
  return {
    tenant: process.env.AZURE_TENANT || "consumers",
    clientId: process.env.AZURE_CLIENT_ID || "",
    clientSecret: process.env.AZURE_CLIENT_SECRET || "",
    redirectUri: process.env.AZURE_REDIRECT_URI || "http://localhost:3000/api/oauth/microsoft/callback",
  };
}

export function isAzureConfigured(): boolean {
  const config = microsoftConfig();
  return Boolean(config.clientId && config.clientSecret &&
    (process.env.NODE_ENV !== "production" || process.env.ENCRYPTION_KEY));
}

export function buildAuthorizeUrl(state: string, challenge: string, email: string): string {
  const config = microsoftConfig();
  const params = new URLSearchParams({
    client_id: config.clientId, response_type: "code", redirect_uri: config.redirectUri,
    response_mode: "query", scope: OAUTH_SCOPES.join(" "), state,
    prompt: "select_account", login_hint: email,
    code_challenge: challenge, code_challenge_method: "S256",
  });
  return `https://login.microsoftonline.com/${encodeURIComponent(config.tenant)}/oauth2/v2.0/authorize?${params}`;
}

export interface TokenResponse {
  access_token: string; refresh_token?: string; expires_in: number; token_type: string; scope?: string;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const config = microsoftConfig();
  const data = await microsoftJson<TokenResponse>(
    `https://login.microsoftonline.com/${encodeURIComponent(config.tenant)}/oauth2/v2.0/token`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...body }).toString(),
    });
  if (!data.access_token || !Number.isFinite(data.expires_in) || data.expires_in <= 0) {
    throw new MicrosoftError("Microsoft trả token không hợp lệ.", "invalid_response", 502);
  }
  return data;
}

export function exchangeCodeForToken(code: string, verifier: string): Promise<TokenResponse> {
  return tokenRequest({ grant_type: "authorization_code", code, code_verifier: verifier,
    redirect_uri: microsoftConfig().redirectUri, scope: OAUTH_SCOPES.join(" ") });
}

export function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  return tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken, scope: OAUTH_SCOPES.join(" ") });
}

export async function loadAccountTokens(accountId: number, ownerId: number) {
  const [row] = await db.select({
    enc: accounts.encMsAccessToken, refresh: accounts.encMsRefreshToken,
    expiresAt: accounts.msTokenExpiresAt, clientId: accounts.msClientId, version: accounts.msTokenVersion,
    email: accounts.msEmail, expectedEmail: accounts.encEmail,
  }).from(accounts).where(and(eq(accounts.id, accountId), eq(accounts.ownerUserId, ownerId)));
  if (!row) return null;
  const refreshToken = await decrypt(row.refresh);
  if (!refreshToken) return null;
  return { refreshToken, accessToken: await decrypt(row.enc) ?? "", expiresAt: row.expiresAt ?? 0,
    clientId: row.clientId, version: row.version, email: row.email,
    expectedEmail: await decrypt(row.expectedEmail) };
}

export async function saveAccountTokens(
  accountId: number, ownerId: number, tokens: TokenResponse, expectedVersion: number, msEmail?: string,
): Promise<boolean> {
  const patch = {
    encMsAccessToken: await encrypt(tokens.access_token),
    msTokenExpiresAt: Math.floor(Date.now() / 1000) + Math.max(1, tokens.expires_in - 60),
    msClientId: microsoftConfig().clientId,
    msTokenVersion: sql`${accounts.msTokenVersion} + 1`, updatedAt: new Date(),
    ...(tokens.refresh_token ? { encMsRefreshToken: await encrypt(tokens.refresh_token) } : {}),
    ...(msEmail ? { msEmail } : {}),
  };
  const rows = await db.update(accounts).set(patch).where(and(
    eq(accounts.id, accountId), eq(accounts.ownerUserId, ownerId), eq(accounts.msTokenVersion, expectedVersion),
  )).returning({ id: accounts.id });
  return rows.length === 1;
}

export async function clearAccountTokens(accountId: number, ownerId: number): Promise<void> {
  await db.update(accounts).set({
    encMsRefreshToken: null, encMsAccessToken: null, msTokenExpiresAt: null, msEmail: null,
    msClientId: null, msOAuthNonce: null, msTokenVersion: sql`${accounts.msTokenVersion} + 1`, updatedAt: new Date(),
  }).where(and(eq(accounts.id, accountId), eq(accounts.ownerUserId, ownerId)));
}

// Coalesce per process; a versioned DB write also protects across Worker
// instances and against disconnect/reconnect/email changes during refresh.
const refreshing = new Map<string, Promise<string>>();
export async function getValidAccessToken(accountId: number, ownerId: number, rejectedToken?: string): Promise<string> {
  const tokens = await loadAccountTokens(accountId, ownerId);
  if (!tokens) throw new MicrosoftError("Hãy bấm Get Token để kết nối Hotmail.", "NO_TOKEN", 401);
  if (!tokens.email || tokens.email.trim().toLowerCase() !== tokens.expectedEmail?.trim().toLowerCase()) {
    throw new MicrosoftError("Hộp thư đã lưu chưa khớp email tài khoản. Hãy Get Token lại.", "NO_TOKEN", 401);
  }
  if (tokens.clientId && tokens.clientId !== microsoftConfig().clientId) {
    throw new MicrosoftError("Ứng dụng Microsoft đã thay đổi. Hãy bấm Get Token lại.", "CLIENT_CHANGED", 401);
  }
  const usable = tokens.accessToken && tokens.expiresAt > Math.floor(Date.now() / 1000) + 30;
  if (usable && tokens.accessToken !== rejectedToken) return tokens.accessToken;
  const key = `${ownerId}:${accountId}:${tokens.version}`;
  const existing = refreshing.get(key);
  if (existing) return existing;
  const work = (async () => {
    const next = await refreshAccessToken(tokens.refreshToken);
    if (await saveAccountTokens(accountId, ownerId, next, tokens.version)) return next.access_token;
    const current = await loadAccountTokens(accountId, ownerId);
    if (current?.accessToken && current.expiresAt > Math.floor(Date.now() / 1000) + 30 &&
      (!current.clientId || current.clientId === microsoftConfig().clientId)) return current.accessToken;
    throw new MicrosoftError("Kết nối Hotmail đã thay đổi. Hãy thử lại.", "CONNECTION_CHANGED", 409);
  })();
  refreshing.set(key, work);
  try { return await work; } finally { refreshing.delete(key); }
}

export interface GraphMessage {
  id: string; subject: string; bodyPreview: string;
  from?: { emailAddress?: { address?: string; name?: string } };
  receivedDateTime: string;
  body?: { contentType: string; content: string };
}

export async function fetchRecentMessages(accessToken: string, since: string): Promise<GraphMessage[]> {
  const folders = await Promise.all(["inbox", "junkemail"].map(async folder => {
    const url = new URL(`https://graph.microsoft.com/v1.0/me/mailFolders/${folder}/messages`);
    url.searchParams.set("$top", "25");
    url.searchParams.set("$filter", `receivedDateTime ge ${since}`);
    url.searchParams.set("$orderby", "receivedDateTime desc");
    url.searchParams.set("$select", "id,subject,bodyPreview,from,receivedDateTime,body");
    const data = await microsoftJson<{ value: GraphMessage[] }>(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}`, Prefer: 'outlook.body-content-type="text"' },
    });
    if (!Array.isArray(data.value)) throw new MicrosoftError("Microsoft trả dữ liệu thư không hợp lệ.", "invalid_response", 502);
    return data.value;
  }));
  return folders.flat();
}

// ── Imported-token path ("Token Mail" + "Client ID" from import, e.g. the Thunderbird public
// client). No Azure app / "Get Token" needed: redeem the stored refresh token for a Graph
// access token and read mail the same way. The refresh token rotates, so store the new one.
const TOKEN_ENDPOINT = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const GRAPH_MAIL_SCOPE = "https://graph.microsoft.com/Mail.Read offline_access";
const DEFAULT_MAIL_CLIENT_ID = "9e5f94bc-e8a4-4e73-b8be-63364c29d753"; // Thunderbird public client

/** A Graph access token from an account's imported mail refresh token, or null if it has none. */
export async function mailTokenGraphAccess(accountId: number, ownerId: number): Promise<string | null> {
  const [row] = await db.select({ token: accounts.encMailToken, clientId: accounts.mailClientId })
    .from(accounts).where(and(eq(accounts.id, accountId), eq(accounts.ownerUserId, ownerId)));
  const refreshToken = await decrypt(row?.token);
  if (!refreshToken) return null;
  const clientId = row?.clientId?.trim() || DEFAULT_MAIL_CLIENT_ID;
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, grant_type: "refresh_token", refresh_token: refreshToken, scope: GRAPH_MAIL_SCOPE }),
    signal: AbortSignal.timeout(15000),
  }).catch(() => null);
  const data = (await res?.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; error?: string };
  if (!res?.ok || !data.access_token) {
    throw new MicrosoftError(`Token Mail không dùng được (${data.error ?? res?.status ?? "lỗi"}). Kiểm tra Token Mail / Client ID.`, data.error ?? "mail_token_invalid", 401);
  }
  if (data.refresh_token && data.refresh_token !== refreshToken) {
    await db.update(accounts).set({ encMailToken: await encrypt(data.refresh_token), updatedAt: new Date() })
      .where(and(eq(accounts.id, accountId), eq(accounts.ownerUserId, ownerId)));
  }
  return data.access_token;
}

export async function fetchMeEmail(accessToken: string): Promise<string> {
  const data = await microsoftJson<{ mail?: string; userPrincipalName?: string }>(
    "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", { headers: { Authorization: `Bearer ${accessToken}` } });
  const email = data.mail || data.userPrincipalName;
  if (!email) throw new MicrosoftError("Không xác định được hộp thư Microsoft. Hãy thử kết nối lại.", "MAILBOX_UNKNOWN", 400);
  return email.trim().toLowerCase();
}
