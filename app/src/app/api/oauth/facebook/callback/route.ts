import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { facebookAccounts } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { encrypt } from "@/lib/crypto";
import {
  buildFbAvatarUrl,
  exchangeLongLivedUserToken,
  fetchMe,
  isFacebookConfigured,
} from "@/lib/facebook";
import { getOwnerId } from "@/lib/scope";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const ownerId = await getOwnerId();
  if (!isFacebookConfigured()) {
    return htmlResponse(
      "Chưa cấu hình FB_APP_ID/FB_APP_SECRET trong .env",
      true,
    );
  }
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error_description") || url.searchParams.get("error");
  if (errorParam) return htmlResponse(errorParam, true);
  if (!code) return htmlResponse("Thiếu code từ Facebook", true);

  let linkTo: number | null = null;
  if (stateRaw) {
    try {
      const state = JSON.parse(decodeURIComponent(stateRaw));
      if (typeof state.linkTo === "number" && Number.isFinite(state.linkTo)) {
        linkTo = state.linkTo;
      }
    } catch {
      // ignore
    }
  }

  const appId = process.env.FB_APP_ID!;
  const appSecret = process.env.FB_APP_SECRET!;
  const redirectUri = `${url.origin}/api/oauth/facebook/callback`;

  // Step 1: code → short-lived user token
  const tokenUrl =
    `https://graph.facebook.com/v21.0/oauth/access_token` +
    `?client_id=${encodeURIComponent(appId)}` +
    `&client_secret=${encodeURIComponent(appSecret)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&code=${encodeURIComponent(code)}`;
  const tokRes = await fetch(tokenUrl, { cache: "no-store" });
  const tokData = await tokRes.json();
  if (!tokRes.ok) {
    return htmlResponse(
      tokData?.error?.message ?? `Token exchange failed ${tokRes.status}`,
      true,
    );
  }
  const shortToken = tokData.access_token as string;

  // Step 2: short → long-lived (~60d)
  let longToken = shortToken;
  let expiresIn: number | null = null;
  try {
    const ll = await exchangeLongLivedUserToken(shortToken);
    longToken = ll.accessToken;
    expiresIn = ll.expiresIn;
  } catch {
    // fall through with short token
  }

  // Step 3: fetch /me for id + name
  let me;
  try {
    me = await fetchMe(longToken);
  } catch (e) {
    return htmlResponse(
      `Không đọc được /me: ${e instanceof Error ? e.message : String(e)}`,
      true,
    );
  }

  const now = new Date();
  const tokenExpiresAt =
    expiresIn != null ? Math.floor(Date.now() / 1000) + expiresIn : null;
  const encToken = await encrypt(longToken);
  // Avatar: derive from UID (stable redirector). Don't read me.picture.
  const picUrl = buildFbAvatarUrl(me.id);

  // If user specified linkTo, update that row. Else find by fbUserId, else insert new.
  let targetId: number | null = null;
  if (linkTo) {
    const [row] = await db
      .select({ id: facebookAccounts.id })
      .from(facebookAccounts)
      .where(
        and(
          eq(facebookAccounts.id, linkTo),
          eq(facebookAccounts.ownerUserId, ownerId),
        ),
      );
    if (row) targetId = row.id;
  }
  if (!targetId) {
    const [row] = await db
      .select({ id: facebookAccounts.id })
      .from(facebookAccounts)
      .where(
        and(
          eq(facebookAccounts.fbUserId, me.id),
          eq(facebookAccounts.ownerUserId, ownerId),
        ),
      );
    if (row) targetId = row.id;
  }

  if (targetId) {
    await db
      .update(facebookAccounts)
      .set({
        encAccessToken: encToken,
        tokenExpiresAt,
        fbUserId: me.id,
        fbName: me.name,
        fbProfilePic: picUrl,
        lastSyncedAt: now,
        lastSyncError: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(facebookAccounts.id, targetId),
          eq(facebookAccounts.ownerUserId, ownerId),
        ),
      );
  } else {
    // Insert a new account using fb user id as fallback username (unique constraint safe).
    const fallbackUsername = `fb_${me.id}`;
    const [row] = await db
      .insert(facebookAccounts)
      .values({
        ownerUserId: ownerId,
        username: fallbackUsername,
        encPassword: await encrypt(""),
        encEmail: await encrypt(""),
        enc2fa: await encrypt(""),
        encEmailPassword: await encrypt(""),
        encAccessToken: encToken,
        tokenExpiresAt,
        fbUserId: me.id,
        fbName: me.name,
        fbProfilePic: picUrl,
        lastSyncedAt: now,
      })
      .returning({ id: facebookAccounts.id });
    targetId = row.id;
  }

  return htmlResponse(
    `Đã lưu token cho ${me.name} (fb_id=${me.id})`,
    false,
    targetId,
  );
}

function htmlResponse(message: string, isError: boolean, accountId?: number | null) {
  const color = isError ? "#c2410c" : "#15803d";
  const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Facebook OAuth</title></head>
<body style="font-family: system-ui, sans-serif; padding: 48px; max-width: 520px; margin: 0 auto;">
  <h1 style="color:${color}; font-size: 20px;">${
    isError ? "Lỗi OAuth" : "Kết nối Facebook thành công"
  }</h1>
  <p style="color:#334;">${escapeHtml(message)}</p>
  <div style="margin-top:24px; display:flex; gap:8px;">
    <a href="/facebook" style="padding:8px 14px; border:1px solid #ccc; border-radius:6px; text-decoration:none; color:#111;">Về danh sách tài khoản</a>
    <a href="/fanpage" style="padding:8px 14px; background:#111; color:#fff; border-radius:6px; text-decoration:none;">Sang Fanpage</a>
  </div>
  ${
    !isError && accountId
      ? `<script>
  try { window.opener && window.opener.postMessage({ type: "fb-oauth-done", accountId: ${accountId} }, "*"); } catch(e) {}
</script>`
      : ""
  }
</body>
</html>`;
  return new NextResponse(html, {
    status: isError ? 400 : 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
