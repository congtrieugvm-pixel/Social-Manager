import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { facebookAccounts } from "@/lib/db/schema";
import { and, inArray, eq } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { getOwnerId } from "@/lib/scope";
import {
  buildFbAvatarUrl,
  debugUserToken,
  fetchMe,
  isFacebookConfigured,
  type FbDebugTokenInfo,
} from "@/lib/facebook";
import { readBody } from "@/lib/req-body";

export const runtime = "nodejs";

interface ItemResult {
  id: number;
  username: string;
  ok: boolean;
  // /me result
  fbUserId?: string;
  fbName?: string;
  fbProfilePic?: string;
  meError?: string;
  // /debug_token result
  tokenValid?: boolean;
  expiresAt?: number | null;
  dataAccessExpiresAt?: number | null;
  scopes?: string[];
  debugError?: string;
  /** Aggregate top-level error when token cannot even be loaded. */
  error?: string;
}

async function processOne(
  id: number,
  username: string,
  encToken: string | null,
): Promise<ItemResult> {
  const token = await decrypt(encToken);
  if (!token) {
    const now = new Date();
    await db
      .update(facebookAccounts)
      .set({
        lastSyncError: "Chưa có access token",
        lastSyncedAt: now,
        updatedAt: now,
      })
      .where(eq(facebookAccounts.id, id));
    return { id, username, ok: false, error: "Chưa có access token" };
  }

  const result: ItemResult = { id, username, ok: false };

  // /me — refresh fbName/fbUserId. Avatar URL is derived from the UID via
  // `buildFbAvatarUrl()`, NOT taken from /me's `picture` response (the latter
  // is a signed CDN URL that expires within days).
  let avatarUrl: string | null = null;
  try {
    const me = await fetchMe(token);
    result.fbUserId = me.id;
    result.fbName = me.name;
    avatarUrl = buildFbAvatarUrl(me.id);
    result.fbProfilePic = avatarUrl;
  } catch (e) {
    result.meError = e instanceof Error ? e.message : String(e);
  }

  // /debug_token — only if FB app credentials configured. Optional.
  let debug: FbDebugTokenInfo | null = null;
  if (isFacebookConfigured()) {
    try {
      debug = await debugUserToken(token);
      result.tokenValid = !!debug.is_valid;
      result.expiresAt = debug.expires_at ?? null;
      result.dataAccessExpiresAt = debug.data_access_expires_at ?? null;
      result.scopes = debug.scopes ?? [];
    } catch (e) {
      result.debugError = e instanceof Error ? e.message : String(e);
    }
  }

  // Persist whatever we managed to fetch.
  const now = new Date();
  const patch: Record<string, unknown> = {
    lastSyncedAt: now,
    updatedAt: now,
  };
  if (result.fbUserId) patch.fbUserId = result.fbUserId;
  if (result.fbName) patch.fbName = result.fbName;
  if (avatarUrl) patch.fbProfilePic = avatarUrl;
  if (typeof result.expiresAt === "number") patch.tokenExpiresAt = result.expiresAt;

  // Bubble error up to lastSyncError if anything failed; otherwise clear it.
  const errs: string[] = [];
  if (result.meError) errs.push(`/me: ${result.meError}`);
  if (debug && !debug.is_valid) {
    const reason = debug.error?.message ?? "token không hợp lệ";
    errs.push(`token: ${reason}`);
  }
  if (result.debugError) errs.push(`debug_token: ${result.debugError}`);
  patch.lastSyncError = errs.length > 0 ? errs.join(" | ") : null;

  await db
    .update(facebookAccounts)
    .set(patch)
    .where(eq(facebookAccounts.id, id));

  // ok if we got at least one piece of fresh info AND no fatal /me failure
  result.ok = !result.meError && (result.tokenValid !== false);
  if (!result.ok && errs.length > 0) result.error = errs.join(" | ");
  return result;
}

export async function POST(req: Request) {
  const ownerId = await getOwnerId();
  let ids: number[] = [];
  try {
    const body = await readBody<{ ids?: number[] }>(req);
    ids = (body.ids ?? []).filter(
      (n): n is number => typeof n === "number" && Number.isFinite(n),
    );
  } catch {
    // fallthrough
  }
  if (ids.length === 0) {
    return NextResponse.json(
      { error: "Thiếu danh sách tài khoản" },
      { status: 400 },
    );
  }

  const rows = await db
    .select({
      id: facebookAccounts.id,
      username: facebookAccounts.username,
      encAccessToken: facebookAccounts.encAccessToken,
    })
    .from(facebookAccounts)
    .where(
      and(
        inArray(facebookAccounts.id, ids),
        eq(facebookAccounts.ownerUserId, ownerId),
      ),
    );

  const results: ItemResult[] = [];
  // Sequential to be polite to Graph + simpler error attribution.
  for (const r of rows) {
    results.push(await processOne(r.id, r.username, r.encAccessToken));
  }

  return NextResponse.json({
    total: results.length,
    success: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    debugTokenAvailable: isFacebookConfigured(),
    results,
  });
}
