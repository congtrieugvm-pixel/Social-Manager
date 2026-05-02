/**
 * One-off probe: hit Graph API directly for the page user said is monetized
 * (page_id=1658285234418878 / "Sinistros BJJ"). Uses the parent fb_account's
 * user-level access token. Reports raw responses from each metric so we can
 * see exactly what FB says.
 */
import Database from "better-sqlite3";
import { decrypt } from "../src/lib/crypto";
import { fetchPageEarningsBreakdown, parseGraphError, scrubGraphMessage } from "../src/lib/facebook";
import path from "node:path";

const PAGE_ID = process.argv[2] || "1658285234418878";

async function main() {
  const dbPath = path.join(process.cwd(), "data", "app.db");
  const sqlite = new Database(dbPath, { readonly: true });
  const row = sqlite.prepare(`
    SELECT f.page_id, f.name,
           fa.enc_access_token AS user_token,
           f.enc_page_access_token AS page_token
    FROM fanpages f
    LEFT JOIN facebook_accounts fa ON f.fb_account_id = fa.id
    WHERE f.page_id = ?
  `).get(PAGE_ID) as { page_id: string; name: string; user_token: string | null; page_token: string | null } | undefined;
  if (!row) {
    console.log("Page not found in DB.");
    process.exit(1);
  }
  console.log(`Page: ${row.name} (${row.page_id})`);
  console.log(`Has page token: ${!!row.page_token}`);
  console.log(`Has user token: ${!!row.user_token}`);

  const tokenSource = row.page_token ? "page" : "user";
  const tokenEnc = row.page_token ?? row.user_token;
  if (!tokenEnc) {
    console.log("No token available — bailing.");
    process.exit(1);
  }
  const token = decrypt(tokenEnc);
  if (!token) {
    console.log("Decrypt failed.");
    process.exit(1);
  }
  console.log(`Using ${tokenSource} token (${token.length} chars).\n`);

  // Probe wider set of monetization-related metrics. Some are page-level
  // insights, some are direct fields on the Page node.
  const metrics = [
    "content_monetization_earnings",
    "monetization_approximate_earnings",
    "page_video_ad_break_earnings",
    "page_video_ad_break_ad_impressions",
    "page_total_video_ad_break_earnings_by_country",
    "creator_monetization_earnings",
  ];
  const now = Math.floor(Date.now() / 1000);
  const since = now - 28 * 86_400;
  // Try v23 first (where new metrics live), then v21 as fallback for older deps.
  for (const m of metrics) {
    const url = `https://graph.facebook.com/v23.0/${PAGE_ID}/insights?metric=${m}&period=day&since=${since}&until=${now}&access_token=${encodeURIComponent(token)}`;
    try {
      const res = await fetch(url, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        console.log(`  [${m}] HTTP ${res.status}: ${scrubGraphMessage(JSON.stringify(data?.error ?? data))}`);
      } else {
        const series = data?.data?.[0];
        if (!series || !Array.isArray(series.values)) {
          console.log(`  [${m}] OK but no values`);
        } else {
          const total = series.values.reduce((s: number, v: { value: number | Record<string, number> }) => s + (typeof v.value === "number" ? v.value : 0), 0);
          console.log(`  [${m}] OK, ${series.values.length} days, total=$${total.toFixed(4)}`);
        }
      }
    } catch (e) {
      console.log(`  [${m}] FETCH ERROR: ${e instanceof Error ? scrubGraphMessage(e.message) : String(e)}`);
    }
  }

  console.log("\n--- via fetchPageEarningsBreakdown (28d) ---");
  const breakdown = await fetchPageEarningsBreakdown(PAGE_ID, token, { days: 28 });
  console.log(`status: ${breakdown.status}`);
  console.log(`totalMicros: ${breakdown.totalMicros} (= $${(breakdown.totalMicros / 1_000_000).toFixed(4)})`);
  console.log(`currency: ${breakdown.currency}`);
  console.log(`error: ${breakdown.error ?? "(none)"}`);
  for (const s of breakdown.sources) {
    console.log(`  ${s.source}: ${(s.micros / 1_000_000).toFixed(4)} avail=${s.available} err=${s.error ?? "-"}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
