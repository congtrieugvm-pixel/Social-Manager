import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { buildAuthorizeUrl, isAzureConfigured, microsoftConfig } from "@/lib/ms-graph";
import { decrypt } from "@/lib/crypto";
import { getOwnerId } from "@/lib/scope";
import { AuthError, SESSION_COOKIE } from "@/lib/auth";
import { normalizeMailbox, oauthCookieName, oauthResultHtml, OAUTH_COOKIE_PATH,
  OAUTH_TTL_SECONDS, randomOAuthValue, sealOAuthAttempt, sha256 } from "@/lib/ms-oauth";

export async function GET(req: NextRequest) {
  let accountId: number | null = null;
  try {
    const ownerId = await getOwnerId();
    const candidate = Number(new URL(req.url).searchParams.get("accountId"));
    if (!Number.isSafeInteger(candidate) || candidate <= 0) throw new AuthError("Tài khoản không hợp lệ.", 400);
    const [owned] = await db.select({ id: accounts.id, encEmail: accounts.encEmail })
      .from(accounts).where(and(eq(accounts.id, candidate), eq(accounts.ownerUserId, ownerId)));
    if (!owned) throw new AuthError("Không tìm thấy tài khoản.", 404);
    accountId = owned.id;
    const email = normalizeMailbox(await decrypt(owned.encEmail) ?? "");
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new AuthError("Hãy lưu địa chỉ email hợp lệ cho tài khoản trước khi Get Token.", 400);
    }
    if (!isAzureConfigured()) throw new AuthError("Quản trị viên cần cấu hình ứng dụng Microsoft và khóa mã hóa trước khi Get Token. Xem mục Hotmail OAuth2 trong README.", 503);
    const config = microsoftConfig();
    if (new URL(config.redirectUri).origin !== new URL(req.url).origin) {
      throw new AuthError("Địa chỉ callback Microsoft không khớp địa chỉ web đang dùng. Quản trị viên cần kiểm tra AZURE_REDIRECT_URI.", 503);
    }
    const sessionToken = req.cookies.get(SESSION_COOKIE)?.value;
    if (!sessionToken) throw new AuthError("Hãy đăng nhập lại ứng dụng.", 401);
    const nonce = randomOAuthValue();
    const verifier = randomOAuthValue();
    const cookie = await sealOAuthAttempt({ accountId, ownerId, email, nonce, verifier,
      sessionHash: await sha256(sessionToken), clientId: config.clientId, redirectUri: config.redirectUri,
      expiresAt: Math.floor(Date.now() / 1000) + OAUTH_TTL_SECONDS });
    const updated = await db.update(accounts).set({ msOAuthNonce: nonce })
      .where(and(eq(accounts.id, accountId), eq(accounts.ownerUserId, ownerId), eq(accounts.encEmail, owned.encEmail!)))
      .returning({ id: accounts.id });
    if (!updated.length) throw new AuthError("Email vừa thay đổi. Hãy mở lại tài khoản.", 409);
    const response = NextResponse.redirect(buildAuthorizeUrl(nonce, await sha256(verifier), email));
    response.cookies.set(oauthCookieName(nonce)!, cookie, {
      httpOnly: true, sameSite: "lax", secure: new URL(req.url).protocol === "https:",
      path: OAUTH_COOKIE_PATH, maxAge: OAUTH_TTL_SECONDS,
    });
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch (error) {
    return new NextResponse(oauthResultHtml({ ok: false, accountId,
      message: error instanceof AuthError ? error.message : "Chưa tạo được phiên kết nối Microsoft. Hãy thử lại." }), {
      status: error instanceof AuthError ? error.status : 500,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
    });
  }
}
