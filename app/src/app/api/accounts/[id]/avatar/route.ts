import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { getOwnerId } from "@/lib/scope";
import { AuthError } from "@/lib/auth";
import { fetchProfile } from "@/lib/tiktok";
import { avatarExpiresAt, downloadAvatar, RETRY_AFTER_S } from "@/lib/avatar-cache";

// GET → the account's avatar image, served from our own copy so it never expires.
// First view of an account without a copy fetches it (from the stored link if still valid,
// otherwise a fresh link from TikTok) and caches it. Failures back off for RETRY_AFTER_S.
const notFound = () => new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });

function serve(dataUrl: string) {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!m) return notFound();
  return new Response(Buffer.from(m[2], "base64"), {
    headers: { "Content-Type": m[1], "Cache-Control": "private, max-age=31536000, immutable" },
  });
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const ownerId = await getOwnerId();
    const id = Number((await ctx.params).id);
    if (!Number.isSafeInteger(id) || id <= 0) return notFound();
    const [row] = await db
      .select({ username: accounts.username, avatarUrl: accounts.avatarUrl, avatarData: accounts.avatarData, avatarCachedAt: accounts.avatarCachedAt })
      .from(accounts)
      .where(and(eq(accounts.id, id), eq(accounts.ownerUserId, ownerId)));
    if (!row) return notFound();
    if (row.avatarData) return serve(row.avatarData);

    const now = Math.floor(Date.now() / 1000);
    if (row.avatarCachedAt && row.avatarCachedAt < 0 && now + row.avatarCachedAt < RETRY_AFTER_S) return notFound();

    let url = row.avatarUrl;
    let data: string | null = null;
    const exp = avatarExpiresAt(url);
    if (url && (exp === null || exp > now + 60)) data = await downloadAvatar(url);
    if (!data) {
      // Stored link expired or dead: ask TikTok for a fresh one.
      const profile = await fetchProfile(row.username).catch(() => null);
      url = profile?.avatarUrl || url;
      if (profile?.avatarUrl) data = await downloadAvatar(profile.avatarUrl);
    }
    if (!data) {
      await db.update(accounts).set({ avatarCachedAt: -now }).where(eq(accounts.id, id));
      return notFound();
    }
    await db.update(accounts).set({ avatarUrl: url, avatarData: data, avatarCachedAt: now }).where(eq(accounts.id, id));
    return serve(data);
  } catch (e) {
    if (e instanceof AuthError) return new Response(null, { status: e.status });
    return notFound();
  }
}
