const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36";

async function main() {
  const u = "mrbeast";
  const url = `https://www.tiktok.com/embed/@${u}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
  });
  const html = await res.text();
  console.log("status:", res.status, "len:", html.length);

  // Look for known JSON script tags
  const scriptTags = [
    "__UNIVERSAL_DATA_FOR_REHYDRATION__",
    "__NEXT_DATA__",
    "SIGI_STATE",
    "__FRONTITY_CONNECT_STATE__",
  ];
  for (const tag of scriptTags) {
    const re = new RegExp(
      `<script[^>]*id="${tag}"[^>]*>([\\s\\S]*?)<\\/script>`,
    );
    const m = html.match(re);
    if (m) {
      console.log(`\n--- found ${tag}, len=${m[1].length}`);
      try {
        const j = JSON.parse(m[1]);
        console.log("top keys:", Object.keys(j).slice(0, 10));
        // Walk 2 levels
        for (const k of Object.keys(j).slice(0, 10)) {
          const v = (j as Record<string, unknown>)[k];
          if (v && typeof v === "object") {
            console.log(`  ${k} keys:`, Object.keys(v).slice(0, 10));
          }
        }
      } catch (e) {
        console.log("parse err:", e instanceof Error ? e.message : e);
      }
    } else {
      console.log(`no ${tag}`);
    }
  }

  // Search for "videoList", "itemInfo", "videos", "uniqueId"
  for (const kw of ["videoList", "itemInfo", '"videos"', "awemeList", "postList", "statsV2", "playAddr"]) {
    const idx = html.indexOf(kw);
    if (idx >= 0) {
      console.log(`\nkw ${kw} @ ${idx}:`, html.slice(idx, idx + 300).replace(/\n/g, " "));
    }
  }
}

main().catch(console.error);
