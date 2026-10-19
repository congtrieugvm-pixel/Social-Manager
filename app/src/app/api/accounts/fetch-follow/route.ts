import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { fetchProfile } from "@/lib/tiktok";
import { processAccount, runBulk } from "@/lib/tiktok-bulk";

export const runtime = "nodejs";

// POST { ids } (≤ 5) → follower / following / avatar, plus the video count
// when the data came from the profile page (the embed page never has it —
// then the stored value is kept instead of zeroed).
export async function POST(req: Request) {
  return runBulk(req, (id, username) =>
    processAccount(id, username, async () => {
      const profile = await fetchProfile(username);
      await db
        .update(accounts)
        .set({
          followerCount: profile.followerCount,
          followingCount: profile.followingCount,
          ...(profile.videoCount !== null ? { videoCount: profile.videoCount } : {}),
          ...(profile.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
          lastSyncedAt: new Date(),
          lastSyncError: null,
          updatedAt: new Date(),
        })
        .where(eq(accounts.id, id));
      return { follower: profile.followerCount, following: profile.followingCount, videoCount: profile.videoCount };
    }),
  );
}
