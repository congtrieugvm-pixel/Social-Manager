import { NextResponse } from "next/server";
import { AuthError } from "@/lib/auth";
import { getOwnerId } from "@/lib/scope";
import { loadCandidates } from "@/lib/insight-accounts";
import { parseGraphError } from "@/lib/facebook";
import {
  CoolingError,
  REACH_RANGES,
  fetchPageReach,
  type ReachRange,
} from "@/lib/page-reach";

// GET /api/insight/reach?pageId=…&range=today|7d|28d&accounts=1,2
//   accounts = Facebook account ids that manage the page (token candidates).
// → { range, metric, reach, prev, daily: [{ date, value }], via,
//     todayPending?, unsupported?, reason? }
// Rate-limited on every token → 429 { error, cooling: true, retryAfter }.
export async function GET(req: Request) {
  try {
    const ownerId = await getOwnerId();
    const url = new URL(req.url);
    const pageId = (url.searchParams.get("pageId") ?? "").trim();
    const range = url.searchParams.get("range") as ReachRange;
    const accountIds = (url.searchParams.get("accounts") ?? "")
      .split(",")
      .map((s) => Number(s));

    if (!/^\d+$/.test(pageId)) {
      return NextResponse.json({ error: "pageId không hợp lệ" }, { status: 400 });
    }
    if (!REACH_RANGES.includes(range)) {
      return NextResponse.json(
        { error: "range phải là today, 7d hoặc 28d" },
        { status: 400 },
      );
    }
    const candidates = await loadCandidates(ownerId, accountIds);
    if (candidates.length === 0) {
      return NextResponse.json(
        { error: "Không có tài khoản Facebook nào (có token) quản lý Trang này" },
        { status: 400 },
      );
    }

    const result = await fetchPageReach(pageId, range, candidates);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    if (e instanceof CoolingError) {
      return NextResponse.json(
        { error: e.message, cooling: true, retryAfter: e.retryAfterSec },
        { status: 429, headers: { "Retry-After": String(e.retryAfterSec) } },
      );
    }
    const info = parseGraphError(e);
    return NextResponse.json(
      { error: `Lỗi Graph${info.code ? ` #${info.code}` : ""}: ${info.message}` },
      { status: 502 },
    );
  }
}
