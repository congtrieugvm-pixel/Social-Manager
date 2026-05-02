import { fetchRecentVideos } from "../src/lib/tiktok";

const USERNAMES = ["khaby.lame", "mrbeast", "sajenpsoznl"];

async function main() {
  for (const u of USERNAMES) {
    console.log(`\n=== @${u} ===`);
    try {
      const videos = await fetchRecentVideos(u, 3);
      console.log(`count=${videos.length}`);
      videos.forEach((v, i) => {
        console.log(
          `  [${i + 1}] id=${v.id} views=${v.viewCount} likes=${v.likeCount} cover=${v.coverUrl ? "YES" : "NO"} caption="${(v.caption || "").slice(0, 40)}"`
        );
      });
    } catch (e) {
      console.log(`ERROR: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
