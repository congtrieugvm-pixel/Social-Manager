import { DurableObject } from "cloudflare:workers";

// Only TikTok pages (plus the trace URL used to check where we run).
const ALLOWED = /^https:\/\/(www\.tiktok\.com\/|www\.cloudflare\.com\/cdn-cgi\/trace$)/;
const HINTS = ["wnam", "enam", "weur"];
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export class TikTokFetcher extends DurableObject {
  async fetch(req) {
    const target = req.headers.get("x-target") || "";
    if (!ALLOWED.test(target)) return new Response("bad target", { status: 400 });
    const r = await fetch(target, {
      headers: {
        "user-agent": UA,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
      redirect: "manual",
    });
    // Upstream status / redirect travel in headers so a 3xx is never followed
    // on the way back to the caller.
    const h = new Headers({ "content-type": r.headers.get("content-type") || "text/html" });
    h.set("x-upstream-status", String(r.status));
    const loc = r.headers.get("location");
    if (loc) h.set("x-upstream-location", loc);
    const sys = r.headers.get("x-tt-system-error");
    if (sys) h.set("x-upstream-syserr", sys);
    return new Response(r.body, { status: 200, headers: h });
  }
}

export default {
  async fetch(req, env) {
    const asked = req.headers.get("x-region");
    const hint = HINTS.includes(asked) ? asked : HINTS[Math.floor(Math.random() * HINTS.length)];
    const stub = env.FETCHER.get(env.FETCHER.idFromName(`tt-${hint}`), { locationHint: hint });
    return stub.fetch(req);
  },
};
