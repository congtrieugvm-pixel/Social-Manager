import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { TikTokError, fetchProfile } from "@/lib/tiktok";
import { processAccount, runBulk } from "@/lib/tiktok-bulk";
import { saveAvatar } from "@/lib/avatar-cache";

export const runtime = "nodejs";

// POST { ids } (≤ 5) → refresh the stored avatar URL.
export async function POST(req: Request) {
  return runBulk(req, (id, username) =>
    processAccount(id, username, async () => {
      const profile = await fetchProfile(username);
      if (!profile.avatarUrl) throw new TikTokError("TikTok không trả avatar", true);
      await db
        .update(accounts)
        .set({ lastSyncedAt: new Date(), lastSyncError: null, updatedAt: new Date() })
        .where(eq(accounts.id, id));
      // Keep our own copy of the image: the CDN link expires in a few days.
      const cached = await saveAvatar(id, profile.avatarUrl);
      return { avatarUrl: `/api/accounts/${id}/avatar?v=${cached ? Math.floor(Date.now() / 1000) : 0}` };
    }),
  );
}
