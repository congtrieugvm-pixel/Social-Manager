// TikTok avatar URLs are signed CDN links that expire after a few days (x-expires), so the
// accounts table keeps a copy of the small image itself (a data URL, a few KB) and the UI loads
// it from /api/accounts/{id}/avatar. Nothing here ever exposes the expiring CDN link to the UI.

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";

const MAX_BYTES = 200_000;
export const RETRY_AFTER_S = 6 * 3600; // after a failed refresh, wait before asking TikTok again

/** Epoch seconds the signed TikTok link stops working, or null when it has no expiry. */
export function avatarExpiresAt(url: string | null | undefined): number | null {
  const m = url?.match(/[?&]x-expires=(\d{9,11})/);
  return m ? Number(m[1]) : null;
}

/** Download an avatar and return it as a data URL, or null if it can't be fetched. */
export async function downloadAvatar(url: string): Promise<string | null> {
  if (!/^https:\/\//.test(url)) return null;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { Accept: "image/*" } }).catch(() => null);
  if (!res?.ok) return null;
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!/^image\/(jpeg|png|webp|gif|avif)$/.test(type)) return null;
  const bytes = new Uint8Array(await res.arrayBuffer().catch(() => new ArrayBuffer(0)));
  if (!bytes.length || bytes.length > MAX_BYTES) return null;
  return `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
}

/** Store a freshly fetched avatar URL and, when it downloads, the image itself. */
export async function saveAvatar(id: number, url: string): Promise<boolean> {
  const data = await downloadAvatar(url);
  const now = Math.floor(Date.now() / 1000);
  await db.update(accounts)
    .set({ avatarUrl: url, ...(data ? { avatarData: data, avatarCachedAt: now } : {}) })
    .where(eq(accounts.id, id));
  return !!data;
}

/** What the UI should load for an account's avatar: our cached copy, or nothing. */
export function avatarSrc(r: { id: number; avatarUrl: string | null; avatarCachedAt: number | null }): string | null {
  if (r.avatarCachedAt && r.avatarCachedAt > 0) return `/api/accounts/${r.id}/avatar?v=${r.avatarCachedAt}`;
  // Not cached yet: the endpoint fetches and caches it on first view (self-healing).
  if (r.avatarUrl) return `/api/accounts/${r.id}/avatar?v=0`;
  return null;
}
