import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { clearAccountTokens, fetchRecentMessages, getValidAccessToken, isAzureConfigured, loadAccountTokens } from "@/lib/ms-graph";
import { MicrosoftError, requiresMicrosoftAuth } from "@/lib/ms-http";
import { OTP_MAX_AGE_MS, pickLatestOtp } from "@/lib/otp-extract";
import { getOwnerId } from "@/lib/scope";
import { AuthError } from "@/lib/auth";
import { readBody } from "@/lib/req-body";

const noStore = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200, extraHeaders = {}) => NextResponse.json(body, {
  status, headers: { ...noStore, ...extraHeaders },
});

async function ownedAccount(idString: string) {
  const ownerId = await getOwnerId();
  const id = Number(idString);
  if (!Number.isSafeInteger(id) || id <= 0) throw new AuthError("ID không hợp lệ.", 400);
  const [row] = await db.select({ id: accounts.id, version: accounts.msTokenVersion })
    .from(accounts).where(and(eq(accounts.id, id), eq(accounts.ownerUserId, ownerId)));
  if (!row) throw new AuthError("Không tìm thấy tài khoản.", 404);
  return { id, ownerId, version: row.version };
}

function errorResponse(error: unknown) {
  if (error instanceof AuthError) return json({ error: error.message }, error.status);
  if (error instanceof MicrosoftError) {
    const retryable = error.status === 429 || error.status >= 500 &&
      !["invalid_client", "unauthorized_client", "invalid_scope", "invalid_resource"].includes(error.code);
    const retryAfterSeconds = error.retryAfterSeconds || 3;
    return json({ error: error.message, ...(retryable ? { retryable: true, retryAfterSeconds } : {}) },
      error.status >= 400 && error.status <= 599 ? error.status : 502,
      retryable ? { "Retry-After": String(retryAfterSeconds) } : {});
  }
  return json({ error: "Chưa lấy được mã Hotmail. Hãy thử lại." }, 500);
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id, ownerId } = await ownedAccount((await ctx.params).id);
    await clearAccountTokens(id, ownerId);
    return json({ ok: true });
  } catch (error) { return errorResponse(error); }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  let accountId: number | null = null;
  try {
    const { id, ownerId } = await ownedAccount((await ctx.params).id);
    accountId = id;
    if (!isAzureConfigured()) return json({ error: "Quản trị viên cần cấu hình ứng dụng Microsoft trước khi lấy mã. Xem mục Hotmail OAuth2 trong README." }, 503);
    const body = await readBody<{ afterMessageId?: unknown; afterReceivedAt?: unknown }>(req);
    const afterMessageId = typeof body?.afterMessageId === "string" ? body.afterMessageId.slice(0, 2048) : undefined;
    const afterReceivedAt = typeof body?.afterReceivedAt === "string" ? Date.parse(body.afterReceivedAt) : undefined;
    if (afterReceivedAt !== undefined && (!Number.isFinite(afterReceivedAt) || afterReceivedAt > Date.now() + 30_000)) {
      return json({ error: "Mốc thời gian mã trước không hợp lệ." }, 400);
    }
    const since = new Date(Math.max(Date.now() - OTP_MAX_AGE_MS, afterReceivedAt ?? 0)).toISOString();
    let accessToken = await getValidAccessToken(id, ownerId);
    let messages;
    try { messages = await fetchRecentMessages(accessToken, since); }
    catch (error) {
      if (!(error instanceof MicrosoftError) || error.status !== 401) throw error;
      // A rejected access token does not imply a revoked refresh token.
      accessToken = await getValidAccessToken(id, ownerId, accessToken);
      messages = await fetchRecentMessages(accessToken, since);
    }
    // Do not return a code after disconnect, transfer, or a mailbox change.
    const currentTokens = await loadAccountTokens(id, ownerId);
    if (currentTokens?.accessToken !== accessToken) {
      throw new MicrosoftError("Kết nối vừa thay đổi. Hãy thử lấy mã lại.", "CONNECTION_CHANGED", 409);
    }
    const match = pickLatestOtp(messages, { afterMessageId, afterReceivedAt });
    if (!match) return json({ pending: true, retryAfterSeconds: 3 }, 202);
    return json({ code: match.code, messageId: match.messageId, subject: match.subject,
      from: match.fromAddress, receivedAt: match.receivedAt });
  } catch (error) {
    if (accountId && requiresMicrosoftAuth(error)) {
      // Preserve credentials on errors; disconnect is an explicit user action.
      return json({ needsAuth: true, error: (error as Error).message,
        authUrl: `/api/oauth/microsoft/start?accountId=${accountId}` });
    }
    return errorResponse(error);
  }
}
