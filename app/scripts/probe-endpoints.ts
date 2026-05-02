const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function probe(url: string, extra: Record<string, string> = {}) {
  console.log("\n===", url);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept-Language": "en-US,en;q=0.9",
        Accept: "*/*",
        ...extra,
      },
      redirect: "follow",
    });
    const text = await res.text();
    console.log("status:", res.status, "len:", text.length);
    // Try JSON
    if (text.startsWith("{") || text.startsWith("[")) {
      try {
        const j = JSON.parse(text);
        const keys = Object.keys(j).slice(0, 10);
        console.log("JSON top keys:", keys);
        if (j.itemList)
          console.log("itemList len:", Array.isArray(j.itemList) ? j.itemList.length : "?");
        if (j.body)
          console.log("body keys:", Object.keys(j.body).slice(0, 8));
        if (j.data)
          console.log("data keys:", typeof j.data === "object" ? Object.keys(j.data).slice(0, 8) : typeof j.data);
      } catch {
        console.log("JSON parse failed, first 200:", text.slice(0, 200));
      }
    } else {
      if (/itemList/.test(text)) {
        const m = text.match(/"itemList":\[[\s\S]{0,300}/);
        console.log("itemList HTML snippet:", m?.[0]?.slice(0, 200));
      } else {
        console.log("no itemList keyword. First 200:", text.slice(0, 200));
      }
    }
  } catch (e) {
    console.log("err:", e instanceof Error ? e.message : String(e));
  }
}

async function main() {
  const u = "mrbeast";
  // Node share endpoint (historic)
  await probe(`https://www.tiktok.com/node/share/user/@${u}`);
  // embed
  await probe(`https://www.tiktok.com/embed/@${u}`);
  await probe(`https://www.tiktok.com/embed/v2/@${u}`);
  // mobile html
  await probe(`https://m.tiktok.com/@${u}`, {
    "User-Agent":
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });
  // tikwm (unlikely but let's try)
  await probe(`https://www.tikwm.com/api/user/posts?unique_id=${u}&count=3&cursor=0`);
  // rsshub
  await probe(`https://rsshub.app/tiktok/user/@${u}`);
  // oEmbed (single URL) — needs a video URL
  await probe(
    `https://www.tiktok.com/oembed?url=https://www.tiktok.com/@${u}`,
  );
}

main().catch(console.error);
