import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { fetchRecentVideos } from "@/lib/tiktok";
import { processAccount, runBulk } from "@/lib/tiktok-bulk";

export const runtime = "nodejs";

const VIDEO_LIMIT = 3;

// POST { ids } (≤ 5) → the 3 latest public videos. A private account or one
// without public videos is a success with 0 videos.
export async function POST(req: Request) {
  return runBulk(req, (id, username) =>
    processAccount(id, username, async () => {
      const videos = await fetchRecentVideos(username, VIDEO_LIMIT);
      await db
        .update(accounts)
        .set({
          lastVideos: JSON.stringify(videos),
          lastSyncedAt: new Date(),
          lastSyncError: null,
          updatedAt: new Date(),
        })
        .where(eq(accounts.id, id));
      return { count: videos.length, videos };
    }),
  );
}
