import { writeFileSync } from "fs";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36";

async function main() {
  const u = process.argv[2] || "mrbeast";
  const res = await fetch(`https://www.tiktok.com/embed/@${u}`, {
    headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
  });
  const html = await res.text();
  console.log("status:", res.status, "len:", html.length);

  const m = html.match(
    /<script[^>]*id="__FRONTITY_CONNECT_STATE__"[^>]*>([\s\S]*?)<\/script>/,
  );
  if (!m) {
    console.log("no state");
    return;
  }
  const state = JSON.parse(m[1]);
  // Dump 'source' and nearby
  writeFileSync("probe-state.json", JSON.stringify(state, null, 2));
  const source = state.source;
  console.log("source.url:", source.url);
  console.log("source.category:", source.category);
  console.log("source.author keys:", Object.keys(source.author ?? {}).slice(0, 15));
  console.log("source.post keys:", Object.keys(source.post ?? {}).slice(0, 15));
  console.log("source.data keys:", Object.keys(source.data ?? {}).slice(0, 20));

  // Common shape for user profile embed: source.data[<slug>] holds the profile or videos
  const dataKeys = Object.keys(source.data ?? {});
  for (const k of dataKeys) {
    const v = source.data[k];
    if (v && typeof v === "object") {
      console.log(`  data[${k}] keys:`, Object.keys(v).slice(0, 15));
    }
  }

  // Look for arrays with video-ish shape
  function walk(node: unknown, path: string, depth: number) {
    if (depth > 6) return;
    if (Array.isArray(node)) {
      if (node.length > 0 && typeof node[0] === "object" && node[0] !== null) {
        const firstKeys = Object.keys(node[0]).slice(0, 20);
        if (firstKeys.some((k) => /video|play|cover|aweme|item|desc|stats/i.test(k))) {
          console.log(`[array at ${path}] len=${node.length} sample keys:`, firstKeys);
        }
      }
      return;
    }
    if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        walk(v, `${path}.${k}`, depth + 1);
      }
    }
  }
  walk(state, "state", 0);
}

main().catch(console.error);
