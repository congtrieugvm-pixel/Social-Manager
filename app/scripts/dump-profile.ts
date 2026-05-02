async function main() {
  const url = "https://www.tiktok.com/@sajenpsoznl";
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    },
    redirect: "follow",
  });
  console.log("status:", res.status);
  const html = await res.text();
  console.log("length:", html.length);

  const m = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) {
    console.log("no UNIVERSAL_DATA script");
    console.log("SIGRI script?", /__SIGI_STATE__/.test(html));
    console.log("NEXT_DATA?", /__NEXT_DATA__/.test(html));
    console.log("First 1000 chars:\n", html.slice(0, 1000));
    return;
  }
  const data = JSON.parse(m[1]);
  const scope = data.__DEFAULT_SCOPE__ || {};
  console.log("scope keys:", Object.keys(scope));
  const userDetail = scope["webapp.user-detail"];
  if (userDetail) {
    console.log("userDetail keys:", Object.keys(userDetail));
    console.log("statusCode:", userDetail.statusCode, userDetail.statusMsg);
    const ui = userDetail.userInfo;
    if (ui) {
      console.log("userInfo.itemList type:", typeof ui.itemList, Array.isArray(ui.itemList) ? "ARRAY" : "not-array");
      console.log("userInfo.itemList len:", ui.itemList?.length);
      if (Array.isArray(ui.itemList) && ui.itemList.length > 0) {
        const p = ui.itemList[0];
        console.log("first item keys:", Object.keys(p));
        console.log("first id:", p.id, "desc:", (p.desc || "").slice(0, 40));
        console.log("stats:", p.stats, "statsV2:", p.statsV2);
        console.log("video.cover:", p.video?.cover?.slice(0, 80));
      }
      console.log("stats:", ui.stats);
    }
  }
}

main().catch(console.error);
