import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { TikTokError, fetchProfile } from "@/lib/tiktok";
import { processAccount, runBulk } from "@/lib/tiktok-bulk";

export const runtime = "nodejs";

// POST { ids } (≤ 5) → refresh the stored avatar URL.
export async function POST(req: Request) {
  return runBulk(req, (id, username) =>
    processAccount(id, username, async () => {
      const profile = await fetchProfile(username);
      if (!profile.avatarUrl) throw new TikTokError("TikTok không trả avatar", true);
      await db
        .update(accounts)
        .set({
          avatarUrl: profile.avatarUrl,
          lastSyncedAt: new Date(),
          lastSyncError: null,
          updatedAt: new Date(),
        })
        .where(eq(accounts.id, id));
      return { avatarUrl: profile.avatarUrl };
    }),
  );
}
