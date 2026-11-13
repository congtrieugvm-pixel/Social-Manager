import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { AuthError, SESSION_COOKIE } from "@/lib/auth";
import { getOwnerId } from "@/lib/scope";
import { exchangeCodeForToken, fetchMeEmail, microsoftConfig, saveAccountTokens } from "@/lib/ms-graph";
import { MicrosoftError } from "@/lib/ms-http";
import { decrypt } from "@/lib/crypto";
import { normalizeMailbox, oauthCookieName, oauthResultHtml, OAUTH_COOKIE_PATH, readOAuthAttempt } from "@/lib/ms-oauth";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const nonce = url.searchParams.get("state") ?? "";
  const cookieName = oauthCookieName(nonce);
  let accountId: number | null = null;
  let ok = false;
  let email: string | undefined;
  let message = "Phiên kết nối không hợp lệ. Hãy bấm Get Token lại.";
  let status = 400;
  try {
    const ownerId = await getOwnerId();
    const attempt = await readOAuthAttempt(cookieName ? req.cookies.get(cookieName)?.value : undefined,
      nonce, ownerId, req.cookies.get(SESSION_COOKIE)?.value ?? "");
    accountId = attempt.accountId;
    // Atomic consumption makes the OAuth attempt single-use across Workers.
    const [claimed] = await db.update(accounts).set({ msOAuthNonce: null,
      msTokenVersion: sql`${accounts.msTokenVersion} + 1` }).where(and(
      eq(accounts.id, accountId), eq(accounts.ownerUserId, ownerId), eq(accounts.msOAuthNonce, nonce),
    )).returning({ encEmail: accounts.encEmail, version: accounts.msTokenVersion });
    if (!claimed) throw new AuthError("Phiên kết nối đã dùng hoặc tài khoản đã thay đổi. Hãy Get Token lại.", 409);
    if (normalizeMailbox(await decrypt(claimed.encEmail) ?? "") !== attempt.email) {
      throw new AuthError("Email tài khoản đã thay đổi. Hãy Get Token lại.", 409);
    }
    const config = microsoftConfig();
    if (attempt.clientId !== config.clientId || attempt.redirectUri !== config.redirectUri) {
      throw new AuthError("Cấu hình Microsoft vừa thay đổi. Hãy Get Token lại.", 409);
    }
    if (url.searchParams.has("error")) {
      throw new AuthError(url.searchParams.get("error") === "access_denied"
        ? "Bạn đã hủy đăng nhập hoặc chưa cấp quyền đọc thư. Có thể bấm Get Token để thử lại."
        : "Microsoft chưa hoàn tất đăng nhập. Hãy bấm Get Token để thử lại.", 400);
    }
    const code = url.searchParams.get("code");
    if (!code) throw new AuthError("Microsoft chưa trả mã cấp quyền. Hãy thử lại.", 400);
    const tokens = await exchangeCodeForToken(code, attempt.verifier);
    if (!tokens.refresh_token) throw new AuthError("Microsoft chưa cấp quyền truy cập lâu dài. Hãy kết nối lại và cấp quyền offline_access.", 400);
    email = await fetchMeEmail(tokens.access_token);
    if (normalizeMailbox(email) !== attempt.email) {
      // Alias mailboxes need an explicitly verified mapping; never silently
      // attach tokens from an unrelated Microsoft account.
      throw new AuthError("Hộp thư vừa đăng nhập không khớp email tài khoản. Hãy chọn đúng Hotmail rồi Get Token lại.", 400);
    }
    if (!await saveAccountTokens(accountId, ownerId, tokens, claimed.version, email)) {
      throw new AuthError("Kết nối vừa thay đổi trong lúc đăng nhập. Hãy Get Token lại.", 409);
    }
    ok = true;
    status = 200;
    message = `Đã lưu token cho ${email}. Những lần Get Code sau hệ thống sẽ tự sử dụng và gia hạn token.`;
  } catch (error) {
    if (error instanceof AuthError || error instanceof MicrosoftError) {
      message = error.message;
      status = error.status >= 400 && error.status <= 599 ? error.status : 500;
    }
  }
  const response = new NextResponse(oauthResultHtml({ ok, message, accountId, ...(ok ? { email } : {}) }), {
    status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" },
  });
  if (cookieName) response.cookies.set(cookieName, "", {
    httpOnly: true, sameSite: "lax", secure: url.protocol === "https:", path: OAUTH_COOKIE_PATH, maxAge: 0,
  });
  return response;
}
