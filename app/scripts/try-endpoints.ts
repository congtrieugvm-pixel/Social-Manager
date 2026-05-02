const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function tryUrl(url: string, extra: Record<string, string> = {}) {
  console.log("\n---", url);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept-Language": "en-US,en;q=0.9",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        ...extra,
      },
      redirect: "follow",
    });
    console.log("status:", res.status, "url:", res.url);
    const text = await res.text();
    console.log("len:", text.length);
    if (/itemList/.test(text)) {
      const m = text.match(/"itemList":\[.{0,200}/);
      console.log("itemList snippet:", m?.[0]?.slice(0, 180));
    } else {
      console.log("no itemList keyword");
    }
  } catch (e) {
    console.log("err:", e instanceof Error ? e.message : String(e));
  }
}

async function main() {
  const u = "sajenpsoznl";
  // Mobile UA
  await tryUrl(`https://www.tiktok.com/@${u}`, {
    "User-Agent":
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });
  // With referer + cookie
  await tryUrl(`https://www.tiktok.com/@${u}`, {
    Referer: "https://www.google.com/",
    Cookie: "tt-target-idc=useast1a; ttwid=1%7Cfake; tt_csrf_token=1",
  });
  // Google bot UA
  await tryUrl(`https://www.tiktok.com/@${u}`, {
    "User-Agent":
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  });
}

main().catch(console.error);
