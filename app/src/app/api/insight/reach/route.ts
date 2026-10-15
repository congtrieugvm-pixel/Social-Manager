import { NextResponse } from "next/server";
import { getOwnerId } from "@/lib/scope";
import { loadCandidates } from "@/lib/insight-tokens";
import { parseGraphError } from "@/lib/facebook";
import { CoolingError, fetchPageReach } from "@/lib/page-reach";
import { saveSnapshots } from "@/lib/insight-snapshots";
import { errorResponse } from "../_util";

// GET /api/insight/reach?pageId=…&tokens=1,2
//   tokens = Insight token ids that can read the page (candidates).
// → { metric, via, ranges: { today, 7d, 28d }, unsupported?, reason? }
//   each range: { reach, prev, daily: [{ date, value }], todayPending? }
// One Graph call answers all three ranges.
// Rate-limited on every token → 429 { error, cooling: true, retryAfter }.
export async function GET(req: Request) {
  try {
    const ownerId = await getOwnerId();
    const url = new URL(req.url);
    const pageId = (url.searchParams.get("pageId") ?? "").trim();
    const tokenIds = (url.searchParams.get("tokens") ?? "").split(",").map(Number);
    if (!/^\d+$/.test(pageId)) {
      return NextResponse.json({ error: "pageId không hợp lệ" }, { status: 400 });
    }
    const candidates = await loadCandidates(ownerId, tokenIds);
    if (candidates.length === 0) {
      return NextResponse.json({ error: "Không có token nào đọc được Trang này" }, { status: 400 });
    }
    const result = await fetchPageReach(pageId, candidates);
    await saveSnapshots(ownerId, "reach", [{ key: pageId, data: result }]);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof CoolingError) {
      return NextResponse.json(
        { error: e.message, cooling: true, retryAfter: e.retryAfterSec },
        { status: 429, headers: { "Retry-After": String(e.retryAfterSec) } },
      );
    }
    if ((e as { graph?: unknown })?.graph) {
      const info = parseGraphError(e);
      return NextResponse.json(
        { error: `Lỗi Graph${info.code ? ` #${info.code}` : ""}: ${info.message}` },
        { status: 502 },
      );
    }
    return errorResponse(e);
  }
}
