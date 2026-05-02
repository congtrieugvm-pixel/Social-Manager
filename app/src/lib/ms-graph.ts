import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { decrypt, encrypt } from "@/lib/crypto";

const TENANT = process.env.AZURE_TENANT || "common";
const CLIENT_ID = process.env.AZURE_CLIENT_ID || "";
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET || "";
const REDIRECT_URI =
  process.env.AZURE_REDIRECT_URI ||
  "http://localhost:3000/api/oauth/microsoft/callback";

export const OAUTH_SCOPES = [
  "offline_access",
  "https://graph.microsoft.com/Mail.Read",
  "https://graph.microsoft.com/User.Read",
];

export function isAzureConfigured(): boolean {
  return Boolean(CLIENT_ID && CLIENT_SECRET);
}

export function buildAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    response_mode: "query",
    scope: OAUTH_SCOPES.join(" "),
    state,
    prompt: "select_account",
  });
  return `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(
    `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        ...body,
      }).toString(),
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      (data && (data.error_description || data.error)) ||
      `Token exchange failed HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as TokenResponse;
}

export async function exchangeCodeForToken(code: string): Promise<TokenResponse> {
  return tokenRequest({
    grant_type: "authorization_code",
    code,
    scope: OAUTH_SCOPES.join(" "),
  });
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  return tokenRequest({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: OAUTH_SCOPES.join(" "),
  });
}

export interface MsAccountTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export async function loadAccountTokens(
  accountId: number,
): Promise<MsAccountTokens | null> {
  const [row] = await db
    .select({
      enc: accounts.encMsAccessToken,
      refresh: accounts.encMsRefreshToken,
      expiresAt: accounts.msTokenExpiresAt,
    })
    .from(accounts)
    .where(eq(accounts.id, accountId));
  if (!row) return null;
  const refreshToken = await decrypt(row.refresh);
  if (!refreshToken) return null;
  const accessToken = await decrypt(row.enc) ?? "";
  return {
    refreshToken,
    accessToken,
    expiresAt: row.expiresAt ?? 0,
  };
}

export async function saveAccountTokens(
  accountId: number,
  tokens: TokenResponse,
  msEmail?: string | null,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + Math.max(60, tokens.expires_in - 60);
  const patch: Partial<typeof accounts.$inferInsert> = {
    encMsAccessToken: await encrypt(tokens.access_token),
    msTokenExpiresAt: expiresAt,
    updatedAt: new Date(),
  };
  if (tokens.refresh_token) {
    patch.encMsRefreshToken = await encrypt(tokens.refresh_token);
  }
  if (msEmail !== undefined && msEmail !== null) {
    patch.msEmail = msEmail;
  }
  await db.update(accounts).set(patch).where(eq(accounts.id, accountId));
}

export async function clearAccountTokens(accountId: number): Promise<void> {
  await db
    .update(accounts)
    .set({
      encMsRefreshToken: null,
      encMsAccessToken: null,
      msTokenExpiresAt: null,
      msEmail: null,
      updatedAt: new Date(),
    })
    .where(eq(accounts.id, accountId));
}

/**
 * Returns a usable access token for the given account, refreshing if needed.
 * Throws if no refresh token is stored.
 */
export async function getValidAccessToken(accountId: number): Promise<string> {
  const tokens = await loadAccountTokens(accountId);
  if (!tokens) throw new Error("NO_TOKEN");
  const now = Math.floor(Date.now() / 1000);
  if (tokens.accessToken && tokens.expiresAt > now + 30) {
    return tokens.accessToken;
  }
  const refreshed = await refreshAccessToken(tokens.refreshToken);
  await saveAccountTokens(accountId, refreshed);
  return refreshed.access_token;
}

export interface GraphMessage {
  id: string;
  subject: string;
  bodyPreview: string;
  from?: { emailAddress?: { address?: string; name?: string } };
  receivedDateTime: string;
  body?: { contentType: string; content: string };
}

export async function fetchRecentMessages(
  accessToken: string,
  top = 15,
): Promise<GraphMessage[]> {
  const url = new URL("https://graph.microsoft.com/v1.0/me/messages");
  url.searchParams.set("$top", String(top));
  url.searchParams.set("$orderby", "receivedDateTime desc");
  url.searchParams.set(
    "$select",
    "id,subject,bodyPreview,from,receivedDateTime,body",
  );
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Graph /me/messages HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { value?: GraphMessage[] };
  return data.value ?? [];
}

export async function fetchMeEmail(accessToken: string): Promise<string | null> {
  const res = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { mail?: string; userPrincipalName?: string };
  return data.mail || data.userPrincipalName || null;
}
