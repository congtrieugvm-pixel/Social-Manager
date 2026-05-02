const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36";

async function fetchList(username: string) {
  console.log(`\n=== @${username} ===`);
  try {
    const res = await fetch(`https://www.tiktok.com/embed/@${username}`, {
      headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
    });
    const html = await res.text();
    console.log("status:", res.status, "len:", html.length);
    const m = html.match(
      /<script[^>]*id="__FRONTITY_CONNECT_STATE__"[^>]*>([\s\S]*?)<\/script>/,
    );
    if (!m) return console.log("no state");
    const state = JSON.parse(m[1]);
    const dataKey = `/embed/@${username}`;
    const data = state?.source?.data?.[dataKey];
    if (!data) {
      console.log("no data, keys:", Object.keys(state?.source?.data ?? {}));
      return;
    }
    console.log("userInfo keys:", Object.keys(data.userInfo ?? {}));
    const vl = data.videoList as unknown[];
    console.log("videoList.len:", vl?.length);
    if (vl && vl.length > 0) {
      console.log("first video keys:", Object.keys(vl[0] as object));
      console.log("first video sample:", JSON.stringify(vl[0], null, 2).slice(0, 1200));
    }
  } catch (e) {
    console.log("ERR:", e instanceof Error ? e.message : e);
  }
}

async function main() {
  for (const u of ["mrbeast", "khaby.lame", "sajenpsoznl", "thisisbillgates"]) {
    await fetchList(u);
  }
}

main().catch(console.error);
